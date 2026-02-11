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

            trade_date_str = row.get("TradeDate", "")
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

            if tx_type == "Dividends" and symbol:
                row_id = _make_id(f"IBKR_DIV_{tx_id}_{symbol}")
                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.IBKR,
                    symbol=symbol,
                    isin=None,
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
                    isin=None,
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
        """Parse comma-delimited IBKR CSV files with quoted values."""
        results: list[UnifiedTransaction] = []

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return results

        has_trade_price = "TradePrice" in reader.fieldnames
        has_type_col = "Type" in reader.fieldnames

        for row in reader:
            if has_trade_price and not has_type_col:
                tx = self._pipe_trade_to_transaction(row)
                if tx:
                    results.append(tx)
            elif has_type_col:
                txs = self._pipe_cash_to_transactions(row)
                results.extend(txs)

        return results

    # ------------------------------------------------------------------
    # Flex Query CSV format (section-based, comma-separated)
    # ------------------------------------------------------------------

    def _parse_flex_query(self, text: str) -> list[UnifiedTransaction]:
        """Parse Flex Query CSV format with Trades,Header / Trades,Data markers."""
        results: list[UnifiedTransaction] = []

        lines = text.splitlines()
        header_cols: list[str] = []
        current_section = ""

        for line in lines:
            parts = [p.strip().strip('"') for p in line.split(",")]
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

        return results

    def _flex_trade_to_transaction(self, row: dict[str, str]) -> Optional[UnifiedTransaction]:
        """Parse a Flex Query trades row."""
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

            price = _safe_decimal(row.get("TradePrice", "0"))
            currency = row.get("CurrencyPrimary", "USD").strip()
            commission = abs(_safe_decimal(row.get("IBCommission", row.get("Commission", "0"))))

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
        """Parse a Flex Query dividend/WHT row."""
        try:
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                return None

            date_str = row.get("Date", row.get("DateTime", row.get("ReportDate", "")))
            if not date_str:
                return None
            pay_dt = _parse_ibkr_datetime(date_str)

            amount = _safe_decimal(row.get("Amount", row.get("Tax", "0")))
            currency = row.get("CurrencyPrimary", "USD").strip()

            row_id = _make_id(f"IBKR_FLEX_{action.value}_{symbol}{pay_dt}{amount}")

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.IBKR,
                symbol=symbol,
                isin=row.get("ISIN") or None,
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
