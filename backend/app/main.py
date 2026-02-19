"""
TaxPilot API – FastAPI application.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from collections import defaultdict

from app.models import ActionType, BrokerName, OpenPosition, TaxReport, UnifiedTransaction
from app.parsers.detector import detect_and_parse
from app.parsers.ibkr_performance import IBKRPerformanceParser
from app.parsers.ike_ikze import IkeIkzeParser
from app.services.nbp_client import NbpClient, settlement_date_for_trade
from app.services.tax_report import TaxReportGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TaxPilot",
    description="Polish capital gains tax calculator for foreign broker accounts",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://localhost:3001",
        "http://127.0.0.1:3000", "http://127.0.0.1:3001",
        "http://andrzej240.mikrus.xyz",
        "https://andrzej240.mikrus.xyz",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singleton NBP client (shared across requests, with cache)
nbp_client = NbpClient()


@app.get("/health")
async def health():
    return {"status": "ok"}


def _build_manual_transactions(manual_buys_json: str) -> tuple[list[UnifiedTransaction], list[str]]:
    """Parse manual buy entries from JSON and create UnifiedTransaction objects.

    Returns (transactions, warnings) tuple.
    """
    try:
        entries = json.loads(manual_buys_json)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid manual_buys JSON: {e}")

    transactions = []
    skipped = []
    for entry in entries:
        symbol = entry.get("symbol", "").strip().upper()
        if not symbol:
            skipped.append(f"Pominięto wpis bez symbolu")
            continue

        try:
            trade_date_str = entry.get("tradeDate", "")
            if not trade_date_str:
                skipped.append(f"Pominięto {symbol}: brak daty")
                continue
            trade_dt = datetime.strptime(trade_date_str, "%Y-%m-%d").replace(hour=12)

            qty = Decimal(str(entry.get("quantity", "0")))
            price = Decimal(str(entry.get("price", "0")))
            if qty <= 0 or price <= 0:
                skipped.append(f"Pominięto {symbol}: ilość lub cena <= 0")
                continue

            currency = entry.get("currency", "USD").upper()
            commission = Decimal(str(entry.get("commission", "0")))

            settle = settlement_date_for_trade(trade_dt.date(), "US" if currency == "USD" else "")

            raw_id = f"MANUAL_{symbol}_{trade_date_str}_{qty}_{price}"
            tx_id = hashlib.sha256(raw_id.encode()).hexdigest()[:16]

            transactions.append(UnifiedTransaction(
                id=tx_id,
                broker=BrokerName.MANUAL,
                symbol=symbol,
                isin=None,
                description="Reczne kupno",
                trade_date=trade_dt,
                settlement_date=settle,
                action=ActionType.BUY,
                quantity=qty,
                price=price,
                currency=currency,
                commission=commission,
            ))
        except (ValueError, InvalidOperation) as e:
            skipped.append(f"Pominięto {symbol}: {e}")
            logger.warning("Skipping invalid manual buy entry %s: %s", entry, e)

    return transactions, skipped


def _supplement_open_positions(report: TaxReport, perf_report, nbp_client: NbpClient) -> None:
    """
    Add open positions from Performance report that aren't covered by FIFO.
    This handles positions bought before the Activity Statement period.
    """
    # Aggregate FIFO open position quantities per symbol
    fifo_qty: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for pos in report.open_positions:
        fifo_qty[pos.symbol] += pos.quantity

    for pa_pos in perf_report.open_positions:
        fifo_has = fifo_qty.get(pa_pos.symbol, Decimal("0"))
        shortfall = pa_pos.quantity - fifo_has

        if shortfall <= 0:
            continue

        currency = _normalize_currency(pa_pos.currency or "USD")

        # Compute avg price from cost_basis / quantity
        avg_price = (
            (pa_pos.cost_basis / pa_pos.quantity).quantize(Decimal("0.0001"))
            if pa_pos.quantity > 0
            else Decimal("0")
        )

        # Use report period_start as approximate buy date
        buy_date_dt = None
        for fmt in ("%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                buy_date_dt = datetime.strptime(perf_report.period_start, fmt)
                break
            except ValueError:
                continue
        buy_dt = (buy_date_dt or datetime(2020, 1, 2)).date()

        # Get NBP rate
        try:
            settle = settlement_date_for_trade(buy_dt, "US" if currency == "USD" else "")
            rate, _ = nbp_client.get_rate(currency, settle)
        except Exception:
            rate = Decimal("1")

        cost_pln = (avg_price * shortfall * rate).quantize(Decimal("0.01"))

        report.open_positions.append(OpenPosition(
            symbol=pa_pos.symbol,
            quantity=shortfall,
            buy_date=buy_dt,
            buy_price=avg_price,
            currency=currency,
            cost_pln=cost_pln,
            nbp_rate=rate,
            broker="IBKR (Performance)",
        ))

    logger.info(
        "Supplemented open positions: %d total after merge",
        len(report.open_positions),
    )


# Map common full currency names (from IBKR Performance report) to ISO codes
_CURRENCY_NAME_TO_ISO = {
    "UNITED STATES DOLLAR": "USD",
    "US DOLLAR": "USD",
    "EURO": "EUR",
    "BRITISH POUND": "GBP",
    "SWISS FRANC": "CHF",
    "JAPANESE YEN": "JPY",
    "CANADIAN DOLLAR": "CAD",
    "AUSTRALIAN DOLLAR": "AUD",
    "POLISH ZLOTY": "PLN",
    "SWEDISH KRONA": "SEK",
    "DANISH KRONE": "DKK",
    "NORWEGIAN KRONE": "NOK",
}


def _normalize_currency(raw: str) -> str:
    """Normalize full currency names to ISO 3-letter codes."""
    if not raw:
        return "USD"
    upper = raw.strip().upper()
    if len(upper) <= 4 and upper.isalpha():
        return upper
    return _CURRENCY_NAME_TO_ISO.get(upper, upper)


def _build_supplementary_buys(
    existing_transactions: list[UnifiedTransaction],
    perf_report,
) -> tuple[list[UnifiedTransaction], list[str]]:
    """
    Create synthetic buy transactions from Performance report Trade Summary
    for symbols that have sells but insufficient buys in Activity Statement.

    This fills the FIFO gap when user uploads a single-year Activity Statement
    but has positions bought in prior years.

    Returns (synthetic_transactions, warnings).
    """
    # Count per-symbol buy/sell quantities and find earliest sell date
    symbol_buys: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    symbol_sells: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    earliest_sell: dict[str, datetime] = {}

    for tx in existing_transactions:
        if tx.action == ActionType.BUY:
            symbol_buys[tx.symbol] += tx.quantity
        elif tx.action == ActionType.SELL:
            symbol_sells[tx.symbol] += tx.quantity
            if tx.symbol not in earliest_sell or tx.trade_date < earliest_sell[tx.symbol]:
                earliest_sell[tx.symbol] = tx.trade_date

    # Build lookup from Performance report Trade Summary
    trade_lookup = {ts.symbol: ts for ts in perf_report.trade_summaries}

    supplementary = []
    warnings = []

    for symbol, sell_qty in symbol_sells.items():
        buy_qty = symbol_buys.get(symbol, Decimal("0"))
        shortfall = sell_qty - buy_qty

        if shortfall <= 0:
            continue

        trade_data = trade_lookup.get(symbol)
        if not trade_data or trade_data.avg_buy_price <= 0:
            continue

        currency = _normalize_currency(
            trade_data.currency or perf_report.base_currency
        )
        price = trade_data.avg_buy_price

        # Use day before earliest sell as synthetic buy date (realistic for FIFO)
        sell_dt = earliest_sell[symbol]
        buy_date = sell_dt - timedelta(days=1)
        if buy_date.weekday() >= 5:  # Push to Friday if weekend
            buy_date -= timedelta(days=(buy_date.weekday() - 4))
        buy_date = buy_date.replace(hour=12, minute=0, second=0, microsecond=0)

        settle = settlement_date_for_trade(
            buy_date.date(), "US" if currency == "USD" else ""
        )

        raw_id = f"PERF_SUPPLEMENT_{symbol}_{shortfall}_{price}"
        tx_id = hashlib.sha256(raw_id.encode()).hexdigest()[:16]

        tx = UnifiedTransaction(
            id=tx_id,
            broker=BrokerName.MANUAL,
            symbol=symbol,
            isin=None,
            description=f"Szacunkowe kupno z raportu Performance (sr. cena {price} {currency})",
            trade_date=buy_date,
            settlement_date=settle,
            action=ActionType.BUY,
            quantity=shortfall,
            price=price,
            currency=currency,
            commission=Decimal("0"),
        )
        supplementary.append(tx)

        warnings.append(
            f"UZUPELNIONE Z PERFORMANCE: Dodano szacunkowe kupno {symbol} "
            f"({shortfall} szt. x {price} {currency}). "
            f"Cena to srednia z calej historii — dla dokladnego rozliczenia "
            f"podaj prawdziwe daty i ceny zakupu."
        )

    return supplementary, warnings


def _dedup_transactions(transactions: list[UnifiedTransaction]) -> list[UnifiedTransaction]:
    """Remove duplicate transactions from overlapping files.

    Three-pass approach:
    1. Exact ID dedup — removes duplicates when the same trade appears in multiple
       raw CSV files with the same TransactionID.
    2. Same-price aggregate dedup — when an Activity Statement aggregates partial
       fills into one row (e.g. 123 units) and a raw CSV has the individual fills
       (16 + 7 + 100) at the same price, keep only the individual fills.
    3. Blended-price aggregate dedup — when an Activity Statement merges partial
       fills at *different* prices into one row with a blended price (e.g. 17.5 @
       151.0009 = 0.5 @ 151.03 + 17 @ 151), group by (symbol, datetime, action)
       without price and keep the granular breakdown.
    """
    if not transactions:
        return transactions

    # Pass 1: exact ID dedup
    seen_ids: set[str] = set()
    deduped: list[UnifiedTransaction] = []
    for tx in transactions:
        if tx.id not in seen_ids:
            seen_ids.add(tx.id)
            deduped.append(tx)

    id_dupes = len(transactions) - len(deduped)
    if id_dupes:
        logger.info("Deduplicated %d exact-ID duplicates", id_dupes)

    # Pass 2: same-price aggregate dedup
    groups: dict[tuple, list[int]] = defaultdict(list)
    for i, tx in enumerate(deduped):
        if tx.action in (ActionType.BUY, ActionType.SELL):
            key = (tx.symbol, tx.trade_date, tx.action, tx.price)
            groups[key].append(i)

    remove_indices: set[int] = set()
    for key, indices in groups.items():
        if len(indices) <= 1:
            continue
        quantities = [(i, deduped[i].quantity) for i in indices]
        quantities.sort(key=lambda x: x[1], reverse=True)
        largest_i, largest_q = quantities[0]
        rest_sum = sum(q for _, q in quantities[1:])
        if rest_sum == largest_q:
            remove_indices.add(largest_i)

    if remove_indices:
        logger.info("Removed %d same-price aggregate duplicates", len(remove_indices))
        deduped = [tx for i, tx in enumerate(deduped) if i not in remove_indices]

    # Pass 3: blended-price aggregate dedup
    # Group by (symbol, datetime, action) WITHOUT price — catches blended-price aggregates
    time_groups: dict[tuple, list[int]] = defaultdict(list)
    for i, tx in enumerate(deduped):
        if tx.action in (ActionType.BUY, ActionType.SELL):
            key = (tx.symbol, tx.trade_date, tx.action)
            time_groups[key].append(i)

    remove_blended: set[int] = set()
    for key, indices in time_groups.items():
        if len(indices) <= 1:
            continue
        quantities = [(i, deduped[i].quantity) for i in indices]
        quantities.sort(key=lambda x: x[1], reverse=True)
        largest_i, largest_q = quantities[0]
        rest_sum = sum(q for _, q in quantities[1:])
        if rest_sum == largest_q:
            remove_blended.add(largest_i)

    if remove_blended:
        logger.info("Removed %d blended-price aggregate duplicates", len(remove_blended))
        deduped = [tx for i, tx in enumerate(deduped) if i not in remove_blended]

    return deduped


@app.post("/api/calculate")
async def calculate_tax(
    files: list[UploadFile] = File(...),
    tax_year: int = Form(...),
    prior_year_loss: Optional[float] = Form(None),
    manual_buys: Optional[str] = Form(None),
):
    """
    Upload one or more broker CSV files and get tax calculation.

    Supports multiple files (e.g. trades + dividends from same broker,
    or files from different brokers). Optional manual_buys JSON for
    historical positions without CSV files.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    if tax_year < 2000 or tax_year > 2030:
        raise HTTPException(status_code=400, detail="Invalid tax year")

    all_transactions = []
    file_summaries = []
    manual_warnings: list[str] = []

    # Process manual buy entries
    if manual_buys:
        try:
            manual_txs, manual_warnings = _build_manual_transactions(manual_buys)
            all_transactions.extend(manual_txs)
            if manual_txs:
                file_summaries.append({
                    "filename": "Reczne kupna",
                    "broker": "MANUAL",
                    "transactions_count": len(manual_txs),
                    "buys": len(manual_txs),
                    "sells": 0,
                    "dividends": 0,
                    "wht": 0,
                })
                logger.info("Added %d manual buy transactions", len(manual_txs))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    perf_parser = IBKRPerformanceParser()
    perf_report = None
    perf_filenames = []
    has_activity_statement = False

    for uploaded_file in files:
        try:
            content = await uploaded_file.read()
            filename = uploaded_file.filename or "unknown"

            # Check if this is a Performance report
            if perf_parser.detect(content, filename):
                # Parse as supplementary data (not rejected outright)
                perf_report = perf_parser.parse(content, filename)
                perf_filenames.append(filename)
                file_summaries.append({
                    "filename": filename,
                    "broker": "IBKR",
                    "transactions_count": 0,
                    "buys": 0,
                    "sells": 0,
                    "dividends": 0,
                    "wht": 0,
                    "note": "Raport Performance — uzyte jako uzupelnienie danych historycznych",
                })
                logger.info(
                    "Parsed Performance report %s as supplementary data", filename,
                )
                continue

            transactions = detect_and_parse(content, filename)
            all_transactions.extend(transactions)
            has_activity_statement = True

            broker = transactions[0].broker if transactions else "?"
            file_summaries.append({
                "filename": filename,
                "broker": broker,
                "transactions_count": len(transactions),
                "buys": sum(1 for t in transactions if t.action.value == "BUY"),
                "sells": sum(1 for t in transactions if t.action.value == "SELL"),
                "dividends": sum(1 for t in transactions if t.action.value == "DIVIDEND"),
                "wht": sum(1 for t in transactions if t.action.value == "TAX_WHT"),
            })

            logger.info(
                "Parsed %s: %d transactions from %s",
                filename, len(transactions), broker,
            )

        except HTTPException:
            raise
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Error processing file '{uploaded_file.filename}': {str(e)}",
            )
        except Exception as e:
            logger.error("Unexpected error parsing %s: %s", uploaded_file.filename, e)
            raise HTTPException(
                status_code=500,
                detail=f"Internal error processing '{uploaded_file.filename}'",
            )

    # If ONLY Performance report(s) uploaded (no Activity Statements)
    if perf_filenames and not has_activity_statement:
        raise HTTPException(
            status_code=400,
            detail="Wgrano tylko raport Performance/Portfolio Analyst. "
                   "Do obliczenia podatku potrzebujesz rowniez raportu "
                   "Flex Query / Activity Statement z IBKR. "
                   "Wgraj oba pliki razem, lub uzyj przycisku "
                   "'Oblicz zyski gieldowe' do analizy raportu Performance.",
        )

    if not all_transactions:
        raise HTTPException(
            status_code=400,
            detail="No valid transactions found in uploaded files",
        )

    # Dedup transactions from overlapping files
    # (e.g. same IBKR trades exported as both raw CSV and Activity Statement)
    all_transactions = _dedup_transactions(all_transactions)

    # Supplement missing buys from Performance report Trade Summary
    supplementary_warnings = []
    if perf_report:
        supplementary_buys, supplementary_warnings = _build_supplementary_buys(
            all_transactions, perf_report,
        )
        if supplementary_buys:
            all_transactions.extend(supplementary_buys)
            file_summaries.append({
                "filename": "Uzupelnienia z raportu Performance",
                "broker": "IBKR (Performance)",
                "transactions_count": len(supplementary_buys),
                "buys": len(supplementary_buys),
                "sells": 0,
                "dividends": 0,
                "wht": 0,
            })
            logger.info(
                "Added %d supplementary buy transactions from Performance report",
                len(supplementary_buys),
            )

    # Generate tax report
    try:
        generator = TaxReportGenerator(nbp_client)
        loss = Decimal(str(prior_year_loss)) if prior_year_loss else None
        report = generator.generate(all_transactions, tax_year, loss)
        # Prepend warnings so user sees them first
        prepend = manual_warnings + supplementary_warnings
        if prepend:
            report.warnings = prepend + report.warnings
    except Exception as e:
        logger.error("Tax calculation error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Tax calculation error: {str(e)}",
        )

    # Supplement open positions from Performance report
    # (covers positions bought before the Activity Statement period)
    if perf_report and perf_report.open_positions:
        _supplement_open_positions(report, perf_report, nbp_client)

    return {
        "files": file_summaries,
        "report": report.model_dump(mode="json"),
    }


