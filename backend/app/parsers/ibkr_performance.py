"""
Parser for IBKR Performance/Portfolio Analyst reports.

This is a standalone parser (does NOT extend BaseParser) because it returns
PortfolioAnalysisReport, not UnifiedTransaction. The report is a summary-level
document with section markers like:
    SectionName,Header,Col1,Col2,...
    SectionName,Data,Val1,Val2,...
    SectionName,MetaInfo,Key,Value
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from app.models_portfolio import (
    PACumulativeReturn,
    PADailyNav,
    PADeposit,
    PADividend,
    PAKeyStatistics,
    PAMonthlyReturn,
    PAOpenPosition,
    PASymbolPerformance,
    PATradeSummary,
    PortfolioAnalysisReport,
)

logger = logging.getLogger(__name__)


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


def _safe_decimal(value: str) -> Optional[Decimal]:
    """Convert string to Decimal, returning None for empty/dash values."""
    if not value or value.strip() in ("", "-", "--", "N/A"):
        return None
    cleaned = value.strip().replace(",", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _safe_decimal_or_zero(value: str) -> Decimal:
    """Convert string to Decimal, returning 0 for unparseable values."""
    result = _safe_decimal(value)
    return result if result is not None else Decimal("0")


def _parse_date_str(value: str) -> Optional[str]:
    """Parse IBKR date strings (MM/DD/YY, YYYYMMDD) to YYYY-MM-DD string."""
    value = value.strip().strip('"')
    if not value or value == "-":
        return None
    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return value  # return as-is if no format matches


class IBKRPerformanceParser:
    """
    Standalone parser for IBKR Performance/Portfolio Analyst reports.
    """

    PERF_SECTIONS = [
        "Key Statistics,Header",
        "Historical Performance,Header",
        "Open Position Summary,Header",
        "Performance by Symbol,Header",
        "Allocation by Asset Class,Header",
        "Cumulative Performance Statistics,Header",
        "Time Period Performance Statistics,Header",
        "Trade Summary,Header",
        "Deposits And Withdrawals,Header",
    ]

    @staticmethod
    def detect(file_content: str | bytes, filename: str = "") -> bool:
        """Detect IBKR Performance Report by presence of characteristic sections."""
        text = _decode(file_content)
        matches = sum(1 for s in IBKRPerformanceParser.PERF_SECTIONS if s in text)
        return matches >= 3

    def parse(self, file_content: str | bytes, filename: str = "") -> PortfolioAnalysisReport:
        text = _decode(file_content)
        warnings: list[str] = []

        sections = self._split_into_sections(text)

        # Introduction
        account_name, period_start, period_end, base_currency = self._parse_introduction(
            sections.get("Introduction", []), warnings
        )

        # Key Statistics
        key_stats = self._parse_key_statistics(
            sections.get("Key Statistics", []), warnings
        )

        # Historical Performance (monthly/quarterly/yearly)
        monthly_returns = self._parse_historical_returns(
            sections.get("Historical Performance", []), warnings
        )

        # Open Position Summary
        open_positions = self._parse_open_positions(
            sections.get("Open Position Summary", []), warnings
        )

        # Trade Summary
        trade_summaries = self._parse_trade_summaries(
            sections.get("Trade Summary", []), warnings
        )

        # Deposits And Withdrawals
        deposits = self._parse_deposits(
            sections.get("Deposits And Withdrawals", []), warnings
        )

        # Dividends
        dividends = self._parse_dividends(
            sections.get("Dividends", []), warnings
        )

        # Performance by Symbol
        symbol_perf = self._parse_symbol_performance(
            sections.get("Performance by Symbol", []), warnings
        )

        # Allocation by Asset Class (daily NAV)
        daily_nav = self._parse_daily_nav(
            sections.get("Allocation by Asset Class", []), warnings
        )

        # Cumulative Performance Statistics
        cumulative = self._parse_cumulative_returns(
            sections.get("Cumulative Performance Statistics", []), warnings
        )

        return PortfolioAnalysisReport(
            account_name=account_name,
            period_start=period_start,
            period_end=period_end,
            base_currency=base_currency,
            key_statistics=key_stats,
            monthly_returns=monthly_returns,
            open_positions=open_positions,
            trade_summaries=trade_summaries,
            deposits=deposits,
            dividends_list=dividends,
            symbol_performance=symbol_perf,
            daily_nav=daily_nav,
            cumulative_returns=cumulative,
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Section splitter
    # ------------------------------------------------------------------

    def _split_into_sections(self, text: str) -> dict[str, list[dict[str, str]]]:
        """
        Split CSV into sections. Each section has Header rows (defining columns)
        and Data rows. Returns dict[section_name -> list of row dicts].

        Handles multiple Header rows within the same section (e.g. Historical
        Performance has separate headers for Month, Quarter, Year sub-tables).
        """
        sections: dict[str, list[dict[str, str]]] = {}
        current_section = ""
        current_headers: list[str] = []

        reader = csv.reader(io.StringIO(text))
        for parts in reader:
            if len(parts) < 2:
                continue

            section = parts[0].strip()
            discriminator = parts[1].strip()

            if discriminator == "Header":
                current_section = section
                current_headers = [p.strip() for p in parts]
                if section not in sections:
                    sections[section] = []
                continue

            if discriminator == "MetaInfo":
                # Store MetaInfo rows too (useful for period info)
                if section not in sections:
                    sections[section] = []
                row = {"_type": "MetaInfo"}
                for i, v in enumerate(parts):
                    row[f"_col{i}"] = v.strip()
                sections[section].append(row)
                continue

            if discriminator == "Data" and current_headers and current_section == section:
                row = {}
                for i, header in enumerate(current_headers):
                    row[header] = parts[i].strip() if i < len(parts) else ""
                row["_type"] = "Data"
                sections[current_section].append(row)

        return sections

    # ------------------------------------------------------------------
    # Introduction
    # ------------------------------------------------------------------

    def _parse_introduction(
        self, rows: list[dict], warnings: list[str]
    ) -> tuple[str, str, str, str]:
        """Extract account name, period, and base currency."""
        account_name = "Unknown"
        period_start = ""
        period_end = ""
        base_currency = "USD"

        for row in rows:
            if row.get("_type") != "Data":
                continue
            name = row.get("Name", "")
            if name:
                account_name = name
            currency = row.get("BaseCurrency", "")
            if currency:
                base_currency = currency
            period_str = row.get("AnalysisPeriod", "")
            if period_str:
                # "September 29, 2023 to February 9, 2026 (Daily)"
                period_clean = period_str.split("(")[0].strip()
                if " to " in period_clean:
                    parts = period_clean.split(" to ")
                    period_start = parts[0].strip()
                    period_end = parts[1].strip()

        if not period_start:
            warnings.append("Could not parse analysis period from Introduction section")

        return account_name, period_start, period_end, base_currency

    # ------------------------------------------------------------------
    # Key Statistics
    # ------------------------------------------------------------------

    def _parse_key_statistics(
        self, rows: list[dict], warnings: list[str]
    ) -> PAKeyStatistics:
        """Parse Key Statistics section."""
        for row in rows:
            if row.get("_type") != "Data":
                continue
            return PAKeyStatistics(
                beginning_nav=_safe_decimal_or_zero(row.get("BeginningNAV", "0")),
                ending_nav=_safe_decimal_or_zero(row.get("EndingNAV", "0")),
                cumulative_return_pct=_safe_decimal_or_zero(row.get("CumulativeReturn", "0")),
                best_return_pct=_safe_decimal_or_zero(row.get("BestReturn", "0")),
                best_return_date=row.get("BestReturnDate"),
                worst_return_pct=_safe_decimal_or_zero(row.get("WorstReturn", "0")),
                worst_return_date=row.get("WorstReturnDate"),
                mtm=_safe_decimal_or_zero(row.get("MTM", "0")),
                deposits_withdrawals=_safe_decimal_or_zero(row.get("Deposits & Withdrawals", "0")),
                dividends=_safe_decimal_or_zero(row.get("Dividends", "0")),
                interest=_safe_decimal_or_zero(row.get("Interest", "0")),
                fees=_safe_decimal_or_zero(row.get("Fees & Commissions", "0")),
            )

        warnings.append("No Key Statistics data found")
        return PAKeyStatistics(
            beginning_nav=Decimal("0"), ending_nav=Decimal("0"),
            cumulative_return_pct=Decimal("0"), best_return_pct=Decimal("0"),
            worst_return_pct=Decimal("0"), mtm=Decimal("0"),
            deposits_withdrawals=Decimal("0"), dividends=Decimal("0"),
            interest=Decimal("0"), fees=Decimal("0"),
        )

    # ------------------------------------------------------------------
    # Historical Performance (monthly/quarterly/yearly returns)
    # ------------------------------------------------------------------

    def _parse_historical_returns(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PAMonthlyReturn]:
        """Parse Historical Performance section with Month, Quarter, Year sub-tables."""
        results: list[PAMonthlyReturn] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            # Detect which sub-table this row belongs to
            account = row.get("Account", "")
            if account and account != "Consolidated":
                continue

            # Monthly rows have "Month" column (YYYYMM)
            month = row.get("Month", "").strip()
            quarter = row.get("Quarter", "").strip()
            year = row.get("Year", "").strip()

            return_str = row.get("AccountReturn", "")
            return_val = _safe_decimal(return_str)

            if month:
                results.append(PAMonthlyReturn(
                    period=month, period_type="month", return_pct=return_val
                ))
            elif quarter:
                results.append(PAMonthlyReturn(
                    period=quarter, period_type="quarter", return_pct=return_val
                ))
            elif year:
                results.append(PAMonthlyReturn(
                    period=year, period_type="year", return_pct=return_val
                ))

        return results

    # ------------------------------------------------------------------
    # Open Position Summary
    # ------------------------------------------------------------------

    def _parse_open_positions(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PAOpenPosition]:
        """Parse Open Position Summary section."""
        results: list[PAOpenPosition] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            symbol = row.get("Symbol", "").strip()
            # Skip total/subtotal rows and cash rows
            date_val = row.get("Date", row.get("Open Position Summary", "")).strip()
            if not symbol or date_val in ("Total", ""):
                continue
            fi = row.get("FinancialInstrument", "").strip()
            if fi == "Cash":
                continue

            value = _safe_decimal(row.get("Value", "0"))
            cost = _safe_decimal(row.get("Cost Basis", "0"))
            pnl = _safe_decimal(row.get("UnrealizedP&L", "0"))

            if value is None:
                continue

            results.append(PAOpenPosition(
                symbol=symbol,
                description=row.get("Description", "").strip(),
                financial_instrument=fi or None,
                currency=row.get("Currency", "").strip() or None,
                sector=row.get("Sector", "").strip() or None,
                quantity=_safe_decimal_or_zero(row.get("Quantity", "0")),
                close_price=_safe_decimal_or_zero(row.get("ClosePrice", "0")),
                value=value or Decimal("0"),
                cost_basis=cost or Decimal("0"),
                unrealized_pnl=pnl or Decimal("0"),
            ))

        return results

    # ------------------------------------------------------------------
    # Trade Summary
    # ------------------------------------------------------------------

    def _parse_trade_summaries(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PATradeSummary]:
        """Parse Trade Summary section."""
        results: list[PATradeSummary] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                continue
            # Skip forex rows
            fi = row.get("Financial Instrument", row.get("Trade Summary", "")).strip()
            if fi == "Forex":
                continue

            results.append(PATradeSummary(
                financial_instrument=fi or None,
                currency=row.get("Currency", "").strip() or None,
                symbol=symbol,
                description=row.get("Description", "").strip(),
                sector=row.get("Sector", "").strip() or None,
                quantity_bought=_safe_decimal_or_zero(row.get("Quantity Bought", "0")),
                avg_buy_price=_safe_decimal_or_zero(row.get("Average Price Bought", "0")),
                proceeds_bought=_safe_decimal_or_zero(row.get("Proceeds Bought", "0")),
                quantity_sold=_safe_decimal_or_zero(row.get("Quantity Sold", "0")),
                avg_sell_price=_safe_decimal_or_zero(row.get("Average Price Sold", "0")),
                proceeds_sold=_safe_decimal_or_zero(row.get("Proceeds Sold", "0")),
            ))

        return results

    # ------------------------------------------------------------------
    # Deposits And Withdrawals
    # ------------------------------------------------------------------

    def _parse_deposits(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PADeposit]:
        """Parse Deposits And Withdrawals section."""
        results: list[PADeposit] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            date_str = row.get("Date", row.get("Deposits And Withdrawals", "")).strip()
            parsed_date = _parse_date_str(date_str) or date_str

            results.append(PADeposit(
                entry_date=parsed_date,
                account=row.get("Account", "").strip(),
                deposit_type=row.get("Type", "").strip(),
                description=row.get("Description", "").strip(),
                amount=_safe_decimal_or_zero(row.get("Amount", "0")),
            ))

        return results

    # ------------------------------------------------------------------
    # Dividends
    # ------------------------------------------------------------------

    def _parse_dividends(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PADividend]:
        """Parse Dividends section."""
        results: list[PADividend] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                continue

            pay_date = row.get("PayDate", row.get("Dividends", "")).strip()
            parsed_pay = _parse_date_str(pay_date) or pay_date
            ex_date = row.get("Ex-Date", "").strip()
            parsed_ex = _parse_date_str(ex_date)

            results.append(PADividend(
                pay_date=parsed_pay,
                ex_date=parsed_ex,
                account=row.get("Account", "").strip(),
                symbol=symbol,
                note=row.get("Note", "").strip() or None,
                quantity=_safe_decimal_or_zero(row.get("Quantity", "0")),
                dividend_per_share=_safe_decimal_or_zero(row.get("DividendPerShare", "0")),
                amount=_safe_decimal_or_zero(row.get("Amount", "0")),
            ))

        return results

    # ------------------------------------------------------------------
    # Performance by Symbol
    # ------------------------------------------------------------------

    def _parse_symbol_performance(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PASymbolPerformance]:
        """Parse Performance by Symbol section."""
        results: list[PASymbolPerformance] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            symbol = row.get("Symbol", "").strip()
            if not symbol:
                continue
            # Skip total/subtotal rows and cash rows
            fi = row.get("FinancialInstrument", "").strip()
            if fi == "Cash" or symbol.startswith("Total") or symbol == "Fees":
                continue

            return_pct = _safe_decimal_or_zero(row.get("Return", "0"))
            contribution = _safe_decimal_or_zero(row.get("Contribution", "0"))
            unrealized = _safe_decimal_or_zero(
                row.get("Unrealized_P&L", "0").replace(",", "")
            )
            realized = _safe_decimal_or_zero(
                row.get("Realized_P&L", "0").replace(",", "")
            )
            is_open = row.get("Open", "").strip().lower() == "yes"

            results.append(PASymbolPerformance(
                symbol=symbol,
                description=row.get("Description", "").strip(),
                financial_instrument=fi,
                sector=row.get("Sector", "").strip() or None,
                avg_weight_pct=_safe_decimal_or_zero(row.get("AvgWeight", "0")),
                return_pct=return_pct,
                contribution_pct=contribution,
                unrealized_pnl=unrealized,
                realized_pnl=realized,
                is_open=is_open,
            ))

        return results

    # ------------------------------------------------------------------
    # Allocation by Asset Class (daily NAV)
    # ------------------------------------------------------------------

    def _parse_daily_nav(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PADailyNav]:
        """Parse Allocation by Asset Class section for daily NAV data."""
        results: list[PADailyNav] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            date_str = row.get("Date", row.get("Allocation by Asset Class", "")).strip()
            parsed_date = _parse_date_str(date_str)
            if not parsed_date:
                continue

            nav = _safe_decimal(row.get("NAV", "0"))
            if nav is None:
                continue

            results.append(PADailyNav(
                nav_date=parsed_date,
                commodities=_safe_decimal_or_zero(row.get("Commodities", "0")),
                equities=_safe_decimal_or_zero(row.get("Equities", "0")),
                fixed_income=_safe_decimal_or_zero(row.get("Fixed Income", "0")),
                real_estate=_safe_decimal_or_zero(row.get("Real Estate", "0")),
                cash=_safe_decimal_or_zero(row.get("Cash", "0")),
                nav=nav,
            ))

        return results

    # ------------------------------------------------------------------
    # Cumulative Performance Statistics
    # ------------------------------------------------------------------

    def _parse_cumulative_returns(
        self, rows: list[dict], warnings: list[str]
    ) -> list[PACumulativeReturn]:
        """Parse Cumulative Performance Statistics section."""
        results: list[PACumulativeReturn] = []

        for row in rows:
            if row.get("_type") != "Data":
                continue
            date_str = row.get("Date", row.get("Cumulative Performance Statistics", "")).strip()
            parsed_date = _parse_date_str(date_str)
            if not parsed_date:
                continue

            account = row.get("Account", "").strip()
            if account and account != "Consolidated":
                continue

            return_val = _safe_decimal(row.get("Return", "0"))
            if return_val is None:
                continue

            results.append(PACumulativeReturn(
                return_date=parsed_date,
                cumulative_return_pct=return_val,
            ))

        return results
