"""A script-owned workbook and optional live browser editor, sharing one graph."""

from __future__ import annotations

import asyncio
import copy
import inspect
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import replace
import os
from pathlib import Path
import secrets
from threading import Event, Thread, get_ident
from typing import Any, Callable, Coroutine, Generator, Literal, Mapping

from reaktiv import untracked

from .model import SheetDocument, make_snapshot
from .narrowing import as_mapping, string_list
from .runtime import RuntimeServer
from .sandbox import SESSION_TOKEN
from .workbook import WorkbookSnapshot

PASSIVE = frozenset(
    {"/v1/usage", "/v1/progress", "/v1/interrupt", "/v1/check", "/v1/editor", "/v1/cancel-action", "/v1/cancel-resource", "/v1/action-inputs"}
)
MUTATIONS = frozenset(
    {
        "/v1/apply",
        "/v1/update-action",
        "/v1/move-workbook",
        "/v1/run-effect",
        "/v1/run-action",
        "/v1/set-inputs",
        "/v1/widget-update",
        "/v1/widget-message",
        "/v1/tick-timer",
        "/v1/clear-logs",
        "/v1/session-save",
    }
)

# App mode accepts interaction with the existing graph, never author-supplied
# Python, document replacement, console evaluation, or file saves.
RUN_ENDPOINTS = frozenset({
    '/v1/session', '/v1/usage', '/v1/progress', '/v1/set-inputs',
    '/v1/run-action', '/v1/cancel-action', '/v1/cancel-resource',
    '/v1/widget-update', '/v1/widget-message', '/v1/resample',
    '/v1/tick-timer', '/v1/clear-logs',
    '/v1/session-reset-input', '/v1/files',
})


class SessionCell:
    """A live label/coordinate reference; each operation runs on the session owner."""

    def __init__(
        self, session: WorkbookSession, reference: str, sheet: str, writable: bool
    ) -> None:
        self._session, self._reference, self._sheet, self._writable = (
            session,
            reference,
            sheet,
            writable,
        )

    def get(self) -> Any:
        return self._session.read(self._reference, self._sheet)

    def __call__(self) -> Any:
        return self.get()

    def call(self, *args: Any, **kwargs: Any) -> Any:
        """Invoke a function-valued cell on the owner thread (including async functions)."""
        return self._session.invoke(self._reference, self._sheet, args, kwargs)

    def set(self, value: Any) -> None:
        if not self._writable:
            raise TypeError("Use session.inputs to write input values")
        self._session.write(self._reference, self._sheet, "set", value)

    def update(self, fn: Callable[[Any], Any]) -> None:
        if not self._writable:
            raise TypeError("Use session.inputs to write input values")
        self._session.write(self._reference, self._sheet, "update", fn)

    def reset(self) -> None:
        if not self._writable:
            raise TypeError("Use session.inputs to reset linked inputs")
        self._session.write(self._reference, self._sheet, "reset", None)


class SessionNamespace:
    def __init__(self, session: WorkbookSession, writable: bool, sheet: str = "") -> None:
        self._session, self._writable, self._sheet = session, writable, sheet

    def __getattr__(self, name: str) -> Any:
        if not self._sheet and name in self._session.document.sheet_names:
            return SessionNamespace(self._session, self._writable, name)
        return self[name]

    def __getitem__(self, reference: str) -> SessionCell:
        self._session.check_reference(reference, self._sheet, self._writable)
        return SessionCell(self._session, reference, self._sheet, self._writable)


