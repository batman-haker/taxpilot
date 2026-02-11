"""Quick test: parse all sample files and show results."""
import sys
sys.path.insert(0, ".")

from pathlib import Path
from app.parsers.detector import detect_and_parse

sample_dir = Path("../sample")

for f in sorted(sample_dir.iterdir()):
    if not f.is_file():
        continue
    print(f"\n{'='*60}")
    print(f"FILE: {f.name}")
    print(f"{'='*60}")

    try:
        content = f.read_bytes()
        txs = detect_and_parse(content, f.name)
        print(f"  Broker: {txs[0].broker if txs else '?'}")
        print(f"  Total transactions: {len(txs)}")

        buys = [t for t in txs if t.action.value == "BUY"]
        sells = [t for t in txs if t.action.value == "SELL"]
        divs = [t for t in txs if t.action.value == "DIVIDEND"]
        whts = [t for t in txs if t.action.value == "TAX_WHT"]

        print(f"  BUY: {len(buys)}, SELL: {len(sells)}, DIV: {len(divs)}, WHT: {len(whts)}")

        if txs:
            print(f"\n  First 3 transactions:")
            for t in txs[:3]:
                print(f"    {t.action.value:8s} {str(t.symbol):20s} qty={str(t.quantity):>10s} "
                      f"price={str(t.price):>12s} {t.currency} date={t.trade_date.date()}")

    except Exception as e:
        print(f"  ERROR: {e}")
