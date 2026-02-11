"""
Dividend tax calculator.

Pairs DIVIDEND transactions with their corresponding TAX_WHT entries,
converts to PLN, and computes Polish tax obligations.
"""

from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.models import ActionType, DividendResult, UnifiedTransaction

logger = logging.getLogger(__name__)

POLISH_TAX_RATE = Decimal("0.19")
TWO_PLACES = Decimal("0.01")


def _country_from_isin(isin: Optional[str]) -> Optional[str]:
    """Extract 2-letter country code from ISIN."""
    if isin and len(isin) >= 2 and isin[:2].isalpha():
        return isin[:2].upper()
    return None


class DividendCalculator:
    """
    Calculates tax on dividends received from foreign brokers.

    For each dividend:
      1. Convert gross amount to PLN using NBP rate
      2. Convert withholding tax (WHT) to PLN
      3. Compute Polish tax due (19% of gross PLN)
      4. Compute amount to pay = max(0, polish_tax - WHT_PLN)
    """

    def calculate(
        self, transactions: list[UnifiedTransaction]
    ) -> list[DividendResult]:
        """
        Process all DIVIDEND and TAX_WHT transactions.
        Returns a list of DividendResult objects.
        """
        dividends = [t for t in transactions if t.action == ActionType.DIVIDEND]
        wht_entries = [t for t in transactions if t.action == ActionType.TAX_WHT]

        results: list[DividendResult] = []

        for div in dividends:
            # Find matching WHT entry (same symbol, same date or close date)
            wht = self._find_matching_wht(div, wht_entries)

            div_rate = div.nbp_rate or Decimal("1")
            gross_pln = (div.quantity * div.price * div_rate).quantize(
                TWO_PLACES, ROUND_HALF_UP
            )

            if wht:
                wht_rate = wht.nbp_rate or Decimal("1")
                wht_amount = abs(wht.quantity * wht.price)
                wht_pln = (wht_amount * wht_rate).quantize(
                    TWO_PLACES, ROUND_HALF_UP
                )
            else:
                wht_amount = Decimal("0")
                wht_pln = Decimal("0")
                wht_rate = Decimal("1")

            polish_tax = (gross_pln * POLISH_TAX_RATE).quantize(
                TWO_PLACES, ROUND_HALF_UP
            )
            to_pay = max(Decimal("0"), polish_tax - wht_pln)

            country = _country_from_isin(div.isin)

            results.append(
                DividendResult(
                    symbol=div.symbol,
                    isin=div.isin,
                    country=country,
                    pay_date=div.trade_date.date(),
                    currency=div.currency,
                    gross_amount=div.quantity * div.price,
                    gross_amount_pln=gross_pln,
                    nbp_rate=div_rate,
                    wht_amount=wht_amount,
                    wht_amount_pln=wht_pln,
                    wht_nbp_rate=wht_rate,
                    polish_tax_due=polish_tax,
                    tax_to_pay_poland=to_pay,
                )
            )

        return results

    def _find_matching_wht(
        self,
        dividend: UnifiedTransaction,
        wht_entries: list[UnifiedTransaction],
    ) -> Optional[UnifiedTransaction]:
        """
        Find the WHT entry matching a dividend.
        Match by symbol and same date (or closest date within 5 days).
        """
        candidates = [
            w for w in wht_entries
            if w.symbol == dividend.symbol
        ]

        if not candidates:
            return None

        # Prefer exact date match
        for w in candidates:
            if w.trade_date.date() == dividend.trade_date.date():
                return w

        # Fallback: closest date within 5 days
        div_date = dividend.trade_date.date()
        candidates.sort(key=lambda w: abs((w.trade_date.date() - div_date).days))
        best = candidates[0]
        if abs((best.trade_date.date() - div_date).days) <= 5:
            return best

        logger.warning(
            "No matching WHT found for dividend %s on %s",
            dividend.symbol,
            dividend.trade_date.date(),
        )
        return None
