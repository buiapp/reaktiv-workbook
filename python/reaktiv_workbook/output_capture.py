"""Capture cell output by thread/task context without swallowing host-script output."""

from __future__ import annotations
from contextlib import contextmanager
from contextvars import ContextVar
import io
import sys
from threading import RLock
from typing import Any, Callable, Optional

_ROUTER_LOCK = RLock()

# print() output and warnings of resource loaders. Several loaders await at the same
# time, so contextlib.redirect_stdout (which swaps sys.stdout globally and restores it in
# exit order) would leave stdout pointing at a finished loader's buffer. Instead
# sys.stdout / sys.stderr are routers while any loader runs, and each asyncio task writes
# to its own (stdout, stderr) buffers.
_TASK_OUTPUT: ContextVar[Optional[tuple[io.StringIO, io.StringIO]]] = ContextVar(
    "reaktiv_workbook_task_output", default=None
)


class _OutputRouter(io.TextIOBase):
    def __init__(self, fallback: Any, index: int) -> None:
        self.fallback = fallback
        self.index = index
        self.users = 0

    def write(self, text: str) -> int:
        target = _TASK_OUTPUT.get()
        return (self.fallback if target is None else target[self.index]).write(text)

    def flush(self) -> None:
        target = _TASK_OUTPUT.get()
        (self.fallback if target is None else target[self.index]).flush()


@contextmanager
def capture_output(output: io.StringIO, warnings: io.StringIO):
    routers: list[tuple[str, _OutputRouter]] = []
    with _ROUTER_LOCK:
        for index, name in enumerate(("stdout", "stderr")):
            current: object = getattr(sys, name)
            router = (
                current
                if isinstance(current, _OutputRouter)
                else _OutputRouter(current, index)
            )
            router.users += 1
            setattr(sys, name, router)
            routers.append((name, router))
    token = _TASK_OUTPUT.set((output, warnings))
    try:
        yield
    finally:
        _TASK_OUTPUT.reset(token)
        with _ROUTER_LOCK:
            for name, router in routers:
                router.users -= 1
                if router.users == 0 and getattr(sys, name) is router:
                    setattr(sys, name, router.fallback)


class LineOutput(io.StringIO):
    """Publish complete lines/flushes without retaining a whole action's output.

    Long lines are emitted in bounded chunks; getvalue contains only an unfinished
    line, so draining at the end cannot replay already published output.
    """

    LIMIT = 4096

    def __init__(self, emit: Callable[[str], None]) -> None:
        super().__init__()
        self._emit = emit

    def write(self, text: str) -> int:
        for offset in range(0, len(text), self.LIMIT):
            parts = (self.getvalue() + text[offset:offset + self.LIMIT]).split("\n")
            self.seek(0)
            self.truncate(0)
            for line in parts[:-1]:
                self._publish(line)
            tail = parts[-1]
            while len(tail) >= self.LIMIT:
                self._publish(tail[:self.LIMIT])
                tail = tail[self.LIMIT:]
            super().write(tail)
        return len(text)

    def _publish(self, text: str) -> None:
        # Ignore empty output, preserving whitespace within long-line chunks.
        if not text.strip():
            return
        for offset in range(0, len(text), self.LIMIT):
            self._emit(text[offset:offset + self.LIMIT])

    def flush(self) -> None:
        if self.closed:
            return
        tail = self.getvalue()
        self.seek(0)
        self.truncate(0)
        self._publish(tail)
