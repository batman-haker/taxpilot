"""
Exante broker parser.

Exante exports come in two flavors:

**Format 1** ("clean" / Custom report): Single-row per trade with price,
quantity, commissions, and settlement date all in one row. Polish headers:
    Godzina, Strona, ID symbolu, ISIN, Rodzaj, Cena, Waluta, Ilość,
    Prowizje, Waluta dla prowizji, Data wartości, etc.

**Format 2** ("traditional"): Multi-row per trade: asset line + cash line
+ commission line. Polish headers:
    Identyfikator transakcji, Rodzaj operacji, ID symbolu, Gdy, Suma, Aktywa
Also contains DIVIDEND, US TAX, INTEREST, FUNDING/WITHDRAWAL rows.

The "Custom" report CSV may contain BOTH formats, preceded by a costs/fees
summary section. This parser handles all cases:
  - Clean format only → parse trades from Format 1
  - Traditional format only → parse trades, dividends, taxes from Format 2
  - Both formats → trades from Format 1, dividends+taxes from Format 2

All files are UTF-16 encoded (with BOM), tab-delimited, with quoted fields.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from app.models import ActionType, BrokerName, UnifiedTransaction
from app.parsers.base import BaseParser

logger = logging.getLogger(__name__)


# Column name mapping: Polish -> canonical English (Format 2 / traditional)
POLISH_HEADERS = {
    "Identyfikator transakcji": "TransactionID",
    "Transaction ID": "TransactionID",
    "Identyfikator konta": "AccountID",
    "ID symbolu": "SymbolID",
    "ISIN": "ISIN",
    "Rodzaj operacji": "OperationType",
    "Gdy": "When",
    "Suma": "Amount",
    "Aktywa": "Asset",
    "EUR equivalent": "EUREquivalent",
    "Ekwiwalent EUR": "EUREquivalent",
    "Komentarz": "Comment",
    "UUID": "UUID",
    "Rodzic UUID": "ParentUUID",
    "Kwota": "NetAmount",
    "Waluta": "Currency",
    "Nazwa handlowca": "TraderName",
    "Strona": "Side",
}

# Column name mapping for Format 1 (clean / Custom report)
CLEAN_HEADERS = {
    "Godzina": "When",
    "Identyfikator konta": "AccountID",
    "Strona": "Side",
    "ID symbolu": "SymbolID",
    "ISIN": "ISIN",
    "Rodzaj": "InstrumentType",
    "Cena": "Price",
    "Waluta": "Currency",
    "Ilość": "Quantity",
    "Ilosc": "Quantity",  # fallback without special char
    "Prowizje": "Commission",
    "Waluta dla prowizji": "CommissionCurrency",
    "Zysk/Strata": "ProfitLoss",
    "Wolumen obrotu": "TradeVolume",
    "Identyfikator zlecenia": "OrderID",
    "Stan zlecenia": "OrderStatus",
    "Data wartości": "SettlementDate",
    "Data wartosci": "SettlementDate",  # fallback without special char
    "Rodzaj handlu": "TradeType",
    "Identyfikator zlecenia wymiany": "ExchangeOrderID",
}

# Exante operation types we care about
TRADE_OPS = {"TRADE"}
COMMISSION_OPS = {"COMMISSION"}
DIVIDEND_OPS = {"DIVIDEND", "COUPON PAYMENT"}
TAX_OPS = {"US TAX", "TAX"}
SKIP_OPS = {"ROLLOVER", "CUSTODY FEE", "INTEREST", "FUNDING/WITHDRAWAL",
            "AUTOCONVERSION", "SUBACCOUNT TRANSFER", "BANK CHARGE"}


def _safe_decimal(value: str) -> Decimal:
    if not value or value.strip() in ("", "-", "--", "None"):
        return Decimal("0")
    cleaned = value.strip().replace(",", "").replace(" ", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        logger.warning("Could not parse Exante decimal: %r", value)
        return Decimal("0")


def _parse_exante_datetime(value: str) -> datetime:
    value = value.strip().strip('"')
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse Exante datetime: {value!r}")


def _parse_date(value: str) -> date:
    """Parse a date string (YYYY-MM-DD) to date object."""
    value = value.strip().strip('"')
    return datetime.strptime(value, "%Y-%m-%d").date()


def _make_id(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def _decode_exante(content: str | bytes) -> str:
    """Decode Exante file, handling UTF-16 BOM and encoding."""
    if isinstance(content, str):
        return content

    # Try UTF-16 first (Exante's default encoding)
    for encoding in ("utf-16", "utf-16-le", "utf-16-be", "utf-8-sig", "utf-8", "latin-1"):
        try:
            text = content.decode(encoding)
            # Verify it looks like valid data
            if "\t" in text and ("TRADE" in text.upper() or "Rodzaj" in text or "SymbolID" in text.lower()):
                return text.lstrip("\ufeff")
            if encoding in ("utf-8", "latin-1"):
                return text.lstrip("\ufeff")
        except (UnicodeDecodeError, ValueError):
            continue

    return content.decode("utf-16", errors="replace").lstrip("\ufeff")


def _normalize_headers(headers: list[str], mapping: dict[str, str]) -> list[str]:
    """Map Polish headers to canonical English using given mapping."""
    result = []
    for h in headers:
        h_clean = h.strip().strip('"').strip()
        canonical = mapping.get(h_clean, h_clean)
        result.append(canonical)
    return result


def _estimate_settlement(trade_date: date) -> date:
    """T+2 settlement estimate."""
    settle = trade_date
    days_added = 0
    while days_added < 2:
        settle += timedelta(days=1)
        if settle.weekday() < 5:
            days_added += 1
    return settle


def _is_asset_symbol(asset: str) -> bool:
    """Check if asset value is a ticker symbol (not a currency code)."""
    if not asset or asset.strip() in ("", "None"):
        return False
    asset = asset.strip()
    # Currency codes are 3 uppercase letters
    if len(asset) == 3 and asset.isalpha() and asset.isupper():
        return False
    # Symbols contain dots or are longer
    return True


def _is_forex_symbol(symbol: str) -> bool:
    """Check if a symbol is a forex pair (e.g. USD/PLN.E.FX, EUR/USD.E.FX)."""
    if not symbol:
        return False
    s = symbol.strip().upper()
    if ".FX" in s or ".FOREX" in s:
        return True
    if re.match(r"^[A-Z]{3}/[A-Z]{3}", s):
        return True
    return False


def _extract_country_from_comment(comment: str) -> Optional[str]:
    """Extract DivCntry from Exante dividend comment."""
    match = re.search(r"DivCntry\s+(\w{2})", comment)
    if match:
        return match.group(1).upper()
    return None


def _is_clean_header(line: str) -> bool:
    """Check if a line is a Format 1 (clean) header row."""
    fields = [f.strip().strip('"').strip() for f in line.split("\t")]
    # Must have Godzina (or similar time column) + Strona + Cena
    has_time = any(f in ("Godzina", "Time") for f in fields)
    has_side = any(f in ("Strona", "Side") for f in fields)
    has_price = any(f in ("Cena", "Price") for f in fields)
    has_symbol = any(f in ("ID symbolu", "SymbolID") for f in fields)
    return has_time and has_side and has_price and has_symbol


def _is_traditional_header(line: str) -> bool:
    """Check if a line is a Format 2 (traditional) header row."""
    fields = [f.strip().strip('"').strip() for f in line.split("\t")]
    has_op_type = any(f in ("Rodzaj operacji", "OperationType") for f in fields)
    has_amount = any(f in ("Suma", "Amount", "Kwota") for f in fields)
    has_asset = any(f in ("Aktywa", "Asset") for f in fields)
    return has_op_type and has_amount and has_asset


class ExanteParser(BaseParser):
    """Parser for Exante broker CSV/TSV exports."""

    broker_name = "EXANTE"

    @staticmethod
    def detect(file_content: str | bytes, filename: str = "") -> bool:
        text = _decode_exante(file_content)

        indicators = [
            "Rodzaj operacji",
            "OperationType",
            "ID symbolu",
            "SymbolID",
            "Ekwiwalent EUR",
            "EUR equivalent",
            "XEQ",      # Exante account prefix
            "WXS",      # Exante account prefix
            "FCP",      # Exante account prefix
            "WLQ",      # Exante account prefix
            "Godzina",  # Format 1 time column
            "Prowizje", # Format 1 commission column
        ]

        # Need at least 2 indicators for confidence
        matches = sum(1 for ind in indicators if ind in text)
        return matches >= 2

    def parse(self, file_content: str | bytes, filename: str = "") -> list[UnifiedTransaction]:
        text = _decode_exante(file_content)

        lines = [l for l in text.split("\n") if l.strip()]
        if not lines:
            return []

        # Scan for section headers (multi-section files have costs + trades + traditional)
        clean_sections = []      # (header_idx, header_fields) for Format 1
        traditional_idx = None   # line index where Format 2 header starts

        for i, line in enumerate(lines):
            if _is_clean_header(line):
                raw = [f.strip().strip('"').strip() for f in line.split("\t")]
                clean_sections.append((i, raw))
            elif _is_traditional_header(line):
                traditional_idx = i

        # Parse Format 1 (clean trades) if present
        clean_trades: list[UnifiedTransaction] = []
        if clean_sections:
            clean_trades = self._parse_clean_sections(lines, clean_sections, traditional_idx)
            logger.info("Parsed %d clean-format trades from Exante", len(clean_trades))

        # Parse Format 2 (traditional) if present
        traditional_rows: list[dict[str, str]] = []
        if traditional_idx is not None:
            raw_headers = lines[traditional_idx].split("\t")
            headers = _normalize_headers(raw_headers, POLISH_HEADERS)

            for line in lines[traditional_idx + 1:]:
                values = [v.strip().strip('"').strip() for v in line.split("\t")]
                if len(values) < len(headers):
                    values.extend([""] * (len(headers) - len(values)))
                row = dict(zip(headers, values))
                traditional_rows.append(row)

        # Build transactions with priority logic
        transactions: list[UnifiedTransaction] = []

        if clean_trades:
            # Use Format 1 for trades (better data: actual price, settlement date)
            transactions.extend(clean_trades)
        elif traditional_rows:
            # Fallback: use Format 2 for trades
            transactions.extend(self._process_trades(traditional_rows))

        # Always use Format 2 for dividends and taxes (only available there)
        if traditional_rows:
            transactions.extend(self._process_dividends(traditional_rows))
            transactions.extend(self._process_taxes(traditional_rows))

        # If no sections found, try legacy single-header format (old simple files)
        if not clean_sections and traditional_idx is None and lines:
            logger.info("No section headers found, trying legacy single-header parse")
            raw_headers = lines[0].split("\t")
            headers = _normalize_headers(raw_headers, POLISH_HEADERS)
            rows: list[dict[str, str]] = []
            for line in lines[1:]:
                values = [v.strip().strip('"').strip() for v in line.split("\t")]
                if len(values) < len(headers):
                    values.extend([""] * (len(headers) - len(values)))
                row = dict(zip(headers, values))
                rows.append(row)
            transactions.extend(self._process_trades(rows))
            transactions.extend(self._process_dividends(rows))
            transactions.extend(self._process_taxes(rows))

        transactions.sort(key=lambda t: t.trade_date)
        return transactions

    def _parse_clean_sections(
        self,
        lines: list[str],
        clean_sections: list[tuple[int, list[str]]],
        traditional_idx: Optional[int],
    ) -> list[UnifiedTransaction]:
        """Parse Format 1 (clean) trade sections. Multiple header rows may exist."""
        results: list[UnifiedTransaction] = []

        for sec_i, (header_idx, raw_headers) in enumerate(clean_sections):
            headers = _normalize_headers(raw_headers, CLEAN_HEADERS)

            # Data rows go from header_idx+1 to next section header or traditional header
            if sec_i + 1 < len(clean_sections):
                end_idx = clean_sections[sec_i + 1][0]
            elif traditional_idx is not None:
                end_idx = traditional_idx
            else:
                end_idx = len(lines)

            for line in lines[header_idx + 1: end_idx]:
                values = [v.strip().strip('"').strip() for v in line.split("\t")]
                if len(values) < len(headers):
                    values.extend([""] * (len(headers) - len(values)))
                row = dict(zip(headers, values))

                tx = self._parse_one_clean_trade(row)
                if tx:
                    results.append(tx)

        return results

    def _parse_one_clean_trade(self, row: dict[str, str]) -> Optional[UnifiedTransaction]:
        """Parse a single Format 1 trade row into a UnifiedTransaction."""
        try:
            when_str = row.get("When", "").strip()
            if not when_str:
                return None

            symbol = row.get("SymbolID", "").strip()
            if not symbol:
                return None

            # Skip forex and non-TRADE rows
            instrument_type = row.get("InstrumentType", "").strip().upper()
            trade_type = row.get("TradeType", "").strip().upper()
            if instrument_type == "FX_SPOT" or _is_forex_symbol(symbol):
                return None
            if trade_type and trade_type != "TRADE":
                return None

            side = row.get("Side", "").strip().lower()
            if side not in ("buy", "sell"):
                return None

            action = ActionType.BUY if side == "buy" else ActionType.SELL

            qty = _safe_decimal(row.get("Quantity", "0"))
            if qty <= 0:
                return None
            qty = abs(qty)

            price = _safe_decimal(row.get("Price", "0"))
            if price <= 0:
                return None

            currency = row.get("Currency", "USD").strip()
            if not currency or currency == "None":
                currency = "USD"

            commission = abs(_safe_decimal(row.get("Commission", "0")))
            commission_currency = row.get("CommissionCurrency", "").strip()
            if not commission_currency or commission_currency == "None":
                commission_currency = None

            isin_val = row.get("ISIN", "").strip()
            isin = isin_val if isin_val and isin_val != "None" else None

            trade_dt = _parse_exante_datetime(when_str)

            # Use actual settlement date from report (much better than T+2 estimate)
            settle_str = row.get("SettlementDate", "").strip()
            if settle_str:
                try:
                    settle = _parse_date(settle_str)
                except ValueError:
                    settle = _estimate_settlement(trade_dt.date())
            else:
                settle = _estimate_settlement(trade_dt.date())

            row_id = _make_id(f"EX_CLEAN_{symbol}_{when_str}_{qty}_{price}")

            return UnifiedTransaction(
                id=row_id,
                broker=BrokerName.EXANTE,
                symbol=symbol,
                isin=isin,
                description=None,
                trade_date=trade_dt,
                settlement_date=settle,
                action=action,
                quantity=qty,
                price=price,
                currency=currency,
                commission=commission,
                commission_currency=commission_currency,
            )

        except Exception as e:
            logger.warning("Failed to parse clean Exante trade: %s – %s", row.get("SymbolID", "?"), e)
            return None

    def _process_trades(self, rows: list[dict[str, str]]) -> list[UnifiedTransaction]:
        """
        Process TRADE rows (Format 2). Exante uses multi-row trades:
          - Row with asset symbol in 'Asset' column = asset quantity change
          - Row with currency code in 'Asset' column = cash amount
          - COMMISSION row = fee

        We group by (timestamp, symbol_base) to reconstruct full trades.
        """
        results: list[UnifiedTransaction] = []

        # Group: key = (timestamp, symbol_base)
        groups: dict[str, dict] = defaultdict(lambda: {
            "asset_row": None,
            "cash_row": None,
            "commission": Decimal("0"),
            "commission_currency": "",
        })

        for row in rows:
            op = row.get("OperationType", "").strip().upper()
            when = row.get("When", "").strip()
            symbol_id = row.get("SymbolID", "").strip()
            asset = row.get("Asset", "").strip()
            amount = _safe_decimal(row.get("Amount", "0"))

            if op == "TRADE":
                # Determine if this is the asset line or cash line
                if _is_asset_symbol(asset) and asset == symbol_id:
                    # Asset line: qty change
                    key = f"{when}|{symbol_id}"
                    groups[key]["asset_row"] = row
                else:
                    # Cash line: currency amount
                    # Find the matching symbol from this timestamp
                    key = f"{when}|{symbol_id}"
                    groups[key]["cash_row"] = row

            elif op == "COMMISSION":
                # Find the group for this timestamp
                # Commission usually has same timestamp as the trade
                # Try to match by timestamp and symbol
                key = f"{when}|{symbol_id}"
                groups[key]["commission"] = abs(amount)
                groups[key]["commission_currency"] = asset if not _is_asset_symbol(asset) else ""

        for key, group in groups.items():
            asset_row = group["asset_row"]
            cash_row = group["cash_row"]

            if not asset_row:
                continue

            try:
                when_str = asset_row.get("When", "")
                trade_dt = _parse_exante_datetime(when_str)

                symbol = asset_row.get("SymbolID", "").strip()
                if _is_forex_symbol(symbol):
                    continue  # Skip forex conversions

                isin_val = asset_row.get("ISIN", "").strip()
                isin = isin_val if isin_val and isin_val != "None" else None

                qty = _safe_decimal(asset_row.get("Amount", "0"))
                if qty == 0:
                    continue

                if qty < 0:
                    action = ActionType.SELL
                    qty = abs(qty)
                else:
                    action = ActionType.BUY

                # Get price from cash row
                if cash_row:
                    cash_amount = abs(_safe_decimal(cash_row.get("Amount", "0")))
                    currency = cash_row.get("Asset", "USD").strip()
                    if qty > 0:
                        price = (cash_amount / qty).quantize(Decimal("0.000001"))
                    else:
                        price = Decimal("0")
                else:
                    # Fallback: no cash row found
                    price = Decimal("0")
                    currency = "USD"

                commission = group["commission"]
                settle = _estimate_settlement(trade_dt.date())

                tx_id = asset_row.get("TransactionID", "")
                row_id = _make_id(f"EX_{tx_id}_{symbol}_{when_str}")

                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.EXANTE,
                    symbol=symbol,
                    isin=isin,
                    description=None,
                    trade_date=trade_dt,
                    settlement_date=settle,
                    action=action,
                    quantity=qty,
                    price=price,
                    currency=currency,
                    commission=commission,
                    commission_currency=group["commission_currency"] or None,
                ))

            except Exception as e:
                logger.warning("Failed to process Exante trade group %s: %s", key, e)

        return results

    def _process_dividends(self, rows: list[dict[str, str]]) -> list[UnifiedTransaction]:
        """Process DIVIDEND and COUPON PAYMENT rows."""
        results: list[UnifiedTransaction] = []

        for row in rows:
            op = row.get("OperationType", "").strip().upper()
            if op not in DIVIDEND_OPS:
                continue

            try:
                symbol = row.get("SymbolID", "").strip()
                if not symbol or symbol == "None":
                    continue

                when_str = row.get("When", "").strip()
                pay_dt = _parse_exante_datetime(when_str)

                amount = _safe_decimal(row.get("Amount", "0"))
                if amount <= 0:
                    continue  # Skip negative corrections

                currency = row.get("Asset", "USD").strip()
                if _is_asset_symbol(currency):
                    currency = "USD"  # Fallback

                isin_val = row.get("ISIN", "").strip()
                isin = isin_val if isin_val and isin_val != "None" else None

                comment = row.get("Comment", "")
                country = _extract_country_from_comment(comment)

                tx_id = row.get("TransactionID", "")
                row_id = _make_id(f"EX_DIV_{tx_id}_{symbol}")

                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.EXANTE,
                    symbol=symbol,
                    isin=isin,
                    description=comment[:200] if comment else None,
                    trade_date=pay_dt,
                    settlement_date=pay_dt.date(),
                    action=ActionType.DIVIDEND,
                    quantity=abs(amount),
                    price=Decimal("1"),
                    currency=currency,
                    commission=Decimal("0"),
                ))

            except Exception as e:
                logger.warning("Failed to parse Exante dividend: %s – %s", row, e)

        return results

    def _process_taxes(self, rows: list[dict[str, str]]) -> list[UnifiedTransaction]:
        """Process US TAX and TAX rows (withholding tax)."""
        results: list[UnifiedTransaction] = []

        for row in rows:
            op = row.get("OperationType", "").strip().upper()
            if op not in TAX_OPS:
                continue

            try:
                symbol = row.get("SymbolID", "").strip()
                if not symbol or symbol == "None":
                    # Tax recalculation rows without symbol – skip for now
                    continue

                when_str = row.get("When", "").strip()
                pay_dt = _parse_exante_datetime(when_str)

                amount = _safe_decimal(row.get("Amount", "0"))
                # Tax rows with positive amounts are refunds/recalculations
                # We only care about negative (tax paid)
                if amount >= 0:
                    continue

                currency = row.get("Asset", "USD").strip()
                if _is_asset_symbol(currency):
                    currency = "USD"

                isin_val = row.get("ISIN", "").strip()
                isin = isin_val if isin_val and isin_val != "None" else None

                comment = row.get("Comment", "")

                tx_id = row.get("TransactionID", "")
                row_id = _make_id(f"EX_WHT_{tx_id}_{symbol}")

                results.append(UnifiedTransaction(
                    id=row_id,
                    broker=BrokerName.EXANTE,
                    symbol=symbol,
                    isin=isin,
                    description=comment[:200] if comment else None,
                    trade_date=pay_dt,
                    settlement_date=pay_dt.date(),
                    action=ActionType.TAX_WHT,
                    quantity=abs(amount),
                    price=Decimal("1"),
                    currency=currency,
                    commission=Decimal("0"),
                ))

            except Exception as e:
                logger.warning("Failed to parse Exante tax: %s – %s", row, e)

        return results
