"""
NBP (National Bank of Poland) exchange rate client.

Fetches Table A mid-rates and caches them in a local SQLite database.
Implements the business-day-preceding-settlement-date rule.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# NBP API base URL (Table A – mid-rates)
NBP_API_BASE = "https://api.nbp.pl/api/exchangerates/tables/A"

# Polish public holidays (fixed-date ones).  Easter-based ones are computed.
FIXED_HOLIDAYS = {
    (1, 1),   # Nowy Rok
    (1, 6),   # Trzech Kroli
    (5, 1),   # Swieto Pracy
    (5, 3),   # Swieto Konstytucji
    (8, 15),  # Wniebowziecie NMP
    (11, 1),  # Wszystkich Swietych
    (11, 11), # Swieto Niepodleglosci
    (12, 25), # Boze Narodzenie
    (12, 26), # Drugi dzien Bozego Narodzenia
}

DB_PATH = Path(__file__).parent.parent.parent / "nbp_cache.db"


def _easter_date(year: int) -> date:
    """Compute Easter Sunday using the Anonymous Gregorian algorithm."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _polish_holidays(year: int) -> set[date]:
    """Return all Polish public holidays for a given year."""
    holidays = {date(year, m, d) for m, d in FIXED_HOLIDAYS}
    easter = _easter_date(year)
    holidays.add(easter)                          # Wielkanoc
    holidays.add(easter + timedelta(days=1))      # Poniedzialek Wielkanocny
    holidays.add(easter + timedelta(days=49))     # Zielone Swiatki (Pentecost)
    holidays.add(easter + timedelta(days=60))     # Boze Cialo (Corpus Christi)
    return holidays


def is_polish_business_day(d: date) -> bool:
    """Check if a date is a Polish business day (not weekend, not holiday)."""
    if d.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return d not in _polish_holidays(d.year)


def previous_business_day(d: date) -> date:
    """Find the last Polish business day strictly before date d."""
    candidate = d - timedelta(days=1)
    while not is_polish_business_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def settlement_date_for_trade(trade_date: date, exchange_country: str = "") -> date:
    """
    Compute settlement date based on exchange location.
    - US/CA/MX exchanges (after 2024-05-28): T+1
    - All other exchanges: T+2
    """
    us_ca_mx = exchange_country.upper() in ("US", "CA", "MX")
    cutoff = date(2024, 5, 28)

    if us_ca_mx and trade_date >= cutoff:
        offset = 1
    else:
        offset = 2

    settle = trade_date
    days_added = 0
    while days_added < offset:
        settle += timedelta(days=1)
        # Settlement skips weekends (using target market calendar – simplified)
        if settle.weekday() < 5:
            days_added += 1

    return settle


