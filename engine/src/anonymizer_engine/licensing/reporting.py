"""Usage reporting interface.

Remote reporting is intentionally not implemented in this phase.
"""

from __future__ import annotations

from typing import Protocol

from anonymizer_engine.licensing.usage import UsageSnapshot


class UsageReporter(Protocol):
    def report(self, snapshot: UsageSnapshot) -> None:
        """Report a usage snapshot."""


class NoopReporter:
    def report(self, snapshot: UsageSnapshot) -> None:
        return None
