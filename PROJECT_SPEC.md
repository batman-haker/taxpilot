# TaxPilot - MVP Specification

## Goal
Web application that accepts CSV/XML files with transaction history from brokers
(starting with Interactive Brokers), converts currencies using NBP rates, pairs
transactions using FIFO method, and returns ready amounts for PIT-38 and PIT/ZG forms.

## MVP Scope
- Single broker support: Interactive Brokers (Flex Query CSV)
- No persistent user accounts (session-based processing)
- No complex corporate actions (standard BUY/SELL/DIVIDEND only)
- Simple UI: Drag & Drop upload + Results dashboard

## Key Business Rules
1. **NBP Rates**: Average NBP rate from the business day PRECEDING the settlement date
   - US/Canada/Mexico exchanges (after May 28, 2024): T+1 settlement
   - Other exchanges: T+2 settlement
   - If preceding day is holiday/weekend, go back further until business day found
2. **FIFO**: First-In-First-Out matching per symbol across all accounts
3. **Commissions**: Broker fees increase purchase cost / decrease sale revenue
4. **Rounding**:
   - Exchange rates: 4 decimal places
   - Intermediate amounts: 2 decimal places
   - Final PIT amounts: rounded to full PLN (Ordynacja Podatkowa)
5. **Dividends**: 19% Polish tax, minus withholding tax paid abroad
6. **ISIN country**: First 2 characters of ISIN = country code (ISO 3166-1 alpha-2)

## Stack
- Backend: Python 3.11+ / FastAPI / Pandas / Decimal
- Frontend: Next.js 14 / TypeScript / TailwindCSS / shadcn/ui
- Cache: SQLite (NBP rates only)
