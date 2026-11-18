"""Thread-safe literal-input mailbox; only the workbook owner touches the graph."""
from __future__ import annotations

import ast
from threading import Lock
from typing import Any, Mapping


class ActionInputs:
    def __init__(self) -> None:
        self._lock = Lock()
        self._runs: set[str] = set()
        self._kinds: dict[str, str] = {}
        self._pending: dict[str, tuple[str, Any]] = {}

    def begin(self, run: str, kinds: Mapping[str, str]) -> None:
        with self._lock:
            self._runs.add(run)
            self._kinds = dict(kinds)

    @staticmethod
    def parse(sources: Mapping[str, str]) -> dict[str, tuple[str, Any]]:
        if not sources or len(sources) > 100 or sum(len(source) for source in sources.values()) > 1_000_000:
            raise ValueError('Provide 1–100 literal widget inputs, up to 1 MB total')
        # Static literals only: never execute user expressions in a request thread.
        return {key: (source, ast.literal_eval(source)) for key, source in sources.items()}

    def submit(self, run: str, sources: Mapping[str, str]) -> bool:
        values = self.parse(sources)
        with self._lock:
            if run not in self._runs:
                return False
            for key in sources:
                if self._kinds.get(key) not in ('input', 'linked'):
                    raise ValueError(f'{key} is not a writable input in this action run')
            self._pending.update(values)  # Coalesce rapid slider/checkbox writes per cell.
            return True

    def take(self, *, finish: bool = False) -> dict[str, tuple[str, Any]]:
        with self._lock:
            pending, self._pending = self._pending, {}
            if finish:
                self._runs.clear()
                self._kinds.clear()
            return pending

    def finish(self, run: str) -> None:
        with self._lock:
            self._runs.discard(run)
            if not self._runs:
                self._kinds.clear()