class NbpClient:
    """
    Client for NBP Table A exchange rates with SQLite caching.
    """

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()
        self._http = httpx.Client(timeout=30.0)
        # In-memory cache for holidays per year
        self._holidays_cache: dict[int, set[date]] = {}

    def _init_db(self) -> None:
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS nbp_rates (
                    currency TEXT NOT NULL,
                    rate_date TEXT NOT NULL,
                    mid_rate TEXT NOT NULL,
                    PRIMARY KEY (currency, rate_date)
                )
            """)

    def _get_cached_rate(self, currency: str, rate_date: date) -> Optional[Decimal]:
        with sqlite3.connect(str(self.db_path)) as conn:
            row = conn.execute(
                "SELECT mid_rate FROM nbp_rates WHERE currency = ? AND rate_date = ?",
                (currency.upper(), rate_date.isoformat()),
            ).fetchone()
        if row:
            return Decimal(row[0])
        return None

    def _cache_rate(self, currency: str, rate_date: date, mid_rate: Decimal) -> None:
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO nbp_rates (currency, rate_date, mid_rate) VALUES (?, ?, ?)",
                (currency.upper(), rate_date.isoformat(), str(mid_rate)),
            )

    def _fetch_rate_from_api(self, currency: str, rate_date: date) -> Optional[Decimal]:
        """Fetch a single rate from NBP API for a specific date."""
        url = f"https://api.nbp.pl/api/exchangerates/rates/A/{currency}/{rate_date.isoformat()}/"
        try:
            resp = self._http.get(url, headers={"Accept": "application/json"})
            if resp.status_code == 404:
                return None  # No data for this date (holiday)
            resp.raise_for_status()
            data = resp.json()
            mid = Decimal(str(data["rates"][0]["mid"]))
            self._cache_rate(currency, rate_date, mid)
            return mid
        except httpx.HTTPError as e:
            logger.warning("NBP API error for %s on %s: %s", currency, rate_date, e)
            return None

    def fetch_table_for_year(self, year: int) -> None:
        """
        Pre-fetch and cache all Table A rates for a given year.
        NBP API limits requests to 93 days, so we fetch in ~90-day chunks.
        """
        today = date.today()
        chunk_start = date(year, 1, 1)
        year_end = min(date(year, 12, 31), today)

        if chunk_start > today:
            return  # Future year, no data available

        total_tables = 0
        while chunk_start <= year_end:
            chunk_end = min(chunk_start + timedelta(days=89), year_end)

            url = f"{NBP_API_BASE}/{chunk_start.isoformat()}/{chunk_end.isoformat()}/"
            try:
                resp = self._http.get(url, headers={"Accept": "application/json"})
                if resp.status_code == 404:
                    # No data for this range (e.g. future dates)
                    chunk_start = chunk_end + timedelta(days=1)
                    continue
                resp.raise_for_status()
                tables = resp.json()

                with sqlite3.connect(str(self.db_path)) as conn:
                    for table in tables:
                        table_date = table["effectiveDate"]
                        for rate_entry in table["rates"]:
                            conn.execute(
                                "INSERT OR REPLACE INTO nbp_rates (currency, rate_date, mid_rate) VALUES (?, ?, ?)",
                                (rate_entry["code"].upper(), table_date, str(rate_entry["mid"])),
                            )

                total_tables += len(tables)
            except httpx.HTTPError as e:
                logger.error("Failed to fetch NBP table chunk %s–%s: %s", chunk_start, chunk_end, e)

            chunk_start = chunk_end + timedelta(days=1)

        logger.info("Cached NBP rates for year %d (%d tables)", year, total_tables)

    def get_rate(self, currency: str, for_date: date) -> tuple[Decimal, date]:
        """
        Get NBP mid-rate for a currency on the business day preceding `for_date`.

        The `for_date` should be the settlement date of the transaction.
        Returns (rate, actual_date_used).

        For PLN transactions, returns (1, for_date).
        """
        currency = currency.upper()
        if currency == "PLN":
            return Decimal("1"), for_date

        target = previous_business_day(for_date)

        # Try cache first
        cached = self._get_cached_rate(currency, target)
        if cached is not None:
            return cached, target

        # Try API, going back up to 10 days if needed
        attempts = 0
        candidate = target
        while attempts < 10:
            rate = self._fetch_rate_from_api(currency, candidate)
            if rate is not None:
                return rate, candidate
            candidate = previous_business_day(candidate)
            attempts += 1

        raise ValueError(
            f"Could not find NBP rate for {currency} near {for_date} "
            f"after searching back to {candidate}"
        )

    def get_rate_for_settlement(
        self,
        currency: str,
        trade_date: date,
        exchange_country: str = "",
        settlement_date_override: date | None = None,
    ) -> tuple[Decimal, date]:
        """
        Convenience method: compute settlement date, then get rate
        for the business day preceding it.
        """
        if settlement_date_override:
            settle = settlement_date_override
        else:
            settle = settlement_date_for_trade(trade_date, exchange_country)

        return self.get_rate(currency, settle)
