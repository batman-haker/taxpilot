"""
Abstract base parser. All broker-specific parsers extend this.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import IO

from app.models import UnifiedTransaction


class BaseParser(ABC):
    """
    Base class for broker file parsers.

    Each parser must implement:
      - detect()  : check if a file belongs to this broker
      - parse()   : convert raw file into list of UnifiedTransaction
    """

    broker_name: str = "UNKNOWN"

    @staticmethod
    @abstractmethod
    def detect(file_content: str | bytes, filename: str = "") -> bool:
        """Return True if this parser can handle the given file."""
        ...

    @abstractmethod
    def parse(self, file_content: str | bytes, filename: str = "") -> list[UnifiedTransaction]:
        """Parse raw file content into normalised transactions."""
        ...
