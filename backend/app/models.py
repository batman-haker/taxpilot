"""
Core data models for TaxPilot.
All monetary values use Decimal for financial precision.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ActionType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    DIVIDEND = "DIVIDEND"
    TAX_WHT = "TAX_WHT"       # Withholding tax deducted at source
    FEE = "FEE"               # Standalone fee (rare)
    CORPORATE_ACTION = "CORP"  # Splits, spin-offs, etc.


class BrokerName(str, Enum):
    IBKR = "IBKR"
    EXANTE = "EXANTE"
    REVOLUT = "REVOLUT"
    MANUAL = "MANUAL"


# ---------------------------------------------------------------------------
# Unified Transaction – the "Gold Standard" internal format
# ---------------------------------------------------------------------------

class UnifiedTransaction(BaseModel):
    """Every broker file is normalised into this schema before calculations."""

    id: str = Field(description="Unique identifier (UUID or row hash)")
    broker: str = Field(description="Broker label, e.g. IBKR, EXANTE, EXANTE (FCP0101)")
    symbol: str = Field(description="Ticker symbol, e.g. AAPL, VWCE.DE")
    isin: Optional[str] = Field(default=None, description="ISIN code for country identification")
    country: Optional[str] = Field(default=None, description="ISO 2-letter country code (from ISIN, broker data, or comment)")
    description: Optional[str] = Field(default=None, description="Instrument description from broker")

    trade_date: datetime = Field(description="Date/time the trade was executed")
    settlement_date: date = Field(description="Settlement date (T+1 or T+2)")

    action: ActionType
    quantity: Decimal = Field(description="Number of units (always positive)")
    price: Decimal = Field(description="Price per unit in original currency")
    currency: str = Field(description="Original currency code, e.g. USD, EUR")
    commission: Decimal = Field(default=Decimal("0"), description="Commission in original currency")
    commission_currency: Optional[str] = Field(default=None, description="Currency of commission (if different)")

    # Computed later by NBP service
    nbp_rate: Optional[Decimal] = Field(default=None, description="NBP mid rate for settlement_date - 1 business day")
    nbp_rate_date: Optional[date] = Field(default=None, description="Actual date used for NBP rate")
    amount_pln: Optional[Decimal] = Field(default=None, description="Total value in PLN")
    commission_pln: Optional[Decimal] = Field(default=None, description="Commission in PLN")

    class Config:
        json_encoders = {Decimal: str}


# ---------------------------------------------------------------------------
# FIFO matching result
# ---------------------------------------------------------------------------

class FifoMatch(BaseModel):
    """Represents one matched pair: a (portion of) buy matched with a (portion of) sell."""

    symbol: str
    quantity: Decimal

    buy_date: datetime
    buy_settlement_date: date
    buy_price: Decimal
    buy_currency: str
    buy_commission: Decimal
    buy_nbp_rate: Decimal
    buy_cost_pln: Decimal          # (price * qty + commission) * nbp_rate

    sell_date: datetime
    sell_settlement_date: date
    sell_price: Decimal
    sell_currency: str
    sell_commission: Decimal
    sell_nbp_rate: Decimal
    sell_revenue_pln: Decimal      # (price * qty - commission) * nbp_rate

    profit_pln: Decimal            # sell_revenue_pln - buy_cost_pln
    is_orphan: bool = False        # True if sell had no matching buy (cost=0)
    is_short: bool = False         # True if short sell (sell before buy)
    broker: Optional[str] = None   # Broker name (IBKR, EXANTE, MANUAL, etc.)


# ---------------------------------------------------------------------------
# Dividend calculation result
# ---------------------------------------------------------------------------

class DividendResult(BaseModel):
    """Tax calculation for a single dividend event."""

    symbol: str
    isin: Optional[str] = None
    country: Optional[str] = None  # 2-letter ISO from ISIN
    pay_date: date
    currency: str

    gross_amount: Decimal          # Dividend before any tax
    gross_amount_pln: Decimal
    nbp_rate: Decimal

    wht_amount: Decimal            # Withholding tax paid abroad
    wht_amount_pln: Decimal
    wht_nbp_rate: Decimal

    polish_tax_due: Decimal        # 19% of gross_amount_pln
    tax_to_pay_poland: Decimal     # max(0, polish_tax_due - wht_amount_pln)
    broker: Optional[str] = None   # Broker name


# ---------------------------------------------------------------------------
# Tax Report – final output
# ---------------------------------------------------------------------------

class CapitalGainsSummary(BaseModel):
    """PIT-38 Section C: Capital gains from securities."""
    revenue_pln: Decimal           # Pole 22 – Przychod
    costs_pln: Decimal             # Pole 23 – Koszty uzyskania przychodu
    profit_pln: Decimal            # Pole 26 – Dochod (if positive) / Strata (if negative)
    tax_due: Decimal               # 19% of profit (rounded to full PLN)
    matches: list[FifoMatch] = []  # Detailed breakdown


class DividendSummary(BaseModel):
    """Dividend tax summary."""
    total_gross_pln: Decimal
    total_wht_pln: Decimal         # Foreign tax already paid
    total_polish_tax_due: Decimal  # 19% of gross
    total_to_pay_pln: Decimal      # Difference to pay in Poland
    items: list[DividendResult] = []


class CountryBreakdown(BaseModel):
    """PIT/ZG attachment – income per country."""
    country_code: str
    country_name: str
    capital_gains_pln: Decimal
    dividend_income_pln: Decimal
    tax_paid_abroad_pln: Decimal


class OpenPosition(BaseModel):
    """An unsold (open) position remaining after FIFO matching."""
    symbol: str
    quantity: Decimal
    buy_date: date
    buy_price: Decimal
    currency: str
    cost_pln: Decimal              # buy_price * qty * nbp_rate
    nbp_rate: Decimal
    broker: Optional[str] = None   # Broker name (IBKR, EXANTE, MANUAL, etc.)


class ShortPosition(BaseModel):
    """An open short position (e.g. written option not yet closed/expired)."""
    symbol: str
    quantity: Decimal
    sell_date: date
    sell_price: Decimal
    currency: str
    revenue_pln: Decimal           # sell_price * qty * nbp_rate
    nbp_rate: Decimal
    broker: Optional[str] = None


class TaxReport(BaseModel):
    """Complete tax report for a given year."""
    tax_year: int
    capital_gains: CapitalGainsSummary
    dividends: DividendSummary
    pit_zg: list[CountryBreakdown] = []
    open_positions: list["OpenPosition"] = []
    open_short_positions: list["ShortPosition"] = []
    warnings: list[str] = []       # Missing buy records, unrecognised rows, etc.
    portfolio: Optional["PortfolioReport"] = None  # Lifetime portfolio analytics


# ---------------------------------------------------------------------------
# Lifetime Portfolio Report
# ---------------------------------------------------------------------------

class YearSummary(BaseModel):
    """One row in the year-by-year summary table."""
    year: int
    revenue_pln: Decimal
    costs_pln: Decimal
    profit_pln: Decimal
    tax_19_pln: Decimal
    dividends_gross_pln: Decimal
    dividends_wht_pln: Decimal
    dividends_tax_to_pay_pln: Decimal
    num_trades: int


class SymbolLifetimeSummary(BaseModel):
    """Per-symbol lifetime aggregation."""
    symbol: str
    total_bought_qty: Decimal
    total_sold_qty: Decimal
    remaining_qty: Decimal
    avg_buy_price: Decimal
    currency: str
    total_buy_cost_pln: Decimal
    total_sell_revenue_pln: Decimal
    realized_pnl_pln: Decimal
    dividends_pln: Decimal
    first_trade_date: str
    last_trade_date: str
    trades_count: int


class PortfolioMetrics(BaseModel):
    """Overall portfolio-level aggregate metrics."""
    total_invested_pln: Decimal
    total_revenue_pln: Decimal
    total_realized_profit_pln: Decimal
    total_commissions_pln: Decimal
    total_dividends_gross_pln: Decimal
    total_wht_paid_pln: Decimal
    total_trades: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate_percent: Decimal
    avg_profit_per_trade_pln: Decimal
    avg_holding_period_days: Decimal
    account_age_days: int
    first_trade_date: str
    last_trade_date: str
    unique_symbols_traded: int


class PortfolioReport(BaseModel):
    """Comprehensive lifetime portfolio analysis."""
    year_summaries: list[YearSummary] = []
    symbol_summaries: list[SymbolLifetimeSummary] = []
    metrics: PortfolioMetrics
