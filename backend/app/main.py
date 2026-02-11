"""
TaxPilot API – FastAPI application.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from collections import defaultdict

from app.models import ActionType, BrokerName, TaxReport, UnifiedTransaction
from app.parsers.detector import detect_and_parse
from app.parsers.ibkr_performance import IBKRPerformanceParser
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
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
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
    # Count per-symbol buy/sell quantities from Activity Statement
    symbol_buys: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    symbol_sells: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for tx in existing_transactions:
        if tx.action == ActionType.BUY:
            symbol_buys[tx.symbol] += tx.quantity
        elif tx.action == ActionType.SELL:
            symbol_sells[tx.symbol] += tx.quantity

    # Build lookup from Performance report Trade Summary
    trade_lookup = {ts.symbol: ts for ts in perf_report.trade_summaries}

    # Parse period_start for synthetic buy date (inception date of the report)
    buy_date = None
    for fmt in ("%B %d, %Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            buy_date = datetime.strptime(perf_report.period_start, fmt).replace(hour=12)
            break
        except ValueError:
            continue
    if not buy_date:
        buy_date = datetime(2020, 1, 2, 12, 0)

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

        currency = trade_data.currency or perf_report.base_currency
        price = trade_data.avg_buy_price

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
