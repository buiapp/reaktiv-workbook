"""The kernel's execution service: one owner loop, coordinated updates, and requests that
are answered beside them (progress, usage, interrupt, type checks, editor queries).

Transport-free on purpose: the HTTP application in ``api/`` and
the script-owned ``WorkbookSession`` both drive it through :meth:`RuntimeServer.dispatch`, and it
imports no web framework, so it stays usable from tests and other hosts.
"""

from __future__ import annotations

import asyncio
import ctypes
import os
from time import perf_counter
from threading import Lock, Thread, get_ident
from typing import Any, Mapping, Optional

# Cells run on the kernel owner thread, and matplotlib's default macOS backend refuses to make
# figures off the main thread. Figures are rendered to images anyway, so no GUI backend.
os.environ.setdefault("MPLBACKEND", "Agg")

from .execution_gate import ExecutionGate  # noqa: E402
from .editor import EditorService  # noqa: E402
from .file_api import inspect_document  # noqa: E402
from .model import SheetDocument, move_cell_group, move_cells, verify_written_document  # noqa: E402
from .narrowing import as_list, as_mapping, string_list  # noqa: E402
from .resource_usage import ProcessUsage  # noqa: E402
from .typecheck import check_document  # noqa: E402
from .workbook import CellInterrupted, ReactiveWorkbook  # noqa: E402

