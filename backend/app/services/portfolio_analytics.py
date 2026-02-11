"""
Lifetime portfolio analytics calculator.

Computes cross-year portfolio metrics from unfiltered FIFO matches,
all dividend results, and open positions.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from app.models import (
    DividendResult,
    FifoMatch,
    OpenPosition,
    PortfolioMetrics,
    PortfolioReport,
    SymbolLifetimeSummary,
    YearSummary,
)

TWO_PLACES = Decimal("0.01")
POLISH_TAX_RATE = Decimal("0.19")


def _to_date(dt):
    """Normalize datetime or date to date."""
    return dt.date() if hasattr(dt, "date") and callable(dt.date) else dt


class PortfolioAnalytics:
    """Computes lifetime portfolio report from complete (unfiltered) data."""

    def compute(
        self,
        all_matches: list[FifoMatch],
        all_dividends: list[DividendResult],
        open_positions: list[OpenPosition],
    ) -> PortfolioReport:
        year_summaries = self._build_year_summaries(all_matches, all_dividends)
        symbol_summaries = self._build_symbol_summaries(
            all_matches, all_dividends, open_positions
        )
        metrics = self._build_metrics(all_matches, all_dividends)

        return PortfolioReport(
            year_summaries=year_summaries,
            symbol_summaries=symbol_summaries,
            metrics=metrics,
        )

    # ------------------------------------------------------------------
    # Year-by-year
    # ------------------------------------------------------------------

    def _build_year_summaries(
        self,
        matches: list[FifoMatch],
        dividends: list[DividendResult],
    ) -> list[YearSummary]:
        year_data: dict[int, dict] = defaultdict(lambda: {
            "revenue": Decimal("0"),
            "costs": Decimal("0"),
            "div_gross": Decimal("0"),
            "div_wht": Decimal("0"),
            "div_to_pay": Decimal("0"),
            "num_trades": 0,
        })

        for m in matches:
            y = _to_date(m.sell_date).year
            year_data[y]["revenue"] += m.sell_revenue_pln
            year_data[y]["costs"] += m.buy_cost_pln
            year_data[y]["num_trades"] += 1

        for d in dividends:
            y = _to_date(d.pay_date).year
            year_data[y]["div_gross"] += d.gross_amount_pln
            year_data[y]["div_wht"] += d.wht_amount_pln
            year_data[y]["div_to_pay"] += d.tax_to_pay_poland

        result = []
        for year in sorted(year_data.keys()):
            d = year_data[year]
            profit = d["revenue"] - d["costs"]
            tax = max(
                Decimal("0"),
                (profit * POLISH_TAX_RATE).quantize(TWO_PLACES, ROUND_HALF_UP),
            )
            result.append(YearSummary(
                year=year,
                revenue_pln=d["revenue"].quantize(TWO_PLACES, ROUND_HALF_UP),
                costs_pln=d["costs"].quantize(TWO_PLACES, ROUND_HALF_UP),
                profit_pln=profit.quantize(TWO_PLACES, ROUND_HALF_UP),
                tax_19_pln=tax,
                dividends_gross_pln=d["div_gross"].quantize(TWO_PLACES, ROUND_HALF_UP),
                dividends_wht_pln=d["div_wht"].quantize(TWO_PLACES, ROUND_HALF_UP),
                dividends_tax_to_pay_pln=d["div_to_pay"].quantize(TWO_PLACES, ROUND_HALF_UP),
                num_trades=d["num_trades"],
            ))
        return result

    # ------------------------------------------------------------------
    # Per-symbol lifetime
    # ------------------------------------------------------------------

    def _build_symbol_summaries(
        self,
        matches: list[FifoMatch],
        dividends: list[DividendResult],
        open_positions: list[OpenPosition],
    ) -> list[SymbolLifetimeSummary]:
        sym: dict[str, dict] = defaultdict(lambda: {
            "bought_qty": Decimal("0"),
            "sold_qty": Decimal("0"),
            "remaining_qty": Decimal("0"),
            "buy_cost_pln": Decimal("0"),
            "sell_revenue_pln": Decimal("0"),
            "open_cost_pln": Decimal("0"),
            "dividends_pln": Decimal("0"),
            "currency": "",
            "dates": [],
            "trades_count": 0,
            "weighted_price_sum": Decimal("0"),
            "weighted_qty_sum": Decimal("0"),
        })

        for m in matches:
            s = sym[m.symbol]
            s["sold_qty"] += m.quantity
            s["bought_qty"] += m.quantity
            s["buy_cost_pln"] += m.buy_cost_pln
            s["sell_revenue_pln"] += m.sell_revenue_pln
            s["currency"] = m.buy_currency
            s["dates"].append(_to_date(m.buy_date))
            s["dates"].append(_to_date(m.sell_date))
            s["trades_count"] += 1
            s["weighted_price_sum"] += m.buy_price * m.quantity
            s["weighted_qty_sum"] += m.quantity

        for op in open_positions:
            s = sym[op.symbol]
            s["remaining_qty"] += op.quantity
            s["bought_qty"] += op.quantity
            s["open_cost_pln"] += op.cost_pln
            s["buy_cost_pln"] += op.cost_pln
            s["currency"] = op.currency
            s["dates"].append(_to_date(op.buy_date))
            s["weighted_price_sum"] += op.buy_price * op.quantity
            s["weighted_qty_sum"] += op.quantity

        for d in dividends:
            s = sym[d.symbol]
            s["dividends_pln"] += d.gross_amount_pln
            s["dates"].append(_to_date(d.pay_date))

        result = []
        for symbol in sorted(sym.keys()):
            s = sym[symbol]
            if not s["dates"]:
                continue

            dates = sorted(s["dates"])
            avg_price = (
                (s["weighted_price_sum"] / s["weighted_qty_sum"]).quantize(TWO_PLACES, ROUND_HALF_UP)
                if s["weighted_qty_sum"] > 0 else Decimal("0")
            )

            # Realized P&L = sell revenue - cost of SOLD portion only
            sold_cost = s["buy_cost_pln"] - s["open_cost_pln"]
            realized = s["sell_revenue_pln"] - sold_cost

            result.append(SymbolLifetimeSummary(
                symbol=symbol,
                total_bought_qty=s["bought_qty"],
                total_sold_qty=s["sold_qty"],
                remaining_qty=s["remaining_qty"],
                avg_buy_price=avg_price,
                currency=s["currency"] or "USD",
                total_buy_cost_pln=s["buy_cost_pln"].quantize(TWO_PLACES, ROUND_HALF_UP),
                total_sell_revenue_pln=s["sell_revenue_pln"].quantize(TWO_PLACES, ROUND_HALF_UP),
                realized_pnl_pln=realized.quantize(TWO_PLACES, ROUND_HALF_UP),
                dividends_pln=s["dividends_pln"].quantize(TWO_PLACES, ROUND_HALF_UP),
                first_trade_date=dates[0].isoformat(),
                last_trade_date=dates[-1].isoformat(),
                trades_count=s["trades_count"],
            ))

        # Sort by realized P&L descending (best performers first)
        result.sort(key=lambda x: x.realized_pnl_pln, reverse=True)
        return result

    # ------------------------------------------------------------------
    # Overall metrics
    # ------------------------------------------------------------------

    def _build_metrics(
        self,
        matches: list[FifoMatch],
        dividends: list[DividendResult],
    ) -> PortfolioMetrics:
        total_invested = sum((m.buy_cost_pln for m in matches), Decimal("0"))
        total_revenue = sum((m.sell_revenue_pln for m in matches), Decimal("0"))
        total_profit = total_revenue - total_invested

        total_commissions = sum(
            (m.buy_commission * m.buy_nbp_rate + m.sell_commission * m.sell_nbp_rate
             for m in matches),
            Decimal("0"),
        )

        total_div_gross = sum((d.gross_amount_pln for d in dividends), Decimal("0"))
        total_wht = sum((d.wht_amount_pln for d in dividends), Decimal("0"))

        total = len(matches)
        winning = sum(1 for m in matches if m.profit_pln > 0)
        losing = sum(1 for m in matches if m.profit_pln < 0)
        breakeven = total - winning - losing

        win_rate = (
            (Decimal(winning) / Decimal(total) * 100).quantize(TWO_PLACES, ROUND_HALF_UP)
            if total > 0 else Decimal("0")
        )

        avg_profit = (
            (total_profit / Decimal(total)).quantize(TWO_PLACES, ROUND_HALF_UP)
            if total > 0 else Decimal("0")
        )

        # Average holding period
        holding_days = []
        for m in matches:
            buy_d = _to_date(m.buy_date)
            sell_d = _to_date(m.sell_date)
            delta = (sell_d - buy_d).days
            if delta >= 0:
                holding_days.append(delta)

        avg_holding = (
            Decimal(str(round(sum(holding_days) / len(holding_days), 1)))
            if holding_days else Decimal("0")
        )

        # Account age & date range
        all_dates = []
        for m in matches:
            all_dates.append(_to_date(m.buy_date))
            all_dates.append(_to_date(m.sell_date))
        for d in dividends:
            all_dates.append(_to_date(d.pay_date))

        if all_dates:
            all_dates.sort()
            first_trade = all_dates[0].isoformat()
            last_trade = all_dates[-1].isoformat()
            account_age = (all_dates[-1] - all_dates[0]).days
        else:
            first_trade = ""
            last_trade = ""
            account_age = 0

        unique_symbols = len(set(m.symbol for m in matches))

        return PortfolioMetrics(
            total_invested_pln=total_invested.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_revenue_pln=total_revenue.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_realized_profit_pln=total_profit.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_commissions_pln=total_commissions.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_dividends_gross_pln=total_div_gross.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_wht_paid_pln=total_wht.quantize(TWO_PLACES, ROUND_HALF_UP),
            total_trades=total,
            winning_trades=winning,
            losing_trades=losing,
            breakeven_trades=breakeven,
            win_rate_percent=win_rate,
            avg_profit_per_trade_pln=avg_profit,
            avg_holding_period_days=avg_holding,
            account_age_days=account_age,
            first_trade_date=first_trade,
            last_trade_date=last_trade,
            unique_symbols_traded=unique_symbols,
        )
