"""Coordinate graph definition changes without locking an async action's lifetime."""
from __future__ import annotations

import asyncio
from typing import Any, Coroutine, Callable


class ExecutionGate:
    def __init__(self) -> None:
        self._structure = asyncio.Lock()
        self._actions: set[asyncio.Task[Any]] = set()

    async def run(self, operation: Callable[[], Coroutine[Any, Any, Any]], *, action: bool = False, inputs: bool = False) -> Any:
        if inputs:
            return await operation()
        async with self._structure:
            if action:
                task = asyncio.create_task(operation())
                self._actions.add(task)
                task.add_done_callback(self._actions.discard)
            else:
                if self._actions:
                    await asyncio.gather(*tuple(self._actions), return_exceptions=True)
                return await operation()
        return await task
