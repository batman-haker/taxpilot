"""
Parser for mBank eMakler IKE/IKZE portfolio snapshot CSV files.

These are portfolio snapshots (not transaction history), used for portfolio
analysis only. IKE/IKZE accounts are tax-exempt — no PIT-38 implications.

File format:
  - Section markers: "ikze" or "ike" in first column, rest empty
  - Positions: 2-line quoted field (name + exchange/currency), qty, avg price, current price, change%, P&L PLN, value PLN
  - Polish numbers: comma = decimal, space = thousands, currency appended to values
"""

from __future__ import annotations

import csv
import io
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Exchange → country mapping
_EXCHANGE_COUNTRY = {
    "WWA-GPW": "PL",
    "USA-NASDAQ": "US",
    "USA-NYSE": "US",
    "USA-AMEX": "US",
    "DEU-XETRA": "DE",
    "GBR-LSE": "GB",
    "FRA-EURONEXT": "FR",
    "NLD-EURONEXT": "NL",
}


class IkeIkzePosition(BaseModel):
    """One holding from an IKE/IKZE portfolio snapshot."""
    account_type: str          # "IKE" or "IKZE"
    symbol: str                # e.g. "KGHM", "AMAZON.COM"
    exchange: str              # e.g. "WWA-GPW", "USA-NASDAQ"
    currency: str              # e.g. "PLN", "USD", "EUR"
    country: Optional[str] = None
    quantity: Decimal
    avg_buy_price: Decimal     # in original currency
    current_price: Decimal     # in original currency
    change_pct: Decimal        # e.g. 2.36 for +2.36%
    pnl_pln: Decimal           # unrealized P&L in PLN
    market_value_pln: Decimal  # current market value in PLN


class IkeIkzeReport(BaseModel):
    """Complete parsed IKE/IKZE portfolio snapshot."""
    positions: list[IkeIkzePosition] = []
    warnings: list[str] = []

    class Config:
        json_encoders = {Decimal: str}


def _parse_polish_number(raw: str) -> Decimal:
    """Parse a Polish-formatted number: '4 866,00' → Decimal('4866.00')."""
    # Strip currency suffix (PLN, USD, EUR, GBP, etc.)
    cleaned = re.sub(r'[A-Z]{2,4}\s*$', '', raw.strip())
    # Remove thousands separator (space or non-breaking space)
    cleaned = cleaned.replace('\xa0', '').replace(' ', '')
    # Replace comma with dot for decimal
    cleaned = cleaned.replace(',', '.')
    # Remove % sign
    cleaned = cleaned.replace('%', '').strip()
    if not cleaned or cleaned == '-':
        return Decimal("0")
    return Decimal(cleaned)


def _extract_currency(raw: str) -> str:
    """Extract currency code from a value string like '204,0800USD' or '324,40\\nPLN'."""
    # Normalize newlines
    text = raw.replace('\r\n', ' ').replace('\n', ' ').strip()
    match = re.search(r'([A-Z]{2,4})\s*$', text)
    return match.group(1) if match else "PLN"