class RuntimeServer:
    """Single-workbook request dispatcher used by the reference HTTP server."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._lock = Lock()
        self._owner_thread: Thread | None = None
        self.execution = ExecutionGate()
        self._check_lock = Lock()
        self._running_thread: Optional[int] = None
        self._console_running = False
        self.progress = ProgressLog()
        self.usage = ProcessUsage()
        self.editor = EditorService()
        self.workbook = self._new_workbook()

    def _new_workbook(self) -> ReactiveWorkbook:
        workbook = ReactiveWorkbook()
        workbook.progress = self.progress.add
        workbook.log_reporter = self.progress.add_log
        workbook.snapshot_reporter = self.progress.add_snapshot
        return workbook

    def dispatch(self, path: str, payload: Mapping[str, Any]) -> Any:
        if path == '/v1/action-inputs':
            sources = as_mapping(payload.get('sources'))
            if sources is None or not all(isinstance(value, str) for value in sources.values()):
                raise TypeError('sources must map cell IDs to literal Python strings')
            accepted = self.workbook.action_inputs.submit(_string(payload, 'runId'), {key: str(value) for key, value in sources.items()})
            return {'accepted': accepted}
        if path == '/v1/cancel-resource':
            cell_id = _string(payload, 'cellId')
            loading = self.workbook.resource_loading(cell_id)
            if loading:
                self._loop.call_soon_threadsafe(self.workbook.cancel_resource, cell_id)
            return {'cancelled': loading}
        if path == '/v1/cancel-action':
            name = _string(payload, 'name')
            run_id = str(payload["runId"]) if payload.get("runId") else None
            running = self.workbook.action_invocation_running(name, run_id)
            if running:
                self._loop.call_soon_threadsafe(self.workbook.cancel_action, name, run_id)
            return {'cancelled':running}
        # Independent of the workbook lock, including while cells compute or wait.
        if path == "/v1/usage":
            return self.usage.sample()
        # Answered while another request runs: the app polls it during a long update.
        if path == "/v1/progress":
            after = payload.get("after")
            return self.progress.since(after if isinstance(after, int) else None)
        # Answered while another request runs: stop the cell that is running.
        if path == "/v1/interrupt":
            return {"interrupted": self.interrupt()}
        # Answered while cells run: it reads only the workbook it is sent.
        if path == "/v1/check":
            document = as_mapping(payload.get("document"))
            mode = payload.get("mode", "standard")
            if document is None or not isinstance(mode, str):
                raise TypeError("check needs a document and a mode")
            if not self._check_lock.acquire(blocking=False):
                return {"available": False, "reason": "A type check is already running", "diagnostics": []}
            try:
                return check_document(SheetDocument.from_dict(document), mode)
            finally:
                self._check_lock.release()
        if path == "/v1/editor":
            document = as_mapping(payload.get("document"))
            position = as_mapping(payload.get("position"))
            if document is None or position is None:
                raise TypeError("editor needs a document and cursor position")
            return self.editor.query(
                SheetDocument.from_dict(document),
                _string(payload, "sheet"),
                _string(payload, "source"),
                position,
                _string(payload, "action"),
                str(payload.get("completionKey", "")),
            )
        with self._lock:
            if self._owner_thread is None:
                self._owner_thread = Thread(target=self._run_owner, name='reaktiv-workbook-kernel', daemon=True)
                self._owner_thread.start()
        return asyncio.run_coroutine_threadsafe(self.execute(path, payload), self._loop).result()

    def _run_owner(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._running_thread = get_ident()
        self._loop.run_forever()

    async def execute(self, path: str, payload: Mapping[str, Any]) -> Any:
        started = perf_counter()
        queue_ms = 0.0
        async def operation() -> Any:
            nonlocal queue_ms
            queue_ms = (perf_counter() - started) * 1000
            return await self.dispatch_async(path, payload)
        result = await self.execution.run(operation,
            action=path == '/v1/run-action', inputs=path == '/v1/set-inputs')
        if path in {'/v1/move-workbook', '/v1/apply'} and (mapping := as_mapping(result)) is not None:
            result = {**mapping, 'timings': {**(as_mapping(mapping.get('timings')) or {}),
                'queueMs': queue_ms}}
        return result

    def interrupt(self) -> bool:
        """Interrupt running cells/console/sync actions, or cancel an async action.
        A cell fails with "Stopped" and stays stopped (the app can release it).
        Code blocked inside a C call (a long sleep, a huge NumPy operation) notices it when the
        call returns; the app restarts the kernel if it does not stop."""
        running = self.workbook.running_action_names()
        if running and all(self.workbook.action_is_async(name) for name in running):
            for name in running:
                self._loop.call_soon_threadsafe(self.workbook.cancel_action, name)
            return True
        thread = self._running_thread
        if thread is None or not (self.progress.running() or self._console_running):
            return False
        return ctypes.pythonapi.PyThreadState_SetAsyncExc(
            ctypes.c_ulong(thread), ctypes.py_object(CellInterrupted)
        ) == 1

    async def dispatch_async(self, path: str, payload: Mapping[str, Any]) -> Any:
        if path == '/v1/set-inputs':
            sources = as_mapping(payload.get('sources'))
            if sources is None or not all(isinstance(value, str) for value in sources.values()):
                raise TypeError('sources must map cell IDs to literal Python strings')
            return (await self.workbook.set_inputs_async({key: str(value) for key, value in sources.items()})).to_dict()
        if path == "/v1/update-action":
            definition = as_mapping(payload.get("definition"))
            if definition is None:
                raise TypeError("definition must be an object")
            return await self.workbook.update_action_async(definition, _string(payload, "expectedRevision"))
        if path == "/v1/move-workbook":
            from .moves import move_workbook
            return await move_workbook(self.workbook, _string(payload, "expectedRevision"),
                _string(payload, "sourceId"), _string(payload, "targetId"),
                _optional_strings(payload, "sourceIds", "an array of strings"))
        if path == "/v1/cell-memory":
            return self.workbook.cell_memory()
        if path == "/v1/console":
            self._console_running = True
            try:
                return self.workbook.run_console(_string(payload, "source"), _string(payload, "sheet"))
            finally:
                self._console_running = False
        if path == "/v1/inspect-document":
            return inspect_document(_string(payload, "source"))
        if path == "/v1/verify-document":
            document = as_mapping(payload.get("document"))
            if document is None:
                raise TypeError("document must be an object")
            return verify_written_document(_string(payload, "source"), document)
        if path == "/v1/apply":
            if "enableUpdateTracing" in payload:
                self.workbook.set_update_tracing(payload["enableUpdateTracing"] is True)
            variables = as_mapping(payload.get("variables", {}))
            if variables is None:
                raise TypeError("variables must be an object")
            imports = string_list(payload.get("imports", []))
            if imports is None:
                raise TypeError("imports must be an array of strings")
            sheets = _sheets(payload)
            code = payload.get("code")
            if code is not None and not isinstance(code, str):
                raise TypeError("code must be a string")
            stopped = _optional_strings(payload, "stopped", "an array of cell ids")
            return (
                await self.workbook.apply_async(
                    _cells(payload),
                    actions=[dict(item) for raw in (as_list(payload.get('actions')) or []) if (item := as_mapping(raw)) is not None],
                    variables=variables,
                    imports=imports,
                    sheets=sheets,
                    code=code,
                    stopped=stopped,
                    allow_cell_writes=payload.get("allowCellWrites", True) is not False,
                )
            ).to_dict()
        if path == "/v1/widget-update":
            state = as_mapping(payload.get("state"))
            if state is None:
                raise TypeError("state must be an object")
            model_id = payload.get("modelId")
            return self.workbook.update_widget(
                _string(payload, "cellId"), state, model_id if isinstance(model_id, str) else None
            ).to_dict()
        if path == "/v1/widget-message":
            buffers = as_list(payload.get("buffers") or [])
            if buffers is None:
                raise TypeError("buffers must be an array")
            model_id = payload.get("modelId")
            return self.workbook.widget_message(
                _string(payload, "cellId"),
                payload.get("content"),
                buffers,
                model_id if isinstance(model_id, str) else None,
            ).to_dict()
        if path == "/v1/tick-timer":
            return (await self.workbook.tick_timer_async(_string(payload, "cellId"))).to_dict()
        if path == "/v1/resample":
            ranges = as_mapping(payload.get("ranges"))
            if ranges is None and payload.get("ranges") is not None:
                raise TypeError("ranges must be an object of axis ranges")
            return self.workbook.resample_view(_string(payload, "token"), ranges)
        if path == '/v1/run-action':
            return (await self.workbook.run_action_async(_string(payload, 'name'), as_mapping(payload.get('arguments')),
                run_id=str(payload.get('runId') or '') or None)).to_dict()
        if path == "/v1/run-effect":
            return self.workbook.run_effect(_string(payload, "cellId")).to_dict()
        if path == "/v1/clear-logs":
            return self.workbook.clear_logs().to_dict()
        if path == "/v1/restart":
            self.workbook.close()
            self.workbook = self._new_workbook()
            return {"status": "restarted"}
        if path == "/v1/move-cells":
            source_ids = _optional_strings(payload, "sourceIds", "an array of strings")
            if source_ids is not None:
                moved = move_cell_group(
                    _cells(payload),
                    source_ids,
                    _string(payload, "sourceId"),
                    _string(payload, "targetId"),
                    _sheets(payload),
                )
            else:
                moved = move_cells(
                    _cells(payload),
                    _string(payload, "sourceId"),
                    _string(payload, "targetId"),
                    _sheets(payload),
                )
            return [cell.to_dict() for cell in moved]
        raise KeyError(f"Unknown endpoint: {path}")

    def close(self) -> None:
        self.editor.close()
        if self._owner_thread is not None:
            async def cleanup() -> None:
                self.workbook.close()
                tasks = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            asyncio.run_coroutine_threadsafe(cleanup(), self._loop).result()
            self._loop.call_soon_threadsafe(self._loop.stop)
            self._owner_thread.join()
        else:
            self.workbook.close()
        self._loop.close()


class ProgressLog:
    """Recent cell starts and ends, numbered, for clients that poll ``/v1/progress`` while
    an update runs (the Pyodide worker posts the same events as messages)."""

    LIMIT = 2000

    def __init__(self) -> None:
        self._lock = Lock()
        self._events: list[dict[str, Any]] = []
        self._sequence = 0
        self._logs: list[dict[str, Any]] = []
        self._depth = 0  # cells started and not yet ended (nested reads)
        self._snapshot: dict[str, Any] | None = None
        self._snapshot_sequence = 0

    def add_snapshot(self, snapshot: dict[str, Any]) -> None:
        with self._lock:
            self._sequence += 1
            self._snapshot_sequence = self._sequence
            self._snapshot = snapshot

    def add(self, event: str, cell_id: str) -> None:
        with self._lock:
            self._depth = max(0, self._depth + (1 if event == "start" else -1))
            self._sequence += 1
            self._events.append({"seq": self._sequence, "event": event, "cellId": cell_id})
            del self._events[: -self.LIMIT]

    def add_log(self, entry: dict[str, Any]) -> None:
        with self._lock:
            self._sequence += 1
            self._logs.append({"seq": self._sequence, "entry": entry})
            del self._logs[:-500]

    def running(self) -> bool:
        """Whether a cell's code is running now (not the engine between cells)."""
        with self._lock:
            return self._depth > 0

    def since(self, after: Optional[int]) -> dict[str, Any]:
        """Events numbered after ``after``; without it only the number to continue from."""
        with self._lock:
            events = [] if after is None else [item for item in self._events if item["seq"] > after]
            logs = [] if after is None else [item["entry"] for item in self._logs if item["seq"] > after]
            snapshot = self._snapshot if after is not None and self._snapshot_sequence > after else None
            return {"seq": self._sequence, "events": events, "logs": logs, "snapshot": snapshot}


def _cells(payload: Mapping[str, Any]) -> list[Any]:
    cells = as_list(payload.get("cells"))
    if cells is None:
        raise TypeError("cells must be an array")
    return cells


def _optional_strings(payload: Mapping[str, Any], key: str, description: str) -> Optional[list[str]]:
    if payload.get(key) is None:
        return None
    values = string_list(payload.get(key))
    if values is None:
        raise TypeError(f"{key} must be {description}")
    return values


def _sheets(payload: Mapping[str, Any]) -> Optional[list[str]]:
    """Sheet names, first = the sheet with plain cell ids (None: unchanged)."""
    return _optional_strings(payload, "sheets", "an array of sheet names")


def _string(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise TypeError(f"{key} must be a string")
    return value