@app.post("/api/parse-preview")
async def parse_preview(
    file: UploadFile = File(...),
):
    """
    Upload a single file and get a preview of parsed transactions.
    Useful for the user to verify data before running full calculation.
    """
    try:
        content = await file.read()
        filename = file.filename or "unknown"
        transactions = detect_and_parse(content, filename)

        return {
            "filename": filename,
            "broker": transactions[0].broker if transactions else None,
            "count": len(transactions),
            "transactions": [
                {
                    "symbol": t.symbol,
                    "action": t.action.value,
                    "quantity": str(t.quantity),
                    "price": str(t.price),
                    "currency": t.currency,
                    "trade_date": t.trade_date.isoformat(),
                    "commission": str(t.commission),
                    "isin": t.isin,
                }
                for t in transactions[:100]  # Limit preview to 100 rows
            ],
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/portfolio-analysis")
async def portfolio_analysis(
    file: UploadFile = File(...),
):
    """
    Upload an IBKR Performance/Portfolio Analyst report CSV
    and get parsed portfolio analysis data.

    This is a separate flow from /api/calculate (tax calculation).
    """
    try:
        content = await file.read()
        filename = file.filename or "unknown"

        parser = IBKRPerformanceParser()
        if not parser.detect(content, filename):
            raise HTTPException(
                status_code=400,
                detail="Plik nie wyglada na raport IBKR Performance/Portfolio Analyst. "
                       "Upewnij sie, ze wgrywasz raport Performance (nie Flex Query).",
            )

        report = parser.parse(content, filename)
        return {
            "filename": filename,
            "report": report.model_dump(mode="json"),
        }

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Portfolio analysis error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Blad analizy portfela: {str(e)}",
        )


@app.post("/api/ike-ikze")
async def ike_ikze_upload(
    file: UploadFile = File(...),
):
    """
    Upload a mBank eMakler IKE/IKZE portfolio snapshot CSV.
    Returns parsed positions for portfolio analysis display.
    """
    try:
        content = await file.read()
        filename = file.filename or "unknown"

        parser = IkeIkzeParser()
        if not parser.detect(content, filename):
            raise HTTPException(
                status_code=400,
                detail="Plik nie wyglada na arkusz IKE/IKZE z mBank eMakler. "
                       "Oczekiwany format: CSV z sekcjami 'ike' / 'ikze' i pozycjami portfela.",
            )

        report = parser.parse(content, filename)
        return {
            "filename": filename,
            "report": report.model_dump(mode="json"),
        }

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("IKE/IKZE parse error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Blad parsowania pliku IKE/IKZE: {str(e)}",
        )
