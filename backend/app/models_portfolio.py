"""
Portfolio Analysis models for IBKR Performance/Portfolio Analyst reports.
All monetary values use Decimal for financial precision.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class PAKeyStatistics(BaseModel):
    """Key Statistics section aggregates."""
    beginning_nav: Decimal
    ending_nav: Decimal
    cumulative_return_pct: Decimal
    best_return_pct: Decimal
    best_return_date: Optional[str] = None
    worst_return_pct: Decimal
    worst_return_date: Optional[str] = None
    mtm: Decimal
    deposits_withdrawals: Decimal
    dividends: Decimal
    interest: Decimal
    fees: Decimal


class PAMonthlyReturn(BaseModel):
    """One row from Historical Performance (monthly/quarterly/yearly)."""
    period: str          # e.g. "202401", "2024 Q1", "2024"
    period_type: str     # "month", "quarter", "year"
    return_pct: Optional[Decimal] = None


class PAOpenPosition(BaseModel):
    """One holding from Open Position Summary."""
    symbol: str
    description: str
    financial_instrument: Optional[str] = None
    currency: Optional[str] = None
    sector: Optional[str] = None
    quantity: Decimal
    close_price: Decimal
    value: Decimal
    cost_basis: Decimal
    unrealized_pnl: Decimal


class PATradeSummary(BaseModel):
    """Per-symbol trade summary."""
    financial_instrument: Optional[str] = None
    currency: Optional[str] = None
    symbol: str
    description: str
    sector: Optional[str] = None
    quantity_bought: Decimal
    avg_buy_price: Decimal
    proceeds_bought: Decimal
    quantity_sold: Decimal
    avg_sell_price: Decimal
    proceeds_sold: Decimal


class PADeposit(BaseModel):
    """One deposit/withdrawal entry."""
    entry_date: str
    account: str
    deposit_type: str
    description: str
    amount: Decimal


class PADividend(BaseModel):
    """One dividend entry."""
    pay_date: str
    ex_date: Optional[str] = None
    account: str
    symbol: str
    note: Optional[str] = None
    quantity: Decimal
    dividend_per_share: Decimal
    amount: Decimal


class PASymbolPerformance(BaseModel):
    """One row from Performance by Symbol."""
    symbol: str
    description: str
    financial_instrument: str
    sector: Optional[str] = None
    avg_weight_pct: Decimal
    return_pct: Decimal
    contribution_pct: Decimal
    unrealized_pnl: Decimal
    realized_pnl: Decimal
    is_open: bool


class PADailyNav(BaseModel):
    """One row from Allocation by Asset Class (daily NAV)."""
    nav_date: str
    commodities: Decimal
    equities: Decimal
    fixed_income: Decimal
    real_estate: Decimal
    cash: Decimal
    nav: Decimal


class PACumulativeReturn(BaseModel):
    """One row from Cumulative Performance Statistics."""
    return_date: str
    cumulative_return_pct: Decimal


class PortfolioAnalysisReport(BaseModel):
    """Complete parsed IBKR Performance Report."""
    account_name: str
    period_start: str
    period_end: str
    base_currency: str
    key_statistics: PAKeyStatistics
    monthly_returns: list[PAMonthlyReturn] = []
    open_positions: list[PAOpenPosition] = []
    trade_summaries: list[PATradeSummary] = []
    deposits: list[PADeposit] = []
    dividends_list: list[PADividend] = []
    symbol_performance: list[PASymbolPerformance] = []
    daily_nav: list[PADailyNav] = []
    cumulative_returns: list[PACumulativeReturn] = []
    warnings: list[str] = []

    class Config:
        json_encoders = {Decimal: str}
