"""
Interactive Brokers parser.

Handles two file formats from IBKR:
  1. Pipe-delimited activity reports (trades and dividends as separate files)
  2. Flex Query CSV (comma-separated with section markers)

Real-world IBKR files are pipe-delimited with headers in the first row.
Column order varies between years and report types.

Trade files contain: TradePrice, AssetClass, Quantity, CurrencyPrimary,
    TradeDate, TransactionID, NetCash, Symbol (in varying order)

Dividend files contain: TransactionID, Type, Amount, Date/Time,
    Multiplier, Symbol, CurrencyPrimary (in varying order)
"""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from app.models import ActionType, BrokerName, UnifiedTransaction
from app.parsers.base import BaseParser

logger = logging.getLogger(__name__)


def _safe_decimal(value: str) -> Decimal:
    """Convert string to Decimal, handling commas and empty strings."""
    if not value or value.strip() in ("", "-", "--"):
        return Decimal("0")
    cleaned = value.strip().replace(",", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        logger.warning("Could not parse decimal: %r", value)
        return Decimal("0")


def _parse_ibkr_datetime(value: str) -> datetime:
    """Parse IBKR date/datetime strings in various formats."""
    value = value.strip().strip('"')
    for fmt in (
        "%Y-%m-%d, %H:%M:%S",
        "%Y-%m-%d;%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y%m%d;%H%M%S",
        "%Y%m%d %H%M%S",
        "%Y-%m-%d",
        "%Y%m%d",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse IBKR datetime: {value!r}")


def _make_id(row_data: str) -> str:
    return hashlib.sha256(row_data.encode()).hexdigest()[:16]


def _estimate_settlement_date(trade_date: date, currency: str) -> date:
    """Estimate settlement date: T+1 for US markets (post 2024-05-28), T+2 otherwise."""
    us_currencies = ("USD",)
    cutoff = date(2024, 5, 28)
    offset = 1 if (currency in us_currencies and trade_date >= cutoff) else 2

    settle = trade_date
    days_added = 0
    while days_added < offset:
        settle += timedelta(days=1)
        if settle.weekday() < 5:
            days_added += 1
    return settle


class IBKRParser(BaseParser):
    """
    Parser for Interactive Brokers exports.

    Supports:
      - Pipe-delimited trade reports (akcje*.csv)
      - Pipe-delimited dividend/cash reports (dyw*.csv)
      - Flex Query CSV format (comma-separated with section markers)
    """

    broker_name = "IBKR"

    @staticmethod
    def detect(file_content: str | bytes, filename: str = "") -> bool:
        text = _decode(file_content)
        first_line = text.split("\n")[0]

        ibkr_columns = [
            "TradePrice",
            "AssetClass",
            "TransactionID",
            "NetCash",
            "CurrencyPrimary",
        ]

        # Pipe-delimited IBKR
        if "|" in first_line:
            matches = sum(1 for ind in ibkr_columns if ind in first_line)
            if matches >= 2:
                return True

        # Comma-delimited IBKR CSV (quoted or unquoted headers)
        clean_line = first_line.replace('"', '').replace("'", "")
        if "," in clean_line:
            matches = sum(1 for ind in ibkr_columns if ind in clean_line)
            if matches >= 2:
                return True

        # Flex Query CSV format (section markers)
        flex_indicators = [
            "Trades,Header",
            "Statement,Header",
            "ClientAccountID",
            "AccountAlias",
        ]
        if any(ind in text for ind in flex_indicators):
            return True

        # Dividend/cash CSV with Type column (IBKR dividend files)
        div_columns = ["Type", "Amount", "Symbol", "CurrencyPrimary"]
        if "," in clean_line:
            matches = sum(1 for ind in div_columns if ind in clean_line)
            if matches >= 3:
                return True

        return False

    def parse(self, file_content: str | bytes, filename: str = "") -> list[UnifiedTransaction]:
        text = _decode(file_content)

        # Determine format
        first_line = text.strip().split("\n")[0]

        if "|" in first_line and "," not in first_line.split("|")[0]:
            # Pipe-delimited (older IBKR activity reports)
            transactions = self._parse_pipe_delimited(text, filename)
        elif "Trades,Header" in text or "Statement,Header" in text:
            # Flex Query CSV with section markers
            transactions = self._parse_flex_query(text)
        else:
            # Comma-delimited CSV (Flex Query output without section markers)
            transactions = self._parse_csv_delimited(text, filename)

        transactions.sort(key=lambda t: t.trade_date)
        return transactions

    # ------------------------------------------------------------------
    # Pipe-delimited format (real IBKR activity reports)
    # ------------------------------------------------------------------

    def _parse_pipe_delimited(self, text: str, filename: str = "") -> list[UnifiedTransaction]:
        """Parse pipe-delimited IBKR files."""
        lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
        if not lines:
            return []

        headers = [h.strip() for h in lines[0].split("|")]
        results: list[UnifiedTransaction] = []

        # Detect file type from headers
        has_trade_price = "TradePrice" in headers
        has_type_col = "Type" in headers

        for line in lines[1:]:
            values = [v.strip() for v in line.split("|")]
            if len(values) < len(headers):
                values.extend([""] * (len(headers) - len(values)))
            row = dict(zip(headers, values))

            if has_trade_price and not has_type_col:
                # This is a trades file
                tx = self._pipe_trade_to_transaction(row)
                if tx:
                    results.append(tx)
            elif has_type_col:
                # This is a dividends/cash file
                txs = self._pipe_cash_to_transactions(row)
                results.extend(txs)

        return results

    def _pipe_trade_to_transaction(self, row: dict[str, str]) -> Optional[UnifiedTransaction]:
        """Convert a pipe-delimited trade row to UnifiedTransaction."""
        try:
            asset_class = row.get("AssetClass", "").upper()
            # Skip forex/cash rows
            if asset_class == "CASH":
                return None

            symbol = row.get("Symbol", "").strip()
            if not symbol:
                return None
            # Skip forex symbols like EUR.PLN, EUR.USD
            if "." in symbol and all(
                len(part) == 3 and part.isalpha() for part in symbol.split(".")
            ):
                return None

            qty = _safe_decimal(row.get("Quantity", "0"))
            if qty == 0:
                return None

            if qty < 0:
                action = ActionType.SELL
                qty = abs(qty)
            else:
                action = ActionType.BUY

            # Prefer DateTime (has full timestamp) over TradeDate (date only)
            trade_date_str = row.get("DateTime", row.get("TradeDate", ""))
            if not trade_date_str:
                return None
            trade_dt = _parse_ibkr_datetime(trade_date_str)

            price = _safe_decimal(row.get("TradePrice", "0"))
            currency = row.get("CurrencyPrimary", "USD").strip()
            net_cash = _safe_decimal(row.get("NetCash", "0"))

            # Compute commission from NetCash:
            # For BUY: NetCash = -(price * qty + commission)  -> commission = -(NetCash) - price*qty
            # For SELL: NetCash = price * qty - commission     -> commission = price*qty - NetCash
            expected_value = price * qty
            if action == ActionType.BUY:
                commission = abs(net_cash) - expected_value
            else:
                commission = expected_value - net_cash
            commission = max(Decimal("0"), commission.quantize(Decimal("0.01")))

            settle = _estimate_settlement_date(trade_dt.date(), currency)
            tx_id = row.get("TransactionID", "")
            row_id = _make_id(f"IBKR_{tx_id}_{symbol}_{trade_date_str}")

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.IBKR,
                symbol=symbol,
                isin=None,
                description=None,
                trade_date=trade_dt,
                settlement_date=settle,
                action=action,
                quantity=qty,
                price=price,
                currency=currency,
                commission=commission,
                commission_currency=None,
            )

        except Exception as e:
            logger.warning("Failed to parse IBKR pipe trade row: %s – %s", row, e)
            return None

    def _pipe_cash_to_transactions(self, row: dict[str, str]) -> list[UnifiedTransaction]:
        """Convert a pipe-delimited cash/dividend row to UnifiedTransaction(s)."""
        results: list[UnifiedTransaction] = []
        try:
            tx_type = row.get("Type", "").strip()
            symbol = row.get("Symbol", "").strip()
            currency = row.get("CurrencyPrimary", "USD").strip()
            amount = _safe_decimal(row.get("Amount", "0"))
            tx_id = row.get("TransactionID", "")

            date_str = row.get("Date/Time", row.get("DateTime", ""))
            if not date_str:
                return results

            pay_dt = _parse_ibkr_datetime(date_str)

            isin_val = row.get("ISIN") or None
            country = isin_val[:2].upper() if isin_val and len(isin_val) >= 2 and isin_val[:2].isalpha() else None

            if tx_type == "Dividends" and symbol:
                row_id = _make_id(f"IBKR_DIV_{tx_id}_{symbol}")
                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.IBKR,
                    symbol=symbol,
                    isin=isin_val,
                    country=country,
                    description=None,
                    trade_date=pay_dt,
                    settlement_date=pay_dt.date(),
                    action=ActionType.DIVIDEND,
                    quantity=abs(amount),
                    price=Decimal("1"),
                    currency=currency,
                    commission=Decimal("0"),
                ))

            elif tx_type == "Withholding Tax" and symbol:
                row_id = _make_id(f"IBKR_WHT_{tx_id}_{symbol}")
                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.IBKR,
                    symbol=symbol,
                    isin=isin_val,
                    country=country,
                    description=None,
                    trade_date=pay_dt,
                    settlement_date=pay_dt.date(),
                    action=ActionType.TAX_WHT,
                    quantity=abs(amount),
                    price=Decimal("1"),
                    currency=currency,
                    commission=Decimal("0"),
                ))

            # Skip: Other Fees, Deposits/Withdrawals, Broker Interest, Broker Fees

        except Exception as e:
            logger.warning("Failed to parse IBKR pipe cash row: %s – %s", row, e)

        return results

    # ------------------------------------------------------------------
    # Comma-delimited CSV (Flex Query output without section markers)
    # ------------------------------------------------------------------

    def _parse_csv_delimited(self, text: str, filename: str = "") -> list[UnifiedTransaction]:
        """Parse comma-delimited IBKR CSV files – handles multi-section raw format.

        Raw IBKR CSV files can contain multiple sections (Trades, Transfers,
        Dividends) concatenated together, each with its own header row starting
        with 'ClientAccountID'.  Data from one section may resume after another
        section without a new header (e.g. 2025 trades appearing after a
        Transfers block that followed 2024 trades).
        """
        results: list[UnifiedTransaction] = []

        reader = csv.reader(io.StringIO(text))

        # Store all section headers encountered
        section_headers: dict[str, list[str]] = {}  # section_type -> columns
        current_section = ""
        current_headers: list[str] = []

        for parts in reader:
            if not parts:
                continue

            parts = [p.strip() for p in parts]

            # Detect header rows – all IBKR raw CSV headers start with ClientAccountID
            if parts[0] == "ClientAccountID":
                current_headers = parts
                current_section = self._classify_raw_section(parts)
                if current_section != "other":
                    section_headers[current_section] = parts
                continue

            if not section_headers:
                continue

            # Try current section first
            txs = self._try_parse_raw_row(parts, current_section, current_headers)
            if txs:
                results.extend(txs)
                continue

            # Fallback: try other known sections (handles section switches
            # without a new header, e.g. trades resuming after transfers)
            for sec_type, sec_headers in section_headers.items():
                if sec_type == current_section:
                    continue
                txs = self._try_parse_raw_row(parts, sec_type, sec_headers)
                if txs:
                    results.extend(txs)
                    # Update current section for subsequent rows
                    current_section = sec_type
                    current_headers = sec_headers
                    break

        return results

    @staticmethod
    def _classify_raw_section(headers: list[str]) -> str:
        """Classify a raw CSV header row by section type."""
        header_set = set(headers)
        if "Direction" in header_set and (
            "TransferCompany" in header_set or "TransferAccount" in header_set
        ):
            return "transfers"
        if "Buy/Sell" in header_set or "TradeID" in header_set:
            return "trades"
        if "ActionDescription" in header_set and (
            "Type" in header_set or "Amount" in header_set
        ):
            return "dividends"
        return "other"

    def _try_parse_raw_row(
        self, parts: list[str], section: str, headers: list[str]
    ) -> list[UnifiedTransaction]:
        """Try to parse a data row using the given section type and header."""
        row = dict(zip(headers, parts))

        if section == "trades":
            buy_sell = row.get("Buy/Sell", "")
            if buy_sell not in ("BUY", "SELL"):
                return []
            tx = self._pipe_trade_to_transaction(row)
            return [tx] if tx else []

        elif section == "transfers":
            direction = row.get("Direction", "").strip().upper()
            if direction not in ("IN", "OUT"):
                return []
            tx = self._flex_transfer_to_transaction(row)
            return [tx] if tx else []

        elif section == "dividends":
            type_val = row.get("Type", "")
            if type_val not in ("Dividends", "Withholding Tax"):
                return []
            return self._pipe_cash_to_transactions(row)

        return []

    # ------------------------------------------------------------------
    # Flex Query CSV format (section-based, comma-separated)
    # ------------------------------------------------------------------

    def _parse_flex_query(self, text: str) -> list[UnifiedTransaction]:
        """Parse Flex Query CSV format with Trades,Header / Trades,Data markers."""
        results: list[UnifiedTransaction] = []

        # Use csv.reader to handle quoted fields (e.g. "2023-10-05, 05:36:04" or "1,355")
        reader = csv.reader(io.StringIO(text))
        header_cols: list[str] = []
        current_section = ""

        for parts in reader:
            parts = [p.strip() for p in parts]
            if len(parts) < 2:
                continue

            section = parts[0]
            discriminator = parts[1]

            if discriminator == "Header":
                current_section = section
                header_cols = parts
                continue

            if discriminator != "Data" or not header_cols:
                continue

            row = dict(zip(header_cols, parts))

            if current_section == "Trades":
                tx = self._flex_trade_to_transaction(row)
                if tx:
                    results.append(tx)
            elif current_section == "Dividends":
                tx = self._flex_div_to_transaction(row, ActionType.DIVIDEND)
                if tx:
                    results.append(tx)
            elif current_section == "Withholding Tax":
                tx = self._flex_div_to_transaction(row, ActionType.TAX_WHT)
                if tx:
                    results.append(tx)
            elif current_section == "Transfers":
                tx = self._flex_transfer_to_transaction(row)
                if tx:
                    results.append(tx)

        return results

    def _flex_trade_to_transaction(self, row: dict[str, str]) -> Optional[UnifiedTransaction]:
        """Parse a Flex Query trades row.

        Handles both detailed Flex Query column names (TradePrice, CurrencyPrimary,
        IBCommission) and Activity Statement summary names (T. Price, Currency, Comm/Fee).
        """
        try:
            asset_cat = row.get("Asset Category", row.get("AssetCategory", "")).lower()
            if asset_cat in ("forex", "cash"):
                return None

            symbol = row.get("Symbol", "").strip()
            if not symbol:
                return None

            qty = _safe_decimal(row.get("Quantity", "0"))
            if qty == 0:
                return None

            action = ActionType.SELL if qty < 0 else ActionType.BUY
            qty = abs(qty)

            date_str = row.get("DateTime", row.get("TradeDate", row.get("Date/Time", "")))
            trade_dt = _parse_ibkr_datetime(date_str)

            settle_str = row.get("SettleDateTarget", row.get("SettleDate", ""))
            settle = _parse_ibkr_datetime(settle_str).date() if settle_str else trade_dt.date()

            price = _safe_decimal(
                row.get("TradePrice", row.get("T. Price", "0"))
            )
            currency = row.get("CurrencyPrimary", row.get("Currency", "USD")).strip()
            commission = abs(_safe_decimal(
                row.get("IBCommission", row.get("Commission", row.get("Comm/Fee", "0")))
            ))

            row_id = _make_id(f"IBKR_FLEX_{symbol}{trade_dt}{qty}{price}")

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.IBKR,
                symbol=symbol,
                isin=row.get("ISIN") or None,
                description=row.get("Description") or None,
                trade_date=trade_dt,
                settlement_date=settle,
                action=action,
                quantity=qty,
                price=price,
                currency=currency,
                commission=commission,
            )
        except Exception as e:
            logger.warning("Failed to parse IBKR flex trade: %s – %s", row, e)
            return None

    def _flex_div_to_transaction(
        self, row: dict[str, str], action: ActionType
    ) -> Optional[UnifiedTransaction]:
        """Parse a Flex Query dividend/WHT row.

        Handles both detailed Flex Query format (separate Symbol column) and
        Activity Statement format (symbol embedded in Description like
        'TRET(NL0009690239) Cash Dividend EUR 0.32 per Share').
        """
        try:
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                # Activity Statement: extract symbol from Description
                desc = row.get("Description", "")
                if desc and "(" in desc:
                    symbol = desc.split("(")[0].strip()
            if not symbol:
                return None

            # Skip "Total" summary rows
            if symbol.lower() in ("total", "total in usd"):
                return None

            date_str = row.get("Date", row.get("DateTime", row.get("ReportDate", "")))
            if not date_str:
                return None
            pay_dt = _parse_ibkr_datetime(date_str)

            amount = _safe_decimal(row.get("Amount", row.get("Tax", "0")))
            currency = row.get("CurrencyPrimary", row.get("Currency", "USD")).strip()

            row_id = _make_id(f"IBKR_FLEX_{action.value}_{symbol}{pay_dt}{amount}")
            isin_val = row.get("ISIN") or None
            # Try to extract ISIN from Description: "TRET(NL0009690239) Cash Dividend..."
            if not isin_val:
                desc = row.get("Description", "")
                isin_match = re.search(r"\(([A-Z]{2}[A-Z0-9]{9,10})\)", desc)
                if isin_match:
                    isin_val = isin_match.group(1)
            country = isin_val[:2].upper() if isin_val and len(isin_val) >= 2 and isin_val[:2].isalpha() else None

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.IBKR,
                symbol=symbol,
                isin=isin_val,
                country=country,
                description=row.get("Description") or None,
                trade_date=pay_dt,
                settlement_date=pay_dt.date(),
                action=action,
                quantity=abs(amount),
                price=Decimal("1"),
                currency=currency,
                commission=Decimal("0"),
            )
        except Exception as e:
            logger.warning("Failed to parse IBKR flex div: %s – %s", row, e)
            return None

    def _flex_transfer_to_transaction(self, row: dict[str, str]) -> Optional[UnifiedTransaction]:
        """Parse a Flex Query or raw CSV transfer row as a BUY (transfer-in) or SELL (transfer-out).

        Handles both Flex Query column names (Qty, Currency, Market Value, Asset Category,
        Xfer Account) and raw CSV column names (Quantity, CurrencyPrimary, PositionAmount,
        AssetClass, TransferAccount).
        """
        try:
            direction = row.get("Direction", "").strip()
            direction_upper = direction.upper()
            if direction_upper not in ("IN", "OUT"):
                return None

            asset_cat = row.get("Asset Category", row.get("AssetClass", "")).lower()
            if asset_cat in ("forex", "cash", ""):
                return None

            symbol = row.get("Symbol", "").strip()
            if not symbol or symbol == "--":
                return None

            qty = _safe_decimal(row.get("Qty", row.get("Quantity", "0")))
            if qty <= 0:
                return None

            date_str = row.get("Date", "")
            if not date_str:
                return None
            transfer_dt = _parse_ibkr_datetime(date_str)

            currency = row.get("Currency", row.get("CurrencyPrimary", "USD")).strip()
            market_value = abs(_safe_decimal(
                row.get("Market Value", row.get("PositionAmount", "0"))
            ))

            # Compute price from market value / qty
            price = (market_value / qty).quantize(Decimal("0.0001")) if qty > 0 else Decimal("0")

            action = ActionType.BUY if direction_upper == "IN" else ActionType.SELL
            settle = _estimate_settlement_date(transfer_dt.date(), currency)

            xfer_account = row.get("Xfer Account", row.get("TransferAccount", ""))
            row_id = _make_id(f"IBKR_XFER_{symbol}_{transfer_dt}_{qty}_{direction}")

            logger.info(
                "Transfer %s: %s %s %s x %s @ %s %s (from %s)",
                direction, action.value, symbol, qty, price, currency, transfer_dt.date(), xfer_account,
            )

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.IBKR,
                symbol=symbol,
                isin=None,
                description=f"Transfer {direction} (from {xfer_account})" if xfer_account else f"Transfer {direction}",
                trade_date=transfer_dt,
                settlement_date=settle,
                action=action,
                quantity=qty,
                price=price,
                currency=currency,
                commission=Decimal("0"),
            )
        except Exception as e:
            logger.warning("Failed to parse IBKR flex transfer: %s – %s", row, e)
            return None


def _decode(content: str | bytes) -> str:
    """Decode bytes to string, handling various encodings."""
    if isinstance(content, str):
        return content.lstrip("\ufeff")
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return content.decode(encoding).lstrip("\ufeff")
        except (UnicodeDecodeError, ValueError):
            continue
    return content.decode("latin-1").lstrip("\ufeff")