class _SessionRuntime(RuntimeServer):
    def __init__(self, session: WorkbookSession) -> None:
        super().__init__()
        self._loop.close()
        self._loop = session.loop
        self.session = session
        self.gate = asyncio.Lock()

    def dispatch(self, path: str, payload: Mapping[str, Any]) -> Any:
        if self.session.mode == 'run' and path not in RUN_ENDPOINTS:
            raise RuntimeError('This workbook is in run mode. Use reaktiv-workbook edit to author or save it.')
        if path == '/v1/files':
            # Path widgets pick paths on the machine running the CLI; names only, no contents.
            from .file_browser import list_directory
            return list_directory(payload, self.session.path.parent, self.session.shared_root)
        if path == '/v1/set-inputs' and self.session.shared_root is not None:
            self._check_shared_paths(payload)
        if path == '/v1/git':
            # The workbook's own folder; the browser never chooses where git runs.
            from .git_host import run_git
            args = string_list(payload.get('args'))
            if args is None:
                raise TypeError('args must be a list of strings')
            result = run_git(self.session.path.parent, args)
            if args[0] == 'pull' and result['code'] == 0:
                # Pull changed the file on disk: the session continues with that version.
                self.session.submit(self._reload_from_disk())
            return result
        if path in PASSIVE:
            return super().dispatch(path, payload)
        return self.session.submit(self.execute(path, payload))

    def _check_shared_paths(self, payload: Mapping[str, Any]) -> None:
        """File and folder inputs of a network session take paths inside the workbook's folder."""
        import ast
        from .file_browser import resolve_within
        sources = as_mapping(payload.get('sources')) or {}
        for cell in self.session.document.cells:
            source = sources.get(cell.id)
            widget = as_mapping((cell.view or {}).get('widget'))
            if not isinstance(source, str) or widget is None or widget.get('type') not in ('file', 'folder'):
                continue
            try:
                value = ast.literal_eval(source)
            except (ValueError, SyntaxError):
                continue  # not a literal: the runtime refuses it
            if isinstance(value, str) and value:
                resolve_within(value, self.session.path.parent, self.session.shared_root)

    async def _reload_from_disk(self) -> None:
        async with self.gate:
            document = SheetDocument.load(self.session.path)
            self.session.publish(await self.workbook.load_document_async(document))
            self.session.note_source_format()

    async def execute(self, path: str, payload: Mapping[str, Any]) -> Any:
        return await self.execution.run(lambda: self._execute_request(path, payload),
            action=path == '/v1/run-action', inputs=path in {'/v1/set-inputs', '/v1/session-reset-input'})

    async def _execute_request(self, path: str, payload: Mapping[str, Any]) -> Any:
        if path == '/v1/session-reset-input':
            cell_id = payload.get('cellId')
            if not isinstance(cell_id, str):
                raise TypeError('cellId must be a string')
            snapshot = await self.workbook.set_input_values_async({}, [cell_id])
            self.session.publish(snapshot)
            return {**snapshot.to_dict(), 'sessionRevision': self.session.revision}
        if self.session.mode == 'run' and path == '/v1/run-action':
            if not any(action.exposed and action.name == payload.get('name') for action in self.workbook.document.actions):
                raise ValueError('Only exposed workbook actions can run in app mode')
        if path == "/v1/session":
            return (
                None
                if payload.get("after") == self.session.revision
                else self.session.state(include_assets=payload.get('after') is None)
            )
        if path == "/v1/restart":
            raise RuntimeError(
                "This workbook is owned by its Python script; restart the session from that script"
            )
        if path == "/v1/session-restart":
            # Restart with the workbook's packages: the CLI that owns this session starts a new
            # (sandboxed) Python with the editor's workbook, unsaved edits included.
            if self.session.restart is None:
                raise RuntimeError("Only reaktiv-workbook edit can restart its Python; restart this script yourself")
            value = as_mapping(payload.get("document"))
            if value is None:
                raise TypeError("document must be an object")
            self.session.restart(SheetDocument.from_dict(value))
            return {"restarting": True}
        if (
            path in MUTATIONS and path not in {"/v1/run-action", "/v1/set-inputs"}
            and payload.get("sessionRevision") != self.session.revision
        ):
            raise RuntimeError(
                "Session conflict: the workbook changed. Refresh before applying this edit"
            )
        self._running_thread = get_ident()
        try:
            if path == "/v1/session-save":
                value = as_mapping(payload.get("document"))
                if value is None:
                    raise TypeError("document must be an object")
                document = SheetDocument.from_dict(value)
                if "saveOutputs" in payload:
                    document = replace(document, save_outputs=payload["saveOutputs"])
                from .session_assets import write_assets
                assets = as_mapping(payload.get('assets', {}))
                if assets is None or not all(isinstance(value, str) for value in assets.values()):
                    raise TypeError('assets must map image references to base64 strings')
                write_assets(self.session.path, document, {key: str(value) for key, value in assets.items()})
                snapshot = await self.workbook.load_document_async(document)
                self.session.publish(snapshot)
                # Like marimo, an older-format file is upgraded in place (format 2).
                self.session.save_current()
                return self.session.state()
            document = as_mapping(payload.get("document"))
            if path == "/v1/apply" and document is not None:
                if "enableUpdateTracing" in payload:
                    self.workbook.set_update_tracing(payload["enableUpdateTracing"] is True)
                stopped = None if payload.get("stopped") is None else string_list(payload["stopped"])
                if payload.get("stopped") is not None and stopped is None:
                    raise TypeError("stopped must be an array of cell ids")
                result = (
                    await self.workbook.load_document_async(
                        SheetDocument.from_dict(document),
                        allow_cell_writes=payload.get("allowCellWrites", True)
                        is not False,
                        stopped=stopped,
                    )
                ).to_dict()
            else:
                result = await super().dispatch_async(path, payload)
            if path in MUTATIONS:
                # Graph endpoints already took a snapshot; don't consume writes twice.
                graph = as_mapping(result)
                if path == "/v1/move-workbook" and graph is not None:
                    graph = as_mapping(graph.get("graph"))
                if graph is None or "cells" not in graph:
                    graph = self.workbook.snapshot().to_dict()
                self.session.publish_graph(dict(graph))
                mapping = as_mapping(result)
                if mapping is not None:
                    result = {**mapping, "sessionRevision": self.session.revision}
            return result
        finally:
            self._running_thread = None