class IkeIkzeParser:
    """Parser for mBank eMakler IKE/IKZE CSV portfolio snapshots."""

    @staticmethod
    def detect(file_content: str | bytes, filename: str = "") -> bool:
        """Return True if this looks like an IKE/IKZE portfolio snapshot."""
        if isinstance(file_content, bytes):
            for enc in ("utf-8", "cp1250", "latin-1"):
                try:
                    text = file_content.decode(enc)
                    break
                except (UnicodeDecodeError, ValueError):
                    continue
            else:
                return False
        else:
            text = file_content

        lower = text.lower()
        # Must contain at least one section marker
        has_ike = bool(re.search(r'^(?:\s*)ike\s*,', lower, re.MULTILINE))
        has_ikze = bool(re.search(r'^(?:\s*)ikze\s*,', lower, re.MULTILINE))
        if not (has_ike or has_ikze):
            return False

        # Must look like a portfolio snapshot (exchange patterns or PLN values)
        has_exchange = any(ex in text for ex in ("WWA-GPW", "USA-NASDAQ", "USA-NYSE", "DEU-XETRA", "GBR-LSE"))
        has_pln_values = "PLN" in text
        return has_exchange or has_pln_values

    def parse(self, file_content: str | bytes, filename: str = "") -> IkeIkzeReport:
        """Parse the IKE/IKZE portfolio snapshot CSV."""
        if isinstance(file_content, bytes):
            text = None
            for enc in ("utf-8", "cp1250", "latin-1"):
                try:
                    text = file_content.decode(enc)
                    break
                except (UnicodeDecodeError, ValueError):
                    continue
            if text is None:
                raise ValueError(f"Cannot decode file {filename}")
        else:
            text = file_content

        positions: list[IkeIkzePosition] = []
        warnings: list[str] = []
        current_section: Optional[str] = None  # "IKE" or "IKZE"

        reader = csv.reader(io.StringIO(text))
        for row in reader:
            if not row:
                continue

            # Check for section markers
            first = row[0].strip().lower()
            rest_empty = all(cell.strip() == "" for cell in row[1:])

            if first == "ikze" and rest_empty:
                current_section = "IKZE"
                continue
            elif first == "ike" and rest_empty:
                current_section = "IKE"
                continue

            # Skip empty rows
            if all(cell.strip() == "" for cell in row):
                continue

            # Skip if no section yet
            if current_section is None:
                continue

            # Try to parse as a position row
            # Expected: name+exchange (col 0), qty (col 1), avg_price (col 2),
            #           current_price (col 3), change% (col 4), pnl_pln (col 5), value_pln (col 6)
            if len(row) < 7:
                continue

            name_exchange = row[0].strip()
            if not name_exchange:
                continue

            # Parse the 2-line name+exchange field
            lines = name_exchange.replace('\r\n', '\n').split('\n')
            if len(lines) < 2:
                # Single line — might be a header or malformed, skip
                continue

            symbol = lines[0].strip()
            exchange_currency = lines[1].strip()

            # Parse exchange and currency from "WWA-GPW PLN" or "USA-NASDAQ USD"
            parts = exchange_currency.split()
            if len(parts) < 2:
                warnings.append(f"Nie mozna odczytac gieldy/waluty: {exchange_currency}")
                continue

            exchange = parts[0]
            currency = parts[1]

            try:
                qty = Decimal(row[1].strip().replace(' ', '').replace(',', '.'))
            except (InvalidOperation, ValueError):
                warnings.append(f"Nie mozna odczytac ilosci dla {symbol}: {row[1]}")
                continue

            try:
                avg_price = _parse_polish_number(row[2])
                current_price = _parse_polish_number(row[3])
                change_pct = _parse_polish_number(row[4])
                pnl_pln = _parse_polish_number(row[5])
                value_pln = _parse_polish_number(row[6])
            except (InvalidOperation, ValueError) as e:
                warnings.append(f"Blad parsowania danych dla {symbol}: {e}")
                continue

            country = _EXCHANGE_COUNTRY.get(exchange)

            positions.append(IkeIkzePosition(
                account_type=current_section,
                symbol=symbol,
                exchange=exchange,
                currency=currency,
                country=country,
                quantity=qty,
                avg_buy_price=avg_price,
                current_price=current_price,
                change_pct=change_pct,
                pnl_pln=pnl_pln,
                market_value_pln=value_pln,
            ))

        logger.info(
            "Parsed IKE/IKZE snapshot %s: %d positions (%d IKE, %d IKZE)",
            filename,
            len(positions),
            sum(1 for p in positions if p.account_type == "IKE"),
            sum(1 for p in positions if p.account_type == "IKZE"),
        )

        return IkeIkzeReport(positions=positions, warnings=warnings)
