"""
Broker auto-detection.
Tries each registered parser's detect() method and returns the matching one.
"""

from __future__ import annotations

from app.models import UnifiedTransaction
from app.parsers.base import BaseParser
from app.parsers.exante import ExanteParser
from app.parsers.ibkr import IBKRParser

# Register parsers here. Order matters – first match wins.
REGISTERED_PARSERS: list[type[BaseParser]] = [
    IBKRParser,
    ExanteParser,
]


def detect_and_parse(file_content: str | bytes, filename: str = "") -> list[UnifiedTransaction]:
    """
    Auto-detect broker from file content and parse into unified transactions.

    Raises ValueError if no parser matches.
    """
    for parser_cls in REGISTERED_PARSERS:
        if parser_cls.detect(file_content, filename):
            parser = parser_cls()
            return parser.parse(file_content, filename)

    raise ValueError(
        f"Could not detect broker format for file '{filename}'. "
        "Supported brokers: " + ", ".join(p.broker_name for p in REGISTERED_PARSERS)
    )
