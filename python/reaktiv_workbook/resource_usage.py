"""Current kernel-process CPU and resident memory, independent of cell evaluation."""

from __future__ import annotations

from threading import Lock
import time
from typing import Any, Callable, Optional

import psutil


class ProcessUsage:
    """A sampler per process. CPU is a percentage of one core, so may exceed 100%.

    Cache for one second: dashboard and workbook clients must not shorten each other's
    sampling interval. The first CPU sample is unknown, not a misleading idle reading.
    """

    def __init__(self, pid: Optional[int] = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.pid = pid
        self._process = psutil.Process(pid)
        self._clock = clock
        self._lock = Lock()
        self._sampled_at: Optional[float] = None
        self._cached: Optional[dict[str, Any]] = None

    def sample(self) -> dict[str, Any]:
        with self._lock:
            now = self._clock()
            if self._sampled_at is not None and now - self._sampled_at < 1 and self._cached is not None:
                return dict(self._cached)
            try:
                cpu = self._process.cpu_percent(interval=None)
                memory = self._process.memory_info().rss
                result: dict[str, Any] = {
                    "cpuPercent": cpu if self._sampled_at is not None else None,
                    "memoryBytes": memory,
                    "memoryKind": "resident",
                }
            except (psutil.Error, OSError):
                result = {"cpuPercent": None, "memoryBytes": None, "memoryKind": "resident"}
            self._sampled_at, self._cached = now, result
            return dict(result)
