"""
Tax report generator.

Aggregates FIFO matches and dividend results into PIT-38 and PIT/ZG output.
"""

from __future__ import annotations

import math
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.models import (
    ActionType,
    CapitalGainsSummary,
    CountryBreakdown,
    DividendResult,
    DividendSummary,
    FifoMatch,
    OpenPosition,
    TaxReport,
    UnifiedTransaction,
)
from app.services.dividend_calc import DividendCalculator
from app.services.fifo_engine import FifoEngine, FifoResult
from app.services.nbp_client import NbpClient
from app.services.portfolio_analytics import PortfolioAnalytics

TWO_PLACES = Decimal("0.01")
POLISH_TAX_RATE = Decimal("0.19")

# Mapping of ISIN country prefix to human-readable name (common ones)
COUNTRY_NAMES = {
    "US": "Stany Zjednoczone",
    "IE": "Irlandia",
    "LU": "Luksemburg",
    "DE": "Niemcy",
    "GB": "Wielka Brytania",
    "NL": "Holandia",
    "FR": "Francja",
    "CH": "Szwajcaria",
    "JP": "Japonia",
    "CA": "Kanada",
    "AU": "Australia",
    "HK": "Hongkong",
    "KY": "Kajmany",
    "BM": "Bermudy",
    "JE": "Jersey",
    "SE": "Szwecja",
    "DK": "Dania",
    "FI": "Finlandia",
    "NO": "Norwegia",
    "ES": "Hiszpania",
    "IT": "Wlochy",
    "BE": "Belgia",
    "AT": "Austria",
    "PT": "Portugalia",
    "PL": "Polska",
    "CZ": "Czechy",
    "IL": "Izrael",
    "SG": "Singapur",
    "TW": "Tajwan",
    "KR": "Korea Poludniowa",
    "BR": "Brazylia",
    "MX": "Meksyk",
    "IN": "Indie",
    "CN": "Chiny",
}


def _round_to_full_pln(value: Decimal) -> Decimal:
    """Round to full PLN as required by Polish tax law (Ordynacja Podatkowa)."""
    return Decimal(math.floor(value + Decimal("0.5")))


def _country_from_isin(isin: Optional[str]) -> Optional[str]:
    if isin and len(isin) >= 2 and isin[:2].isalpha():
        return isin[:2].upper()
    return None