LOOPBACK_HOSTS = ('127.0.0.1', 'localhost', '::1')


def reachable_address(host: str) -> str:
    """The address for a link to a server listening on ``host``: a wildcard listens on every
    interface, so the link names this machine's network address instead."""
    import socket
    if host in ('0.0.0.0', '::', ''):
        family = socket.AF_INET6 if host == '::' else socket.AF_INET
        try:
            with socket.socket(family, socket.SOCK_DGRAM) as probe:
                # Connecting a UDP socket sends nothing; it only picks the outgoing interface.
                probe.connect(('2001:db8::1', 9) if family == socket.AF_INET6 else ('192.0.2.1', 9))
                host = str(probe.getsockname()[0])
        except OSError:
            host = socket.gethostname()
    return f'[{host}]' if ':' in host else host


class WorkbookSession:
    """Load a workbook for production code; attach an editor without a second graph.

    Use ``WorkbookSession.load(path)`` as a context manager. Synchronous API calls are
    serialized onto a dedicated asyncio owner thread; resources and clocks keep
    running when no browser is attached. Values returned to the caller are actual
    Python objects and should be treated as read-only.
    """

    def __init__(self, path: str | Path, document: SheetDocument | None = None) -> None:
        """``document`` starts the session from that workbook (a restart's unsaved state)
        instead of the file; saving still writes ``path``."""
        self.path = Path(path).resolve()
        self.mode: Literal['embedded', 'edit', 'run'] = 'embedded'
        # Set by the CLI (`reaktiv-workbook edit`): restart Python with the editor's workbook.
        self.restart: Callable[[SheetDocument], None] | None = None
        # Shared on the network: paths from the browser must stay inside this folder.
        self.shared_root: Path | None = None
        document = document if document is not None else SheetDocument.load(self.path)
        self.note_source_format()
        self.loop = asyncio.new_event_loop()
        self._closed = False
        self.revision = 0
        self._graph: dict[str, Any] = {}
        self._timers: list[asyncio.TimerHandle] = []
        self._refresh_task: asyncio.Task[None] | None = None
        self._pending: ContextVar[list[tuple[str, str, str, Any]] | None] = ContextVar(
            "sheet_session_batch", default=None
        )
        self._server: Any = None  # api.serving.BackgroundServer, once an editor is opened
        # From the CLI that restarted this session; not left in the environment of cell code.
        self._token = os.environ.pop(SESSION_TOKEN, None) or secrets.token_urlsafe(32)
        self._ready = Event()
        self._runtime: _SessionRuntime
        self._thread = Thread(
            target=self._run, name="reaktiv-workbook-session", daemon=True
        )
        self._thread.start()
        self._ready.wait()
        self.inputs = SessionNamespace(self, True)
        self.values = SessionNamespace(self, False)
        try:
            self.submit(self._load(document))
        except BaseException:
            self.close()
            raise

    @classmethod
    def load(cls, path: str | Path) -> WorkbookSession:
        return cls(path)

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)
        self._runtime = _SessionRuntime(self)
        self._runtime.workbook.progress = self.report_progress
        self._ready.set()
        self.loop.run_forever()
        self.loop.close()

    def submit(self, coroutine: Coroutine[Any, Any, Any]) -> Any:
        if self._closed or get_ident() == self._thread.ident:
            coroutine.close()
            raise RuntimeError(
                "Session is closed"
                if self._closed
                else "Cannot perform a blocking session mutation inside its own callback"
            )
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result()

    async def _load(self, document: SheetDocument) -> None:
        async with self._runtime.gate:
            self.publish(await self._runtime.workbook.load_document_async(document))

    @property
    def document(self) -> SheetDocument:
        if get_ident() == self._thread.ident:
            return self._runtime.workbook.document

        async def read() -> SheetDocument:
            async with self._runtime.gate:
                return self._runtime.workbook.document

        return self.submit(read())

    def _resolve(self, reference: str, sheet: str) -> str:
        document = self._runtime.workbook.document
        if "." in reference:
            sheet, reference = reference.split(".", 1)
        sheet = sheet or document.sheet_name
        if sheet not in document.sheet_names:
            raise KeyError(f"Unknown sheet: {sheet}")
        prefix = "" if sheet == document.sheet_name else sheet
        for cell in document.cells:
            cell_prefix, _, coordinate = cell.id.rpartition("!")
            if cell_prefix == prefix and reference in (coordinate, cell.name):
                return cell.id
        raise KeyError(f"Unknown cell: {sheet}.{reference}")

    def check_reference(self, reference: str, sheet: str, writable: bool) -> None:
        def check() -> None:
            cell_id = self._resolve(reference, sheet)
            cell = next(
                c for c in self._runtime.workbook.document.cells if c.id == cell_id
            )
            if cell.kind == "effect" or (
                writable and cell.kind not in ("input", "linked")
            ):
                raise TypeError(
                    f"{reference} is not {'an input' if writable else 'a value cell'}"
                )

        if get_ident() == self._thread.ident:
            check()
            return

        async def read() -> None:
            async with self._runtime.gate:
                check()

        self.submit(read())

    def read(self, reference: str, sheet: str) -> Any:
        if get_ident() == self._thread.ident:
            return self._runtime.workbook.value(self._resolve(reference, sheet))

        async def read() -> Any:
            async with self._runtime.gate:
                return self._runtime.workbook.value(self._resolve(reference, sheet))

        return self.submit(read())

    def invoke(
        self, reference: str, sheet: str, args: tuple[Any, ...], kwargs: dict[str, Any]
    ) -> Any:
        async def call() -> Any:
            async with self._runtime.gate:
                function = self._runtime.workbook.value(self._resolve(reference, sheet))
                if not callable(function):
                    raise TypeError(f"{reference} does not contain a function")
                result = function(*args, **kwargs)
                return await result if inspect.isawaitable(result) else result

        return self.submit(call())

    def run_action(self, name: str, **arguments: Any) -> Any:
        """Invoke an exposed method on this session's owner, using literal arguments."""
        async def run() -> Any:
            async def invoke() -> Any:
                snapshot = await self._runtime.workbook.run_action_async(name, {key:{'value':value} for key,value in arguments.items()})
                self.publish(snapshot)
                if snapshot.action_error is not None:
                    raise snapshot.action_error
                return snapshot.action_value
            return await self._runtime.execution.run(invoke, action=True)
        return self.submit(run())

    def write(self, reference: str, sheet: str, operation: str, value: Any) -> None:
        pending = self._pending.get()
        item = (reference, sheet, operation, value)
        if pending is not None:
            pending.append(item)
        else:
            self.submit(self.write_many([item]))

    async def write_many(self, operations: list[tuple[str, str, str, Any]]) -> None:
        async with self._runtime.gate:
            values: dict[str, Any] = {}
            resets: set[str] = set()
            for reference, sheet, operation, value in operations:
                cell_id = self._resolve(reference, sheet)
                definition = next(
                    c for c in self._runtime.workbook.document.cells if c.id == cell_id
                )
                if definition.kind not in ("input", "linked") or (
                    operation == "reset" and definition.kind != "linked"
                ):
                    raise TypeError(
                        f"{reference} is not a writable {'linked input' if operation == 'reset' else 'input'}"
                    )
                if operation == "reset":
                    values.pop(cell_id, None)
                    resets.add(cell_id)
                else:
                    if operation == "update":
                        if cell_id in resets:
                            raise ValueError(
                                "Reset and update the same linked input in separate batches"
                            )
                        previous = (
                            values[cell_id]
                            if cell_id in values
                            else self._runtime.workbook.value(cell_id)
                        )
                        value = value(copy.deepcopy(previous))
                    values[cell_id] = value
                    resets.discard(cell_id)
            self.publish(
                await self._runtime.workbook.set_input_values_async(values, resets)
            )

    @contextmanager
    def batch(self) -> Generator[None, None, None]:
        """Commit several writes/updates together; failure discards queued operations."""
        if self._pending.get() is not None:
            yield
            return
        operations: list[tuple[str, str, str, Any]] = []
        token = self._pending.set(operations)
        try:
            yield
        finally:
            self._pending.reset(token)
        if operations:
            self.submit(self.write_many(operations))

    def report_progress(self, event: str, cell_id: str) -> None:
        self._runtime.progress.add(event, cell_id)
        # Resource completions can happen after an HTTP action has returned.
        # Publish them without a second apply; ordinary transactions already
        # publish and supersede the revision this refresh observed.
        if event == "end" and not self._closed and self._refresh_task is None:
            self._refresh_task = self.loop.create_task(self.refresh_after(self.revision))

    async def refresh_after(self, revision: int) -> None:
        try:
            async with self._runtime.gate:
                if not self._closed and self.revision == revision:
                    with untracked():
                        self.publish(self._runtime.workbook.snapshot())
        finally:
            self._refresh_task = None

    def publish(self, snapshot: WorkbookSnapshot) -> None:
        self.publish_graph(snapshot.to_dict())

    def publish_graph(self, graph: dict[str, Any]) -> None:
        self.revision += 1
        self._graph = graph
        for timer in self._timers:
            timer.cancel()
        self._timers.clear()
        for timer in self._runtime.workbook.timer_schedule():
            cell_id = str(timer["cellId"])
            delay = float(timer["nextInSeconds"])
            self._timers.append(
                self.loop.call_later(
                    max(0.001, delay),
                    lambda cell_id=cell_id: self.loop.create_task(self._tick(cell_id)),
                )
            )

    async def _tick(self, cell_id: str) -> None:
        async with self._runtime.gate:
            if self._closed:
                return
            self.publish(await self._runtime.workbook.tick_timer_async(cell_id))

    @property
    def token(self) -> str:
        return self._token

    @property
    def port(self) -> int | None:
        return None if self._server is None else self._server.port

    def environment(self) -> dict[str, Any]:
        """The session's Python: sandboxed or not, whether the CLI can restart it with the
        workbook's packages, and which declared packages are not installed."""
        from .sandbox import SANDBOXED, find_uv, missing_packages
        return {
            'sandboxed': bool(os.environ.get(SANDBOXED)),
            'restart': self.restart is not None and find_uv() is not None,
            'missing': missing_packages(self._runtime.workbook.document.packages),
        }

    def state(self, *, include_assets: bool = False) -> dict[str, Any]:
        from .session_assets import read_assets
        return {
            'mode': self.mode,
            'path': str(self.path),
            'environment': self.environment(),
            **({'assets': read_assets(self.path, self.document)} if include_assets else {}),
            "revision": self.revision,
            "document": {**replace(self._runtime.workbook.document, snapshot=None).to_dict(), "sourceFormatVersion": self._source_format_version, "sourceFileName": self.path.name},
            "graph": copy.deepcopy(self._graph),
        }

    def note_source_format(self) -> None:
        from .file_api import python_source_format
        self._source_format_version = python_source_format(self.path.read_text(encoding="utf-8"))

    def save_current(self, *, save_outputs: bool | None = None) -> None:
        document = self._runtime.workbook.document
        save_outputs = document.save_outputs if save_outputs is None else save_outputs
        snapshot = make_snapshot(
            self._graph.get("cells", []),
            self._graph.get("dependencies", {}),
            widget_dependencies=self._graph.get("widgetDependencies", {}),
            source_dependencies=self._graph.get("sourceDependencies", {}),
            dependency_states=self._graph.get("dependencyStates", {}),
        ) if save_outputs else None
        replace(document, snapshot=snapshot, save_outputs=save_outputs).save(self.path)
        self._source_format_version = 2  # every save writes format 2

    def save(self) -> None:
        """Save current definitions and their snapshot beside the originally loaded file."""

        async def save() -> None:
            async with self._runtime.gate:
                self.save_current()

        self.submit(save())

    def open_editor(self, app_url: str | None = None, *, host: str = '127.0.0.1',
                     port: int = 0, open_browser: bool = True, allow_remote: bool = False) -> str:
        """Serve the editor and return its link. ``allow_remote`` lets ``host`` be any
        address (``0.0.0.0`` for every interface): whoever has the link can run Python."""
        from .api import KernelSettings, create_app
        from .api.serving import BackgroundServer
        from urllib.parse import urlencode, urlsplit, urlunsplit
        import webbrowser
        if self._closed:
            raise RuntimeError('Session is closed')
        remote = host not in LOOPBACK_HOSTS
        if remote and not allow_remote:
            raise ValueError('Listening on a network address needs allow_remote=True')
        if allow_remote:
            # Shared (directly or through a proxy): the file/folder picker and path inputs
            # stay inside the workbook's folder.
            self.shared_root = self.path.parent
        if remote and app_url:
            raise ValueError('A network session serves its own editor; omit app_url')
        base = urlsplit(app_url) if app_url else None
        if base and (base.scheme != 'http' or base.hostname not in ('localhost', '127.0.0.1', '::1') or base.username or base.password):
            raise ValueError('Use a local HTTP app URL to connect to this loopback session')
        from .standalone import frontend_root
        root = None if app_url else frontend_root()
        if self._server is None:
            app = create_app(self._runtime, KernelSettings(token=self._token), owns_runtime=False, static_root=root)
            self._server = BackgroundServer(app, host=host, port=port)
        address = reachable_address(host)
        endpoint = f'http://{address}:{self._server.port}'
        # Served by the session itself, the editor attaches to the page's own origin (`/`),
        # so the link keeps working through a tunnel or proxy under another address.
        session = endpoint if base else '/'
        base = base or urlsplit(endpoint + '/')
        url = urlunsplit((base.scheme, base.netloc, base.path, urlencode({'session': session}), urlencode({'token': self._token})))
        if open_browser:
            webbrowser.open(url)
        return url

    def __enter__(self) -> WorkbookSession:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        if self._closed:
            return
        if get_ident() == self._thread.ident:
            raise RuntimeError("Close the session from its owning script")
        if self._server is not None:
            self._server.stop()

        async def cleanup() -> None:
            for timer in self._timers:
                timer.cancel()
            self._runtime.editor.close()
            self._runtime.workbook.close()
            tasks = [
                task
                for task in asyncio.all_tasks()
                if task is not asyncio.current_task()
            ]
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        self.submit(cleanup())
        self._closed = True
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join()


# Compatibility for existing embedded scripts.
SheetSession = WorkbookSession
