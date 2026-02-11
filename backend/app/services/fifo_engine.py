"""
FIFO (First-In, First-Out) matching engine for capital gains calculation.

Groups transactions by symbol, maintains a buy queue per symbol,
and matches sells against the oldest buys first.

Supports short selling: when a sell has no matching buy, it is queued
as a short position. When a subsequent buy arrives for the same symbol,
it first covers pending short positions before adding to the buy queue.
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.models import ActionType, FifoMatch, UnifiedTransaction

logger = logging.getLogger(__name__)

TWO_PLACES = Decimal("0.01")


@dataclass
class BuyLot:
    """A lot of shares available for matching against future sells."""
    transaction: UnifiedTransaction
    remaining_qty: Decimal


@dataclass
class ShortLot:
    """A short sell lot waiting to be covered by a future buy."""
    transaction: UnifiedTransaction
    remaining_qty: Decimal


@dataclass
class FifoResult:
    """Complete result of FIFO processing."""
    matches: list[FifoMatch] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Remaining open buy positions (not yet sold)
    open_positions: dict[str, list[BuyLot]] = field(default_factory=dict)


class FifoEngine:
    """
    FIFO matching engine.

    Usage:
        engine = FifoEngine()
        result = engine.process(transactions)
    """

    def process(self, transactions: list[UnifiedTransaction]) -> FifoResult:
        """
        Process a list of unified transactions and produce FIFO matches.

        Only BUY and SELL transactions are considered.
        Transactions must already have nbp_rate populated.

        Supports short selling: sells without matching buys are queued
        and matched against subsequent buys (FIFO order).
        """
        result = FifoResult()

        # Separate and sort
        buys_sells = [
            t for t in transactions if t.action in (ActionType.BUY, ActionType.SELL)
        ]
        buys_sells.sort(key=lambda t: t.trade_date)

        # Buy queues per symbol (for regular long positions)
        buy_queues: dict[str, deque[BuyLot]] = defaultdict(deque)
        # Short sell queues per symbol (sells awaiting a covering buy)
        short_queues: dict[str, deque[ShortLot]] = defaultdict(deque)

        for tx in buys_sells:
            if tx.action == ActionType.BUY:
                buy_remaining = tx.quantity
                short_queue = short_queues.get(tx.symbol)

                # First, cover any pending short sells (FIFO: oldest short first)
                if short_queue:
                    while buy_remaining > 0 and short_queue:
                        short_lot = short_queue[0]
                        matched_qty = min(buy_remaining, short_lot.remaining_qty)

                        match = self._create_match(
                            symbol=tx.symbol,
                            quantity=matched_qty,
                            buy_tx=tx,
                            sell_tx=short_lot.transaction,
                            buy_total_qty=tx.quantity,
                            sell_total_qty=short_lot.transaction.quantity,
                        )
                        match.is_short = True
                        result.matches.append(match)

                        short_lot.remaining_qty -= matched_qty
                        buy_remaining -= matched_qty

                        if short_lot.remaining_qty <= 0:
                            short_queue.popleft()

                # Remaining buy qty goes to buy queue for future sells
                if buy_remaining > 0:
                    buy_queues[tx.symbol].append(
                        BuyLot(transaction=tx, remaining_qty=buy_remaining)
                    )

            elif tx.action == ActionType.SELL:
                sell_remaining = tx.quantity
                queue = buy_queues.get(tx.symbol, deque())

                # Regular FIFO: match against buy queue
                while sell_remaining > 0 and queue:
                    lot = queue[0]
                    matched_qty = min(sell_remaining, lot.remaining_qty)

                    match = self._create_match(
                        symbol=tx.symbol,
                        quantity=matched_qty,
                        buy_tx=lot.transaction,
                        sell_tx=tx,
                        buy_total_qty=lot.transaction.quantity,
                        sell_total_qty=tx.quantity,
                    )
                    result.matches.append(match)

                    lot.remaining_qty -= matched_qty
                    sell_remaining -= matched_qty

                    if lot.remaining_qty <= 0:
                        queue.popleft()

                # Unmatched sell qty → short queue (may be covered by future buys)
                if sell_remaining > 0:
                    short_queues[tx.symbol].append(
                        ShortLot(transaction=tx, remaining_qty=sell_remaining)
                    )

        # After all transactions: remaining short positions are true orphans
        for symbol, queue in short_queues.items():
            for lot in queue:
                if lot.remaining_qty > 0:
                    orphan_match = self._create_orphan_match(
                        symbol=symbol,
                        quantity=lot.remaining_qty,
                        sell_tx=lot.transaction,
                        sell_total_qty=lot.transaction.quantity,
                    )
                    result.matches.append(orphan_match)
                    result.warnings.append(
                        f"BRAK KUPNA: Nie znaleziono zakupu dla {symbol} "
                        f"(sprzedaz {lot.remaining_qty} szt. dnia {lot.transaction.trade_date.date()}). "
                        f"Uwzgledniono z kosztem 0 PLN — wgraj pliki z wczesniejszych lat "
                        f"lub dodaj brakujace kupno recznie."
                    )

        # Collect open positions (remaining unmatched buys)
        for symbol, queue in buy_queues.items():
            remaining = [lot for lot in queue if lot.remaining_qty > 0]
            if remaining:
                result.open_positions[symbol] = remaining

        return result

    def _create_orphan_match(
        self,
        symbol: str,
        quantity: Decimal,
        sell_tx: UnifiedTransaction,
        sell_total_qty: Decimal,
    ) -> FifoMatch:
        """
        Create a FifoMatch for an orphan sell (no matching buy record).

        Revenue is calculated normally; cost basis is 0.
        Polish tax law: sell revenue is taxable even without proof of purchase.
        """
        sell_rate = sell_tx.nbp_rate or Decimal("1")

        # Proportional commission allocation for the orphan portion
        sell_commission_share = (
            sell_tx.commission * quantity / sell_total_qty
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        sell_revenue_pln = (
            (sell_tx.price * quantity - sell_commission_share) * sell_rate
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        return FifoMatch(
            symbol=symbol,
            quantity=quantity,
            buy_date=sell_tx.trade_date,       # unknown – use sell date
            buy_settlement_date=sell_tx.settlement_date,
            buy_price=Decimal("0"),
            buy_currency=sell_tx.currency,
            buy_commission=Decimal("0"),
            buy_nbp_rate=Decimal("0"),
            buy_cost_pln=Decimal("0"),
            sell_date=sell_tx.trade_date,
            sell_settlement_date=sell_tx.settlement_date,
            sell_price=sell_tx.price,
            sell_currency=sell_tx.currency,
            sell_commission=sell_commission_share,
            sell_nbp_rate=sell_rate,
            sell_revenue_pln=sell_revenue_pln,
            profit_pln=sell_revenue_pln,        # profit = revenue - 0
            is_orphan=True,
        )

    def _create_match(
        self,
        symbol: str,
        quantity: Decimal,
        buy_tx: UnifiedTransaction,
        sell_tx: UnifiedTransaction,
        buy_total_qty: Decimal,
        sell_total_qty: Decimal,
    ) -> FifoMatch:
        """
        Create a FifoMatch for a given quantity.

        Commission is allocated proportionally when a transaction
        is split across multiple matches.
        """
        buy_rate = buy_tx.nbp_rate or Decimal("1")
        sell_rate = sell_tx.nbp_rate or Decimal("1")

        # Proportional commission allocation
        buy_commission_share = (
            buy_tx.commission * quantity / buy_total_qty
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        sell_commission_share = (
            sell_tx.commission * quantity / sell_total_qty
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        # Cost = (price * qty + commission) * NBP rate
        buy_cost_pln = (
            (buy_tx.price * quantity + buy_commission_share) * buy_rate
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        # Revenue = (price * qty - commission) * NBP rate
        sell_revenue_pln = (
            (sell_tx.price * quantity - sell_commission_share) * sell_rate
        ).quantize(TWO_PLACES, ROUND_HALF_UP)

        profit = sell_revenue_pln - buy_cost_pln

        return FifoMatch(
            symbol=symbol,
            quantity=quantity,
            buy_date=buy_tx.trade_date,
            buy_settlement_date=buy_tx.settlement_date,
            buy_price=buy_tx.price,
            buy_currency=buy_tx.currency,
            buy_commission=buy_commission_share,
            buy_nbp_rate=buy_rate,
            buy_cost_pln=buy_cost_pln,
            sell_date=sell_tx.trade_date,
            sell_settlement_date=sell_tx.settlement_date,
            sell_price=sell_tx.price,
            sell_currency=sell_tx.currency,
            sell_commission=sell_commission_share,
            sell_nbp_rate=sell_rate,
            sell_revenue_pln=sell_revenue_pln,
            profit_pln=profit,
        )