class TaxReportGenerator:
    """
    Orchestrates the full tax calculation pipeline:
      1. Enrich transactions with NBP rates
      2. Run FIFO engine
      3. Calculate dividend taxes
      4. Aggregate into PIT-38 / PIT-ZG format
    """

    def __init__(self, nbp_client: NbpClient):
        self.nbp = nbp_client
        self.fifo = FifoEngine()
        self.div_calc = DividendCalculator()
        self.portfolio_analytics = PortfolioAnalytics()

    def generate(
        self,
        transactions: list[UnifiedTransaction],
        tax_year: int,
        prior_year_losses: Optional[Decimal] = None,
    ) -> TaxReport:
        """
        Generate a complete tax report for the given year.

        Args:
            transactions: All parsed transactions (may span multiple years).
            tax_year: The year to generate the report for.
            prior_year_losses: Optional accumulated loss from prior years
                               (user-provided, max 50% per year).
        """
        warnings: list[str] = []

        # Step 1: Enrich with NBP rates
        self._enrich_nbp_rates(transactions, warnings)

        # Step 2: Filter to relevant transactions
        #   - For FIFO: we need ALL buys (including prior years) but only sells in tax_year
        #   - For dividends: only those in tax_year
        all_buys_sells = [
            t for t in transactions
            if t.action in (ActionType.BUY, ActionType.SELL)
        ]
        year_divs = [
            t for t in transactions
            if t.action in (ActionType.DIVIDEND, ActionType.TAX_WHT)
            and t.trade_date.year == tax_year
        ]

        # Step 3: FIFO matching (uses all history for buys, filters results to tax_year)
        fifo_result = self.fifo.process(all_buys_sells)
        warnings.extend(fifo_result.warnings)

        # Filter matches to tax_year:
        # - Regular trades: tax event = sell date
        # - Short sells: tax event = buy date (when position is closed/covered)
        year_matches = [
            m for m in fifo_result.matches
            if (m.is_short and m.buy_date.year == tax_year)
            or (not m.is_short and m.sell_date.year == tax_year)
        ]

        # Step 4: Capital gains summary
        total_revenue = sum((m.sell_revenue_pln for m in year_matches), Decimal("0"))
        total_costs = sum((m.buy_cost_pln for m in year_matches), Decimal("0"))
        profit = total_revenue - total_costs

        # Apply prior year losses (max 50% per year, capped at profit)
        if prior_year_losses and prior_year_losses > 0 and profit > 0:
            max_deduction = (prior_year_losses * Decimal("0.5")).quantize(
                TWO_PLACES, ROUND_HALF_UP
            )
            actual_deduction = min(max_deduction, profit)
            profit -= actual_deduction
            warnings.append(
                f"Odliczono strate z lat ubieglych: {actual_deduction} PLN "
                f"(50% z {prior_year_losses} PLN)"
            )

        tax_due = max(
            Decimal("0"),
            _round_to_full_pln(profit * POLISH_TAX_RATE),
        )

        capital_gains = CapitalGainsSummary(
            revenue_pln=total_revenue.quantize(TWO_PLACES, ROUND_HALF_UP),
            costs_pln=total_costs.quantize(TWO_PLACES, ROUND_HALF_UP),
            profit_pln=profit.quantize(TWO_PLACES, ROUND_HALF_UP),
            tax_due=tax_due,
            matches=year_matches,
        )

        # Step 5: Dividend calculation
        div_results = self.div_calc.calculate(year_divs)
        dividends = DividendSummary(
            total_gross_pln=sum((d.gross_amount_pln for d in div_results), Decimal("0")),
            total_wht_pln=sum((d.wht_amount_pln for d in div_results), Decimal("0")),
            total_polish_tax_due=sum((d.polish_tax_due for d in div_results), Decimal("0")),
            total_to_pay_pln=sum((d.tax_to_pay_poland for d in div_results), Decimal("0")),
            items=div_results,
        )

        # Step 6: PIT/ZG country breakdown
        pit_zg = self._build_country_breakdown(year_matches, div_results)

        # Step 7: Open positions (unsold lots)
        open_pos = []
        for symbol, lots in fifo_result.open_positions.items():
            for lot in lots:
                tx = lot.transaction
                rate = tx.nbp_rate or Decimal("1")
                cost = (tx.price * lot.remaining_qty * rate).quantize(
                    TWO_PLACES, ROUND_HALF_UP
                )
                open_pos.append(OpenPosition(
                    symbol=symbol,
                    quantity=lot.remaining_qty,
                    buy_date=tx.trade_date.date(),
                    buy_price=tx.price,
                    currency=tx.currency,
                    cost_pln=cost,
                    nbp_rate=rate,
                ))

        # Step 8: Portfolio analytics (all years, unfiltered)
        portfolio = None
        try:
            all_divs_tx = [
                t for t in transactions
                if t.action in (ActionType.DIVIDEND, ActionType.TAX_WHT)
            ]
            all_div_results = self.div_calc.calculate(all_divs_tx)
            portfolio = self.portfolio_analytics.compute(
                all_matches=fifo_result.matches,
                all_dividends=all_div_results,
                open_positions=open_pos,
            )
        except Exception as e:
            warnings.append(f"Blad analizy portfela: {e}")

        return TaxReport(
            tax_year=tax_year,
            capital_gains=capital_gains,
            dividends=dividends,
            pit_zg=pit_zg,
            open_positions=open_pos,
            warnings=warnings,
            portfolio=portfolio,
        )

    def _enrich_nbp_rates(
        self,
        transactions: list[UnifiedTransaction],
        warnings: list[str],
    ) -> None:
        """Populate nbp_rate and amount_pln for each transaction."""
        # Collect years for pre-fetching
        years = {t.trade_date.year for t in transactions}
        for year in years:
            try:
                self.nbp.fetch_table_for_year(year)
            except Exception as e:
                warnings.append(f"Nie udalo sie pobrac kursow NBP za {year}: {e}")

        for tx in transactions:
            if tx.currency.upper() == "PLN":
                tx.nbp_rate = Decimal("1")
                tx.nbp_rate_date = tx.settlement_date
                tx.amount_pln = (tx.price * tx.quantity).quantize(
                    TWO_PLACES, ROUND_HALF_UP
                )
                tx.commission_pln = tx.commission.quantize(TWO_PLACES, ROUND_HALF_UP)
                continue

            try:
                rate, rate_date = self.nbp.get_rate(tx.currency, tx.settlement_date)
                tx.nbp_rate = rate
                tx.nbp_rate_date = rate_date
                tx.amount_pln = (tx.price * tx.quantity * rate).quantize(
                    TWO_PLACES, ROUND_HALF_UP
                )
                # Handle commission in different currency
                comm_currency = tx.commission_currency or tx.currency
                if comm_currency.upper() == tx.currency.upper():
                    tx.commission_pln = (tx.commission * rate).quantize(
                        TWO_PLACES, ROUND_HALF_UP
                    )
                elif comm_currency.upper() == "PLN":
                    tx.commission_pln = tx.commission
                else:
                    comm_rate, _ = self.nbp.get_rate(comm_currency, tx.settlement_date)
                    tx.commission_pln = (tx.commission * comm_rate).quantize(
                        TWO_PLACES, ROUND_HALF_UP
                    )
            except ValueError as e:
                warnings.append(
                    f"Blad kursu NBP dla {tx.symbol} na dzien {tx.settlement_date}: {e}"
                )
                tx.nbp_rate = Decimal("1")
                tx.amount_pln = (tx.price * tx.quantity).quantize(
                    TWO_PLACES, ROUND_HALF_UP
                )

    def _build_country_breakdown(
        self,
        matches: list[FifoMatch],
        div_results: list[DividendResult],
    ) -> list[CountryBreakdown]:
        """Build PIT/ZG country-by-country breakdown."""
        country_data: dict[str, dict] = defaultdict(
            lambda: {
                "capital_gains_pln": Decimal("0"),
                "dividend_income_pln": Decimal("0"),
                "tax_paid_abroad_pln": Decimal("0"),
            }
        )

        # Capital gains by country (we'd need ISIN from the match,
        # but FifoMatch doesn't carry it – we derive from symbol heuristics)
        # For MVP: group all capital gains under a generic bucket
        # TODO: enrich FifoMatch with ISIN/country in a future version
        for match in matches:
            # Simple heuristic: if symbol contains ".", take suffix as exchange hint
            country = self._guess_country_from_symbol(match.symbol)
            if match.profit_pln != Decimal("0"):
                country_data[country]["capital_gains_pln"] += match.profit_pln

        # Dividends by country
        for div in div_results:
            country = div.country or "XX"
            country_data[country]["dividend_income_pln"] += div.gross_amount_pln
            country_data[country]["tax_paid_abroad_pln"] += div.wht_amount_pln

        result = []
        for code, data in sorted(country_data.items()):
            result.append(
                CountryBreakdown(
                    country_code=code,
                    country_name=COUNTRY_NAMES.get(code, code),
                    capital_gains_pln=data["capital_gains_pln"].quantize(
                        TWO_PLACES, ROUND_HALF_UP
                    ),
                    dividend_income_pln=data["dividend_income_pln"].quantize(
                        TWO_PLACES, ROUND_HALF_UP
                    ),
                    tax_paid_abroad_pln=data["tax_paid_abroad_pln"].quantize(
                        TWO_PLACES, ROUND_HALF_UP
                    ),
                )
            )

        return result

    @staticmethod
    def _guess_country_from_symbol(symbol: str) -> str:
        """
        Heuristic to guess country from symbol suffix.
        e.g. VWCE.DE -> DE, AAPL (no suffix) -> US
        """
        if "." in symbol:
            suffix = symbol.rsplit(".", 1)[-1].upper()
            # Common exchange suffixes
            exchange_to_country = {
                "DE": "DE",
                "L": "GB",
                "AS": "NL",
                "PA": "FR",
                "MI": "IT",
                "MC": "ES",
                "SW": "CH",
                "TO": "CA",
                "AX": "AU",
                "HK": "HK",
                "T": "JP",
                "SS": "SE",
                "CO": "DK",
                "HE": "FI",
                "OL": "NO",
                "WA": "PL",
            }
            return exchange_to_country.get(suffix, suffix)
        # Default: assume US for plain symbols
        return "US"
