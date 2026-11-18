"""Reusable fine-grained reactive spreadsheet engine."""

from __future__ import annotations
import __future__

import ast
import asyncio
import inspect
import io
import linecache
import math
import statistics
from collections.abc import Callable, Iterable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from time import perf_counter
from types import MappingProxyType, SimpleNamespace
from typing import Any, cast
from uuid import uuid4


from reaktiv import (
    ComputeSignal,
    Effect,
    LinkedSignal,
    Resource,
    ResourceStatus,
    Signal,
    batch,
    untracked,
)
from reaktiv.subtle import current_consumer, signal_version
from .action import BoundAction, action

from . import resample as resampling
from . import widgets
from .action_inputs import ActionInputs
from .actions import ActionDefinition, resolve_action_references, action_validation_error, method_node, parameters, validate_action_bindings
from .artifact import Artifact, artifact
from .cell_access import CellNamespace, CellRef, literal_source
from .cell_compiler import (
    FORMULA_RESULT,
    cell_filename,
    compile_cell,
    compile_effect,
    compile_formula,
    compile_markdown,
    compile_resource,
    definition_dependencies,
)
from .cell_memory import value_memory
from .cell_outputs import CellOutputs
from .debug_console import PythonConsole
from .execution_errors import (
    CELL_LOCATION,
    ERROR_DETAIL,
    ERROR_ORIGIN,
    ResourcePendingError,
    cell_location,
    error_detail,
    error_message,
    error_origin,
)
from .execution_errors import (
    CellInterrupted as CellInterrupted,
)
from .execution_errors import (
    CellStopped as CellStopped,
)
from .html_output import HTML, html
from .model import (
    CELL_COLOR,
    CellDefinition,
    CellLike,
    SheetDocument,
    SheetTab,
    cell_member_names,
    input_source_with_value,
    normalize_cells,
    normalize_code,
    normalize_imports,
)
from .model import (
    cell_coordinates as cell_extent,
)
from .narrowing import as_dict, as_mapping
from .note_rendering import render_markdown
from .output_capture import LineOutput
from .output_capture import capture_output as _task_output
from .optional import numpy as optional_numpy
from .resample import resampled
from .rich_output import is_anywidget
from .sheets import (
    DEFAULT_SHEET_NAME,
    ReferenceScope,
    qualify,
    sheet_prefixes,
    split_cell_id,
)
from .timers import ACTIVE_CELL, TimerSpec, at, every
from .update_trace import UpdateTrace
from .value_encoding import parse_input, snapshot_value, values_equal
from .widget_config import WIDGET_SETTINGS, validate_widget, widget_expression
from .workbook_environment import (
    CELL_BUILTINS,
    ReactiveEnvironment,
    execute_imports,
    normalize_variables,
)
from .workbook_snapshot import WorkbookSnapshot as WorkbookSnapshot

# Cells run as ordinary Python: the full builtin namespace is available and
# each block executes in a single namespace so closures, comprehensions, and
# lambdas can see the block's own local variables.
CELL_WRITES_ENABLED: ContextVar[bool] = ContextVar('cell_writes_enabled', default=True)


@contextmanager
def cell_write_mode(enabled: bool):
    token = CELL_WRITES_ENABLED.set(enabled)
    try:
        yield
    finally:
        CELL_WRITES_ENABLED.reset(token)




READ_CONTEXT: ContextVar[tuple[Any, str, Any, set[str], bool] | None] = ContextVar("sheet_dependency_reads", default=None)


@dataclass(frozen=True)
class ResourceCellParams:
    values: dict[str, Any]
    environment_revision: tuple[int, int]

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, ResourceCellParams)
            and self.environment_revision == other.environment_revision
            and self.values.keys() == other.values.keys()
            and all(
                values_equal(value, other.values[key])
                for key, value in self.values.items()
            )
        )


@dataclass
class EffectState:
    id: str
    enabled: bool
    trigger: str
    trigger_count: int = 0
    last_triggered: str | None = None
    output: str = ""
    error: str | None = None
    status: str = "idle"
    duration_ms: float | None = None
    error_detail: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "enabled": self.enabled,
            "trigger": self.trigger,
            "triggerCount": self.trigger_count,
            "lastTriggered": self.last_triggered,
            "output": self.output,
            "error": self.error,
            "status": self.status,
            "durationMs": self.duration_ms,
        }


class ReactiveWorkbook:
    """Owns a live reaktiv graph and reconciles cell definitions in place.

    Each coordinate has a stable computed slot. Formula implementations can therefore
    be replaced without replacing the reactive identity observed by downstream cells.
    """

    def __init__(self, globals: Mapping[str, Any] | None = None, *, enable_update_tracing: bool = False) -> None:
        self.revision = uuid4().hex
        self._definitions: dict[str, CellDefinition] = {}
        self._incoming_definitions: dict[str, CellDefinition] | None = None
        self._write_transactions: dict[str, dict[str, tuple[str, Any]]] = {}
        self._cell_changes: dict[str, CellDefinition] = {}
        self.action_inputs = ActionInputs()
        self._input_initializers: dict[str, CellDefinition] = {}
        self._input_initializing: set[str] = set()
        self._input_errors: dict[str, Exception] = {}
        self._fresh_inputs: set[str] = set()
        self._runtime_inputs: set[str] = set()
        self._effect_runs: dict[str, int] = {}
        self._effect_reads: dict[str, set[str]] = {}
        self._effect_write_ticks: dict[str, Signal[int]] = {}
        self._pending_write_effects: dict[str, int] = {}
        self._effect_reruns = 0
        self._cell_namespace = CellNamespace(self._resolve_cell_ref, lambda: tuple(self._sheets))
        self._last_values: dict[str, Any] = {}
        self._console = PythonConsole()
        self._nodes: dict[str, Any] = {}
        self._slots: dict[str, ComputeSignal[Any]] = {}
        self._revisions: dict[str, Signal[int]] = {}
        # Widget model id -> the cell whose value it is, and its bindings (trait -> input
        # cell id); widgets are leaves of the graph (widgets.py).
        self._widget_cells: dict[str, str] = {}
        self._widget_bindings: dict[str, dict[str, str]] = {}
        # registry.sequence when a cell's evaluation started: older widgets it made are closed.
        self._widget_generation: dict[str, int] = {}
        # Called with ("start" | "end", cell id) around every run of cell code, so hosts can
        # show which cell is computing while an update is still running.
        self.progress: Callable[[str, str], None] | None = None
        self.log_reporter: Callable[[dict[str, Any]], None] | None = None
        self.snapshot_reporter: Callable[[dict[str, Any]], None] | None = None
        self._live_snapshot_dirty = False
        self._live_snapshot_at = float('-inf')
        # Clock cells (timers.py): tick counter, schedule, last tick, and next due time.
        self._timer_ticks: dict[str, Signal[int]] = {}
        self._timer_specs: dict[str, tuple[TimerSpec, ...]] = {}
        self._timer_pending: dict[str, list[TimerSpec]] = {}
        self._timer_last: dict[str, datetime] = {}
        self._timer_due: dict[str, datetime] = {}
        self._clock: Callable[[], datetime] = datetime.now
        self._effects: dict[str, Effect] = {}
        self._effect_codes: dict[str, Any] = {}
        self._effect_states: dict[str, EffectState] = {}
        self._cell_durations: dict[str, float] = {}
        self._update_trace = UpdateTrace(enabled=enable_update_tracing)
        self._markdown_parts: dict[str, list[tuple[bool, Any, str | None]]] = {}
        self._outputs = CellOutputs(self._update_trace, self._widget_bindings.get)
        self._resources: dict[str, Resource[Any, Any]] = {}
        self._logs: list[dict[str, Any]] = []
        # Last logged error per cell: a failed cell is re-evaluated on every read, and
        # the same failure must not be logged again each time.
        self._logged_errors: dict[str, tuple[str, str]] = {}
        # Cells stopped for running too long: they raise CellStopped instead of running.
        self._stopped: set[str] = set()
        self._dependencies: dict[str, list[str]] = {}
        self._live_dependencies: dict[str, set[str]] = {}
        self._live_widget_dependencies: dict[str, set[str]] = {}
        self._linked_overrides: dict[str, str | None] = {}
        self._action_owners: dict[str, Any] = {}
        self._action_status: dict[str, str] = {}
        self._snapshot_epoch = uuid4().hex
        self._snapshot_sequence = 0
        self._action_runs: dict[str, dict[str, Any]] = {}
        self._action_tasks: dict[str, asyncio.Task[Any]] = {}
        self._actions: dict[str, BoundAction[Any, Any]] = {}
        self._action_sources: dict[str, str] = {}
        self._action_errors: dict[str, str] = {}
        self._action_revision = Signal(0)
        self._action_namespace = _ActionNamespace(self)
        self._color_configs: dict[str, tuple[str, ComputeSignal[str], set[str]]] = {}
        self._widget_configs: dict[str, tuple[str, ComputeSignal[dict[str, Any]], list[str]]] = {}
        self._aliases: dict[str, str] = {}
        # Sheet name -> id prefix ('' for the first sheet); see sheets.py.
        self._sheets: dict[str, str] = {DEFAULT_SHEET_NAME: ""}
        self._initialized = False
        self._name = "Untitled"
        self._columns = 10
        self._rows = 16
        self._packages: tuple[str, ...] = ()
        self._imports: tuple[str, ...] = ()
        self._code = ""
        self._import_globals: dict[str, Any] = {}
        self._column_widths: dict[str, int] = {}
        self._row_heights: dict[str, int] = {}
        self._zoom = 1.0
        self._variables: dict[str, str] = {}
        self._environment_revision = Signal(0)
        self._environment = ReactiveEnvironment(
            lambda: self._variables, self._environment_revision
        )
        self._user_globals = dict(globals or {})
        self._document_template = SheetDocument()

    @property
    def document(self) -> SheetDocument:
        """The live workbook as a document: the loaded document's settings (sheets,
        kernel, layout) with the current cells, imports, and variables."""
        cells = tuple(self._definitions.values())
        extent: dict[str, tuple[int, int]] = {}
        for cell in cells:
            sheet = split_cell_id(cell.id)[0]
            column, row = cell_extent(cell.id)
            known = extent.get(sheet, (0, 0))
            extent[sheet] = (max(known[0], column), max(known[1], row))
        template = self._document_template
        first = next(name for name, prefix in self._sheets.items() if prefix == "")
        tabs = {tab.name: tab for tab in template.sheets}
        sheets: list[SheetTab] = []
        for name in (name for name, prefix in self._sheets.items() if prefix):
            columns, rows = extent.get(name, (0, 0))
            tab = tabs.get(name) or SheetTab(name)
            sheets.append(
                replace(tab, columns=max(tab.columns, columns), rows=max(tab.rows, rows))
            )
        first_columns, first_rows = extent.get("", (0, 0))
        return replace(
            template,
            name=self._name,
            columns=max(self._columns, first_columns),
            rows=max(self._rows, first_rows),
            cells=cells,
            packages=self._packages,
            imports=self._imports,
            code=self._code,
            variables=self._variables,
            column_widths=self._column_widths,
            row_heights=self._row_heights,
            zoom=self._zoom,
            sheet_name=first,
            sheets=tuple(sheets),
        )

    def load_document(self, document: SheetDocument) -> WorkbookSnapshot:
        if any(cell.kind == "resource" for cell in document.cells):
            raise RuntimeError(
                "Documents with resource cells require await workbook.load_document_async(...)"
            )
        self._load_document_metadata(document)
        return self.apply(
            document.cells,
            variables=document.variables,
            imports=document.imports,
            code=document.code,
            sheets=document.sheet_names,
        )

    async def load_document_async(self, document: SheetDocument, *, allow_cell_writes: bool = True, stopped: Iterable[str] | None = None, _preserved_inputs: Mapping[str, tuple[Any, bool]] | None = None) -> WorkbookSnapshot:
        self._load_document_metadata(document)
        return await self.apply_async(
            document.cells,
            variables=document.variables,
            imports=document.imports,
            code=document.code,
            sheets=document.sheet_names,
            allow_cell_writes=allow_cell_writes,
            stopped=stopped,
            _preserved_inputs=_preserved_inputs,
        )

    async def load_moved_document_async(self, document: SheetDocument, positions: Mapping[str, str]) -> WorkbookSnapshot:
        """Relocate writable state before starting effects, without rerunning initializers."""
        preserved: dict[str, tuple[Any, bool]] = {}
        for source, target in positions.items():
            definition = self._definitions.get(source)
            node = self._nodes.get(source)
            if node is not None and definition is not None and source not in self._input_errors and source not in self._input_initializers and (
                definition.kind == "input" or definition.kind == "linked" and source in self._runtime_inputs
            ):
                preserved[target] = (untracked(lambda node=node: node()), source in self._runtime_inputs)
        self._stopped = {positions.get(key, key) for key in self._stopped}
        return await self.load_document_async(document, _preserved_inputs=preserved)

    def _load_document_metadata(self, document: SheetDocument) -> None:
        self._document_template = document
        self._name = document.name
        self._columns = document.columns
        self._rows = document.rows
        self._packages = document.packages
        self._column_widths = dict(document.column_widths)
        self._row_heights = dict(document.row_heights)
        self._zoom = document.zoom

    def value(self, cell_id: str) -> Any:
        """Read an actual Python value through its stable slot, without subscribing."""
        if cell_id not in self._definitions or self._definitions[cell_id].kind == "effect":
            raise KeyError(f"No value cell at {cell_id}")
        return untracked(lambda: self._read(cell_id))

    async def set_input_values_async(self, values: Mapping[str, Any], reset: Iterable[str] = ()) -> WorkbookSnapshot:
        """Atomically write actual Python values from an embedding host."""
        transaction: dict[str, tuple[str, Any]] = {}
        for cell_id, value in values.items():
            definition = self._definitions.get(cell_id)
            if definition is None or definition.kind not in ("input", "linked"):
                raise TypeError(f"{cell_id} is not a writable input")
            transaction[cell_id] = ("set", value)
        for cell_id in reset:
            definition = self._definitions.get(cell_id)
            if definition is None or definition.kind != "linked":
                raise TypeError(f"{cell_id} is not a linked input")
            transaction[cell_id] = ("reset", None)
        self._commit_cell_writes(transaction)
        self._settle_cell_writes()
        await self._wait_for_resources()
        self._flush_widgets()
        return self.snapshot(changed=transaction)

    def run_effect(self, cell_id: str) -> WorkbookSnapshot:
        definition = self._definitions.get(cell_id)
        state = self._effect_states.get(cell_id)
        code = self._effect_codes.get(cell_id)
        if definition is None or definition.kind != "effect" or state is None:
            raise KeyError(f"Cell {cell_id} is not an effect")
        if not definition.enabled:
            raise ValueError(f"Effect {cell_id} is disabled")
        if code is None:
            raise ValueError(state.error or f"Effect {cell_id} could not be compiled")
        self._execute_effect(code, state)
        self._flush_widgets()
        return self.snapshot()

    def set_update_tracing(self, enabled: bool) -> None:
        """Opt-in metadata collection; disabled workbooks retain no trace state."""
        self._update_trace.set_enabled(enabled)

    async def update_action_async(self, value: Mapping[str, Any], expected_revision: str) -> dict[str, Any]:
        """Validate and compile before installing; never invoke the edited method."""
        if expected_revision != self.revision:
            raise ValueError("Workbook changed before the action edit was applied. Refresh and try again.")
        try:
            from .workbook_format import workbook_member_names
            definition = resolve_action_references(ActionDefinition.from_dict(value), cell_member_names(tuple(self._definitions.values())))
            definition = resolve_action_references(definition, workbook_member_names(self.document.cells, self.document.sheet_name))
        except (SyntaxError, ValueError, TypeError) as error:
            raise type(error)(action_validation_error(str(value.get("name", "(new action)")), str(value.get("source", "")), error)) from error
        if definition.name in self.document.sheet_names:
            raise ValueError("Workbook actions and worksheet symbols must have distinct names")
        # Compilation can fail. Leave the old definition, method and result untouched.
        previous = self._actions.get(definition.name)
        fingerprint = repr((definition.source, definition.references, self._code, self._imports))
        reuse = previous is not None and self._action_sources.get(definition.name) == fingerprint
        try:
            owner, method = (self._action_owners[definition.name], previous) if reuse and previous is not None else self._compile_action(definition)
        except (SyntaxError, ValueError, TypeError) as error:
            raise type(error)(action_validation_error(definition.name, definition.source, error)) from error
        self._document_template = replace(self._document_template, actions=tuple(
            item for item in self._document_template.actions if item.name != definition.name
        ) + (definition,))
        self._action_owners[definition.name] = owner
        self._actions[definition.name] = method
        self._action_sources[definition.name] = fingerprint
        self._action_errors.pop(definition.name, None)
        method.label = definition.label or definition.name.replace("_", " ").capitalize()
        if not reuse:
            self._action_status[definition.name] = "idle"
        self.revision = uuid4().hex
        if previous is not None and not reuse:
            previous.dispose()
        self._action_revision.set(untracked(self._action_revision) + 1)
        self._settle_cell_writes()
        await self._wait_for_resources()
        self._flush_widgets()
        return {**self.snapshot().to_dict(), "appliedAction": definition.to_dict()}

    def _compile_action(self, definition: ActionDefinition) -> tuple[_ActionOwner, BoundAction[Any, Any]]:
        namespace = self._evaluation_globals()
        filename = "<action " + definition.name + ">"
        code = compile(definition.source, filename, "exec", flags=__future__.annotations.compiler_flag)
        linecache.cache[filename] = (
            len(definition.source),
            None,
            definition.source.splitlines(keepends=True),
            filename,
        )
        exec(code, namespace)
        function = cast(Callable[..., Any], namespace[definition.name])
        descriptor = action(function, label=definition.label)
        owner = _ActionOwner(self, definition.references)
        return owner, descriptor.__get__(owner)

    def _reconcile_actions(self) -> None:
        changed = False
        definitions = {item.name: item for item in self._document_template.actions}
        for name in list(self._action_sources):
            if name not in definitions:
                removed = self._actions.pop(name, None)
                if removed is not None:
                    removed.dispose()
                self._action_sources.pop(name, None)
                self._action_errors.pop(name, None)
                self._action_owners.pop(name, None)
                self._action_status.pop(name, None)
                changed = True
        for definition in definitions.values():
            fingerprint = repr(
                (definition.source, definition.references, self._code, self._imports)
            )
            if (
                self._action_sources.get(definition.name) == fingerprint
                and definition.name in self._actions
            ):
                self._actions[definition.name].label = (
                    definition.label or definition.name.replace("_", " ").capitalize()
                )
                continue
            if definition.name in self._actions:
                self._actions.pop(definition.name).dispose()
            self._action_sources[definition.name] = fingerprint
            self._action_errors.pop(definition.name, None)
            try:
                owner, method = self._compile_action(definition)
                self._action_owners[definition.name] = owner
                self._actions[definition.name] = method
                self._action_status[definition.name] = "idle"
            except Exception as error:
                self._action_errors[definition.name] = error_message(error)
            changed = True
        if changed:
            self._action_revision.set(untracked(self._action_revision) + 1)

    def _action_payload(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for definition in self._document_template.actions:
            if not definition.exposed:
                continue
            method = self._actions.get(definition.name)
            value = method.result() if method else None
            key = "action:" + definition.name
            method_error = method.error() if method else None
            error = (
                error_message(method_error)
                if method_error is not None
                else self._action_errors.get(definition.name)
            )
            output = snapshot_value(
                key,
                value,
                rich_output=self._rich_payload(key, value),
                table=self._table_payload(key, value),
            )
            result.append(
                {
                    "name": definition.name,
                    "label": definition.label
                    or definition.name.replace("_", " ").capitalize(),
                    "description": ast.get_docstring(method_node(definition.source))
                    or "",
                    "parameters": parameters(definition.source),
                    "bindings": definition.bindings,
                    "running": bool(method and method.running()),
                    "status": "running" if method and method.running() else self._action_status.get(definition.name, "idle"),
                    "runs": [dict(run) for run in self._action_runs.values() if run["name"] == definition.name],
                    "error": error,
                    "compileError": self._action_errors.get(definition.name),
                    "cancelled": bool(
                        method and isinstance(method.error(), asyncio.CancelledError)
                    ),
                    "output": output,
                }
            )
        return result

    def action_method(self, name: str) -> BoundAction[Any, Any]:
        """Access an explicit method and its reactive invocation state."""
        self._action_revision()
        method = self._actions.get(name)
        if method is None:
            raise AttributeError(f"Unknown action: {name}")
        return method

    def model_cell_member(self, cell_id: str) -> Any:
        """Keep native Resource.value()/status()/error() semantics in methods."""
        resource = self._resources.get(cell_id)
        return resource if resource is not None else self._cell_ref(cell_id)

    def model_member(self, name: str, references: Mapping[str, str]) -> Any:
        """Resolve a method's model member against live workbook cells."""
        if name in self.document.sheet_names or any(key.startswith(name + '.') for key in references):
            from .workbook_format import workbook_member_names
            members = workbook_member_names(self.document.cells, self.document.sheet_name)
            return _WorksheetActionNamespace(self, name, references, members)
        if name in references:
            return self.model_cell_member(references[name])
        if name in self._actions:
            return self._actions[name]
        if name == "cells":
            return self._cell_namespace
        members = {
            member: cell_id
            for cell_id, member in cell_member_names(self.document.cells).items()
        }
        if name in members:
            return self.model_cell_member(members[name])
        raise AttributeError(f"Unknown model member: {name}")

    def action_running(self, name: str) -> bool:
        method = self._actions.get(name)
        return bool(method and method.running())

    def action_invocation_running(self, name: str, run_id: str | None = None) -> bool:
        if run_id is None:
            return self.action_running(name)
        run = self._action_runs.get(run_id)
        return bool(run and run['name'] == name and run_id in self._action_tasks)

    def running_action_names(self) -> list[str]:
        return [name for name, method in self._actions.items() if method.running()]

    def action_is_async(self, name: str) -> bool:
        method = self._actions.get(name)
        return bool(method and inspect.iscoroutinefunction(method.fn))

    def cancel_action(self, name: str, run_id: str | None = None) -> bool:
        if run_id is not None:
            run = self._action_runs.get(run_id)
            task = self._action_tasks.get(run_id)
            if run is None or run["name"] != name or task is None or task.done():
                return False
            task.cancel()
            return True
        method = self._actions.get(name)
        return bool(method and method.cancel())

    def resource_loading(self, cell_id: str) -> bool:
        resource = self._resources.get(cell_id)
        return bool(resource is not None and resource.is_loading())

    def cancel_resource(self, cell_id: str) -> bool:
        """Cancel on the owner loop; the in-flight update returns the settled snapshot."""
        resource = self._resources.get(cell_id)
        return bool(resource is not None and resource.cancel())

    async def run_action_async(
        self, name: str, arguments: Mapping[str, Any] | None = None, *, run_id: str | None = None
    ) -> WorkbookSnapshot:
        definition = next(
            (
                item
                for item in self._document_template.actions
                if item.name == name and item.exposed
            ),
            None,
        )
        method = self._actions.get(name)
        if definition is None or method is None:
            raise ValueError(self._action_errors.get(name) or f"Unknown action: {name}")
        if method.running() or any(
            self._action_runs[run]['name'] == name for run in self._action_tasks
        ):
            raise RuntimeError(f'Action {name} is already running')
        supplied = dict(definition.bindings)
        supplied.update(validate_action_bindings(arguments or {}))
        names = {item["name"] for item in parameters(definition.source)}
        if not set(supplied) <= names:
            raise ValueError("Unknown action argument")
        values: dict[str, Any] = {}
        for parameter, binding_value in supplied.items():
            binding = as_mapping(binding_value)
            if binding is None or set(binding) not in ({"cell"}, {"value"}, {"default"}):
                raise ValueError("Arguments require a literal value or a cell id")
            if binding.get("default") is True:
                continue
            if "cell" in binding:
                cell_id = binding["cell"]
                if not isinstance(cell_id, str) or cell_id not in self._definitions:
                    raise ValueError("Argument binding refers to a missing cell")
                values[parameter] = self._read(cell_id)
            else:
                values[parameter] = ast.literal_eval(literal_source(binding["value"]))
        inspect.signature(method).bind(**values)
        run_id = run_id or uuid4().hex
        if run_id in self._action_runs:
            raise ValueError('Action invocation ID already exists')
        self.action_inputs.begin(run_id, {key: cell.kind for key, cell in self._definitions.items()})
        run: dict[str, Any] = {"id": run_id, "name": name, "status": "running", "error": None}
        self._action_runs[run_id] = run
        task = asyncio.current_task()
        if task is not None:
            self._action_tasks[run_id] = task
        completed = [key for key in self._action_runs if key not in self._action_tasks]
        for retired in completed[:-100]:
            retired_run = self._action_runs.pop(retired)
            widgets.release(widgets.owner_key(self, 'action:' + retired_run['name'] + ':' + retired), widgets.registry.sequence + 1)
        key = "action:" + name + ":" + run_id
        self._action_status[name] = "running"
        output = LineOutput(lambda text: self._append_log(key, "info", text))
        warnings = LineOutput(lambda text: self._append_log(key, "warning", CELL_LOCATION.sub(cell_location, text)))
        transaction: dict[str, tuple[str, Any]] = {}
        action_value: Any = None
        action_error: BaseException | None = None
        active = self._begin_timers(key, track=False)
        self._write_transactions[key] = transaction
        streaming = asyncio.create_task(self._stream_action_snapshots())
        self._live_snapshot_at = float('-inf')
        self._live_snapshot_dirty = True
        try:
            self._raise_if_stopped(key)
            with _task_output(output, warnings):
                value = method(**values)
                if inspect.isawaitable(value):
                    value = await value
            action_value = value
            run["output"] = snapshot_value(key, value)
            self._settle_cell_writes()
            self._action_status[name] = "succeeded"
            run["status"] = "succeeded"
            self._log_output(key, output, warnings)
        except BaseException as error:
            self._action_status[name] = (
                "cancelled" if isinstance(error, asyncio.CancelledError) else "failed"
            )
            action_error = error
            run["status"] = self._action_status[name]
            run["error"] = "Action cancelled" if isinstance(error, asyncio.CancelledError) else error_message(error)
            if not isinstance(error, asyncio.CancelledError):
                self._log_error(key, error, output, warnings)
        finally:
            # Includes partial writes on cancellation, interruption and errors.
            output.flush()
            warnings.flush()
            self._write_transactions.pop(key, None)
            self._commit_timers(key, active)
            self._logged_errors.pop(key, None)
            self._forget_timer(key)
            self._timer_ticks.pop(key, None)
        try:
            await self._wait_for_resources()
        except asyncio.CancelledError as error:
            action_error = error
            run['status'], run['error'] = 'cancelled', 'Action cancelled'
            self._action_status[name] = 'cancelled'
        finally:
            streaming.cancel()
            try:
                await streaming
            except asyncio.CancelledError:
                pass
            finally:
                # Close admission even if the display reporter failed. Never let
                # a stale run keep the next action's mailbox locked.
                self._action_tasks.pop(run_id, None)
                self.action_inputs.finish(run_id)
                if self._drain_action_inputs():
                    # A last accepted click may start another resource load. Do
                    # not strand it when an HTTP owner's event loop goes idle.
                    await self._wait_for_resources()
        self._flush_widgets()
        return replace(self.snapshot(changed=transaction), action_value=action_value, action_error=action_error)

    async def _stream_action_snapshots(self) -> None:
        # Run on the workbook's owning loop, never in the HTTP polling thread.
        # A real sleep also lets Pyodide/WKWebView timers and resources progress.
        while True:
            await asyncio.sleep(0.1)
            self._drain_action_inputs()
            self._publish_action_snapshot()

    def _drain_action_inputs(self, *, finish: bool = False) -> bool:
        pending = self.action_inputs.take(finish=finish)
        return self._apply_input_literals(pending)

    async def set_inputs_async(self, sources: Mapping[str, str]) -> WorkbookSnapshot:
        """Literal input edits run on the owner loop without recompiling the graph."""
        self._apply_input_literals(ActionInputs.parse(sources))
        await self._wait_for_resources()
        self._flush_widgets()
        return self.snapshot()

    def _apply_input_literals(self, pending: Mapping[str, tuple[str, Any]]) -> bool:
        if not pending:
            return False
        active = ACTIVE_CELL.set(None)
        reads = READ_CONTEXT.set(None)
        try:
            for cell_id in pending:
                if cell_id not in self._definitions or self._definitions[cell_id].kind not in ('input', 'linked'):
                    raise ValueError(f'{cell_id} is no longer a writable input')
            for cell_id, (source, _) in pending.items():
                definition = self._definitions[cell_id]
                if definition.kind == 'input':
                    # This is an explicit widget edit: update the initializer even
                    # when runtime action writes use save_value=False.
                    updated = replace(definition, source=source)
                    self._definitions[cell_id] = updated
                    self._cell_changes[cell_id] = updated
            self._effect_runs.clear()
            self._effect_reruns = 0
            with untracked():
                self._commit_cell_writes({key: ('set', value) for key, (_, value) in pending.items()})
                self._settle_cell_writes()
            self._live_snapshot_dirty = True
            return True
        finally:
            READ_CONTEXT.reset(reads)
            ACTIVE_CELL.reset(active)

    def _publish_action_snapshot(self) -> None:
        report = self.snapshot_reporter
        if report is None or not self._live_snapshot_dirty or perf_counter() - self._live_snapshot_at < 0.1:
            return
        active = ACTIVE_CELL.set(None)
        reads = READ_CONTEXT.set(None)
        try:
            with untracked():
                self._flush_widgets()
                snapshot = self.snapshot(transient=True).to_dict()
            self._live_snapshot_dirty = False
            self._live_snapshot_at = perf_counter()
            report(snapshot)
        finally:
            READ_CONTEXT.reset(reads)
            ACTIVE_CELL.reset(active)

    def clear_logs(self) -> WorkbookSnapshot:
        self._logs.clear()
        return self.snapshot()

    def apply(
        self,
        cells: Iterable[CellLike],
        *,
        variables: Mapping[str, str] | None = None,
        imports: Iterable[str] | None = None,
        sheets: Iterable[str] | None = None,
        code: str | None = None,
        stopped: Iterable[str] | None = None,
        allow_cell_writes: bool = True,
        actions: Iterable[Mapping[str, Any]] | None = None,
    ) -> WorkbookSnapshot:
        if actions is not None:
            self._document_template = replace(self._document_template, actions=tuple(ActionDefinition.from_dict(item) for item in actions))
        with cell_write_mode(allow_cell_writes):
            incoming_cells = normalize_cells(cells)
            sheets_changed = self._set_sheets(sheets, incoming_cells)
            held = self._hold(stopped)
            if any(cell.kind == "resource" for cell in incoming_cells):
                raise RuntimeError("Resource cells require await workbook.apply_async(...)")
            changed, initial = self._apply_definitions(
                incoming_cells, variables, imports, recompile=sheets_changed, code=code, force=held
            )
            self._flush_widgets()
            return self.snapshot(changed=changed, initialized=initial)

    async def apply_async(
        self,
        cells: Iterable[CellLike],
        *,
        variables: Mapping[str, str] | None = None,
        imports: Iterable[str] | None = None,
        sheets: Iterable[str] | None = None,
        code: str | None = None,
        stopped: Iterable[str] | None = None,
        allow_cell_writes: bool = True,
        actions: Iterable[Mapping[str, Any]] | None = None,
        _preserved_inputs: Mapping[str, tuple[Any, bool]] | None = None,
    ) -> WorkbookSnapshot:
        started = perf_counter()
        if actions is not None:
            self._document_template = replace(self._document_template, actions=tuple(ActionDefinition.from_dict(item) for item in actions))
        with cell_write_mode(allow_cell_writes):
            incoming_cells = normalize_cells(cells)
            sheets_changed = self._set_sheets(sheets, incoming_cells)
            held = self._hold(stopped)
            changed, initial = self._apply_definitions(
                incoming_cells, variables, imports, recompile=sheets_changed, code=code, force=held, preserved_inputs=_preserved_inputs
            )
            self._settle_cell_writes()
            prepared = perf_counter()
            await self._wait_for_resources()
            self._flush_widgets()
            settled = perf_counter()
            snapshot = self.snapshot(changed=changed, initialized=initial)
            return replace(snapshot, timings={
                "definitionsMs": (prepared-started)*1000,
                "resourcesMs": (settled-prepared)*1000,
                "snapshotMs": (perf_counter()-settled)*1000,
            })

    @property
    def stopped(self) -> frozenset[str]:
        """Cells that were stopped for running too long (see CellStopped)."""
        return frozenset(self._stopped)

    def _hold(self, stopped: Iterable[object] | None) -> frozenset[str]:
        """Set the stopped cells the host keeps (None: unchanged); the cells whose state
        changed, which must be evaluated again."""
        if stopped is None:
            return frozenset()
        held = {cell_id for cell_id in stopped if isinstance(cell_id, str)}
        flipped = frozenset(held ^ self._stopped)
        self._stopped = held
        return flipped

    def _raise_if_stopped(self, cell_id: str) -> None:
        if cell_id in self._stopped:
            raise CellStopped()

    def _scope(self, cell_id: str) -> ReferenceScope:
        return ReferenceScope(self._aliases, split_cell_id(cell_id)[0], self._sheets)

    def _set_sheets(
        self, sheets: Iterable[str] | None, cells: tuple[CellDefinition, ...]
    ) -> bool:
        """Update the sheet names (first = the unprefixed sheet); True when they changed.
        Without explicit names, sheets are inferred from qualified cell ids."""
        if sheets is not None:
            names = list(sheets)
            first, extra = (names[0] if names else DEFAULT_SHEET_NAME), tuple(names[1:])
        else:
            first = next(name for name, prefix in self._sheets.items() if prefix == "")
            extra = tuple(sorted({split_cell_id(cell.id)[0] for cell in cells} - {""}))
        prefixes = sheet_prefixes(first, extra)
        if prefixes == self._sheets:
            return False
        self._sheets = prefixes
        return True

    def _apply_definitions(
        self,
        incoming_cells: tuple[CellDefinition, ...],
        variables: Mapping[str, str] | None,
        imports: Iterable[str] | None,
        recompile: bool = False,
        code: str | None = None,
        force: frozenset[str] = frozenset(),
        preserved_inputs: Mapping[str, tuple[Any, bool]] | None = None,
    ) -> tuple[set[str], bool]:
        self.revision = uuid4().hex
        incoming = {cell.id: cell for cell in incoming_cells}
        aliases = {qualify(split_cell_id(cell.id)[0], cell.name): cell.id for cell in incoming_cells if cell.name}
        # Presentation (highlight colour, dashboard view) never changes a value, so it
        # must not recompute the cell (e.g. resizing a plot on the dashboard).
        changed = {
            cell_id
            for cell_id in self._definitions.keys() | incoming.keys()
            if _computational(self._definitions.get(cell_id))
            != _computational(incoming.get(cell_id))
        }
        changed.update((preserved_inputs or {}).keys())
        changed.update(force & incoming.keys())  # stopped or released cells run anew
        if recompile:
            # Sheet names changed: `Sheet.A1` references may resolve differently.
            changed.update(
                cell_id for cell_id, definition in incoming.items() if definition.kind != "input"
            )
        if aliases != self._aliases:
            for cell_id, definition in incoming.items():
                if definition.kind == "input" or cell_id in changed:
                    continue
                if self._dependencies.get(cell_id, []) != definition_dependencies(
                    definition,
                    ReferenceScope(aliases, split_cell_id(cell_id)[0], self._sheets),
                ):
                    changed.add(cell_id)
        initial = not self._initialized
        normalized_imports = self._imports if imports is None else normalize_imports(imports)
        normalized_code = self._code if code is None else normalize_code(code)
        imports_changed = normalized_imports != self._imports or normalized_code != self._code
        import_globals = (
            execute_imports(normalized_imports, normalized_code, self._shared_code_globals())
            if imports_changed
            else self._import_globals
        )
        if imports_changed:
            changed.update(
                cell_id
                for cell_id, definition in incoming.items()
                if definition.kind != "input"
            )

        self._incoming_definitions = incoming
        with batch():
            self._aliases = aliases
            if imports_changed:
                self._imports = normalized_imports
                self._code = normalized_code
                self._import_globals = import_globals
                self._environment_revision.set(self._environment_revision() + 1)
            if variables is not None:
                normalized_variables = normalize_variables(variables)
                if normalized_variables != self._variables:
                    self._variables = normalized_variables
                    self._environment_revision.set(self._environment_revision() + 1)
            self._reconcile_actions()
            if changed:
                self._reconcile(incoming, changed, preserved_inputs)
            self._definitions = incoming
            self._reconcile_widget_configs()
            self._reconcile_color_configs()
        self._incoming_definitions = None
        self._initialized = True
        return changed, initial

    def _reconcile_color_configs(self) -> None:
        """Color expressions are computed presentation leaves, separate from cell values."""
        configs: dict[str, tuple[str, ComputeSignal[str], set[str]]] = {}
        for definition in self._definitions.values():
            expression = widget_expression('color', (definition.view or {}).get('color'))
            if expression is None:
                continue
            signature = repr((expression, self._aliases, self._sheets))
            previous = self._color_configs.get(definition.id)
            if previous and previous[0] == signature:
                configs[definition.id] = previous
                continue
            reads: set[str] = set()
            try:
                code, _ = compile_cell(expression, 'eval', self._scope(definition.id))
                def color(code: Any = code, cell_id: str = definition.id, reads: set[str] = reads) -> str:
                    reads.clear()
                    token = READ_CONTEXT.set((self, cell_id, current_consumer(), reads, True))
                    output, warnings = io.StringIO(), io.StringIO()
                    try:
                        self._raise_if_stopped(cell_id)
                        with _task_output(output, warnings):
                            self._environment_revision()
                            value = eval(code, self._evaluation_globals())
                            if value is None or value == '':
                                return ''
                            if not isinstance(value, str) or not CELL_COLOR.fullmatch(value):
                                raise ValueError('Cell color must evaluate to #RRGGBB, an empty string or None')
                            return value.lower()
                    finally:
                        READ_CONTEXT.reset(token)
                        self._log_output(cell_id, output, warnings)
                node = ComputeSignal(color)
            except Exception as error:
                node = ComputeSignal(lambda error=error: _raise(error))
            configs[definition.id] = (signature, node, reads)
        self._color_configs = configs

    def _reconcile_widget_configs(self) -> None:
        """Widget settings are separate computed leaves; changing them never resets input values."""
        configs: dict[str, tuple[str, ComputeSignal[dict[str, Any]], list[str]]] = {}
        for definition in self._definitions.values():
            widget = as_dict((definition.view or {}).get("widget"))
            if definition.kind not in ("input", "linked") or widget is None:
                continue
            signature = repr((widget, self._aliases, self._sheets))
            previous = self._widget_configs.get(definition.id)
            if previous and previous[0] == signature:
                configs[definition.id] = previous
                continue
            dependencies: set[str] = set()
            expressions: dict[str, Any] = {}
            try:
                for key in WIDGET_SETTINGS:
                    expression = widget_expression(key, widget.get(key))
                    if expression is not None:
                        code, reads = compile_cell(expression, "eval", self._scope(definition.id))
                        expressions[key] = code
                        dependencies.update(reads)
                def settings(widget: dict[str, Any] = dict(widget), expressions: dict[str, Any] = expressions, cell_id: str = definition.id) -> dict[str, Any]:
                    active = self._begin_timers(cell_id, widget=True)
                    output, warnings = io.StringIO(), io.StringIO()
                    try:
                        self._raise_if_stopped(cell_id)
                        with _task_output(output, warnings):
                            self._environment_revision()
                            resolved = {**widget, **{key: eval(code, self._evaluation_globals()) for key, code in expressions.items()}}
                            return validate_widget(resolved)
                    finally:
                        self._log_output(cell_id, output, warnings)
                        self._commit_timers(cell_id, active)

                node = ComputeSignal(settings, equal=values_equal)
            except Exception as error:
                node = ComputeSignal(lambda error=error: _raise(error))
            configs[definition.id] = (signature, node, sorted(dependencies))
        self._widget_configs = configs

    def snapshot(
        self,
        *,
        changed: Iterable[str] = (),
        initialized: bool = False,
        transient: bool = False,
    ) -> WorkbookSnapshot:
        # Display frames must not acknowledge pending edits, messages or tracing;
        # the final command result is their single acceptance boundary.
        if not transient:
            self.revision = uuid4().hex
        changed = tuple(changed)
        self._settle_cell_writes()
        self._last_values.clear()
        cells: list[dict[str, Any]] = []
        effects: list[dict[str, Any]] = []
        for definition in self._definitions.values():
            cell_id = definition.id
            if definition.kind == "effect":
                state = self._effect_states[cell_id]
                effects.append(state.to_dict())
                cells.append(
                    {
                        "id": cell_id,
                        "display": "Effect on" if state.enabled else "Effect off",
                        "value": None,
                        "valueType": "effect",
                        "error": state.error,
                        "durationMs": state.duration_ms,
                        **({"errorDetail": state.error_detail} if state.error_detail else {}),
                    }
                )
                continue

            if definition.kind == "resource":
                resource = self._resources.get(cell_id)
                if resource is not None:
                    status = resource.status().value
                    try:
                        value = self._read(cell_id)
                        self._last_values[cell_id] = value
                        cells.append(
                            self._outputs.snapshot(
                                cell_id,
                                value,
                                resource_status=status,
                                duration_ms=self._cell_durations.get(cell_id),
                            )
                        )
                    except Exception as error:
                        pending = isinstance(error, ResourcePendingError)
                        if not pending:
                            self._outputs.discard(cell_id)
                        cells.append(
                            {
                                "id": cell_id,
                                "display": ({"idle": "Idle", "cancelled": "Cancelled"}.get(status, "Loading…")) if pending else "#ERROR",
                                "value": None,
                                "valueType": "resource",
                                "error": None if pending else error_message(error),
                                "resourceStatus": status if pending else "error",
                                "durationMs": self._cell_durations.get(cell_id),
                                **({} if pending else self._error_fields(cell_id, error)),
                            }
                        )
                    continue

            try:
                value = self._read(cell_id)
                self._last_values[cell_id] = value
                value_type = (
                    "markdown"
                    if definition.kind == "markdown"
                    else type(value).__name__
                )
                cells.append(
                    self._outputs.snapshot(
                        cell_id,
                        value,
                        value_type=value_type,
                        duration_ms=self._cell_durations.get(cell_id),
                    )
                )
            except Exception as error:
                # The output caches hold the last value; a failed cell must not keep it alive.
                self._outputs.discard(cell_id)
                cells.append(
                    {
                        "id": cell_id,
                        "display": "#ERROR",
                        "value": None,
                        "valueType": "error",
                        "error": error_message(error),
                        "durationMs": self._cell_durations.get(cell_id),
                        **self._error_fields(cell_id, error),
                    }
                )

        for result in cells:
            definition = self._definitions[result["id"]]
            if definition.id in self._runtime_inputs:
                result["runtimeOnlyInput"] = True
            if definition.kind == "linked":
                override = self._linked_overrides.get(definition.id)
                result["linkedOverride"] = "runtime" if definition.id in self._runtime_inputs else override
                if definition.override != override:
                    self._definitions[definition.id] = replace(definition, override=override)
            color_config = self._color_configs.get(result['id'])
            if color_config is not None:
                try:
                    result['color'] = color_config[1]()
                except Exception as error:
                    result['colorError'] = error_message(error)
                result['colorDependencies'] = sorted(color_config[2])
            config = self._widget_configs.get(result["id"])
            if config is not None:
                try:
                    resolved = config[1]()
                    if resolved.get("buttonMode") == "action":
                        target = resolved["action"]
                        action_definition = next((item for item in self._document_template.actions if item.name == target and item.exposed), None)
                        if action_definition is None or target not in self._actions:
                            raise ValueError(f"Unknown or unavailable action: {target}")
                        arguments = resolved.get("actionArguments", {})
                        parameter_names = {item["name"] for item in parameters(action_definition.source)}
                        if not set(arguments) <= parameter_names:
                            raise ValueError("Button arguments must refer to existing action parameters")
                    result["widget"] = resolved
                except Exception as error:
                    result["widgetError"] = error_message(error)

        messages: list[dict[str, Any]] = []
        for message in (() if transient else widgets.registry.take_outbox()):
            cell_id = self._widget_cells.get(message["modelId"])
            if cell_id is None:  # a nested widget: the view that shows it receives it
                cell_id = next(
                    (
                        root_cell
                        for root, root_cell in self._widget_cells.items()
                        if root in widgets.registry.models and message["modelId"] in widgets.payload(root)["models"]
                    ),
                    None,
                )
            if cell_id is not None:
                messages.append({**message, "cellId": cell_id})
        cell_changes = tuple(self._definitions[cell_id] for cell_id in self._cell_changes if cell_id in self._definitions)
        if not transient:
            self._cell_changes.clear()
            self._effect_runs.clear()
            self._effect_reruns = 0
        failed = {cell["id"] for cell in cells if cell.get("error")} | {
            key for key, state in self._effect_states.items() if state.error
        }
        dependency_states = {
            key: "unobserved" if key not in self._live_dependencies and definition.kind != "input"
            else "partial" if key in failed else "observed"
            for key, definition in self._definitions.items()
        }
        dependencies = {
            key: sorted(self._live_dependencies.get(key, set()) | self._effect_reads.get(key, set())) for key in self._definitions
        }
        trace = self._update_trace.complete(
            cells, {key: item.kind for key, item in self._definitions.items()}, dependencies,
            {key: (id(slot), signal_version(slot)) for key, slot in self._slots.items() if key in self._definitions},
            changed, {key for key, item in self._definitions.items() if item.equal},
        ) if self._update_trace.enabled and not transient else None
        self._snapshot_sequence += 1
        return WorkbookSnapshot(
            snapshot_epoch=self._snapshot_epoch,
            snapshot_sequence=self._snapshot_sequence,
            update_trace=trace,
            workbook_revision=self.revision,
            actions=tuple(self._action_payload()),
            cell_changes=cell_changes,
            widget_messages=tuple(messages),
            widget_dependencies={key: sorted(self._live_widget_dependencies.get(key, set())) for key in self._widget_configs},
            source_dependencies=dict(self._dependencies),
            dependency_states=dependency_states,
            cells=tuple(cells),
            dependencies=dependencies,
            effects=tuple(effects),
            logs=tuple(dict(entry) for entry in self._logs),
            changed=tuple(sorted(set(changed) | {cell.id for cell in cell_changes})),
            initialized=initialized,
            timers=self._timer_payload(),
            stopped=tuple(sorted(self._stopped)),
        )

    def cell_memory(self) -> dict[str, dict[str, Any]]:
        """Estimate only already evaluated values. No signal reads or cell execution."""
        budget = [50000]
        return {cell_id: value_memory(value, budget) for cell_id, value in self._last_values.items()}

    def run_console(self, source: str, sheet: str = "") -> dict[str, Any]:
        """Temporary Python commands, with values from the most recent evaluation."""
        if sheet not in self._sheets.values():
            raise ValueError(f"Unknown sheet: {sheet}")
        context = self._evaluation_globals()
        context.pop("__read", None)
        by_sheet: dict[str, dict[str, Any]] = {prefix: {} for prefix in self._sheets.values()}
        for cell_id, value in self._last_values.items():
            prefix, coordinate = split_cell_id(cell_id)
            by_sheet.setdefault(prefix, {})[coordinate] = value
            definition = self._definitions.get(cell_id)
            if definition is not None and definition.name:
                by_sheet[prefix][definition.name] = value
        context.update({name: SimpleNamespace(**by_sheet[prefix]) for name, prefix in self._sheets.items()})
        context.update(by_sheet.get(sheet, {}))
        context["cells"] = MappingProxyType(dict(self._last_values))
        return self._console.execute(source, sheet, context)

    def close(self) -> None:
        self.action_inputs.take(finish=True)
        for task in tuple(self._action_tasks.values()):
            task.cancel()
        self._outputs.clear()
        self._last_values.clear()
        self._console = PythonConsole()
        self._timer_specs.clear()
        self._timer_due.clear()
        for effect in self._effects.values():
            effect.dispose()
        self._effects.clear()
        self._effect_codes.clear()
        for resource in self._resources.values():
            resource.dispose()
        self._resources.clear()
        for method in self._actions.values():
            method.dispose()
        self._actions.clear()
        self._action_owners.clear()
        self._action_status.clear()
        self._action_sources.clear()
        self._action_errors.clear()
        self._widget_configs.clear()
        self._color_configs.clear()
        self._live_dependencies.clear()
        self._input_initializers.clear()
        self._input_errors.clear()
        self._input_initializing.clear()
        self._fresh_inputs.clear()
        self._runtime_inputs.clear()
        self._live_widget_dependencies.clear()
        self._linked_overrides.clear()
        self._effect_reads.clear()
        self._effect_write_ticks.clear()
        self._pending_write_effects.clear()
        self._cell_changes.clear()

    def _reconcile(
        self, incoming: dict[str, CellDefinition], changed: set[str],
        preserved_inputs: Mapping[str, tuple[Any, bool]] | None = None,
    ) -> None:
        old_effect_states = dict(self._effect_states)

        with batch():
            for cell_id in changed:
                previous = self._definitions.get(cell_id)
                current = incoming.get(cell_id)
                if previous is not None and current is not None and previous.kind == current.kind == "linked" and previous.source == current.source and previous.computation == current.computation and previous.equal == current.equal and previous.override != current.override and current.override is not None:
                    continue
                self._cell_durations.pop(cell_id, None)
                self._markdown_parts.pop(cell_id, None)
                self._outputs.discard(cell_id)
                self._logged_errors.pop(cell_id, None)
                self._forget_timer(cell_id)
                if previous is not None and previous.kind == "resource":
                    resource = self._resources.pop(cell_id, None)
                    if resource is not None:
                        resource.dispose()
                if previous is not None and previous.kind == "effect":
                    effect = self._effects.pop(cell_id, None)
                    if effect is not None:
                        effect.dispose()
                    self._effect_states.pop(cell_id, None)
                    self._effect_codes.pop(cell_id, None)
                if current is None or current.kind == "effect":
                    if cell_id in self._nodes:
                        self._nodes.pop(cell_id)
                        self._bump_revision(cell_id)
                    self._dependencies.pop(cell_id, None)
                    self._input_initializers.pop(cell_id, None)
                    self._input_errors.pop(cell_id, None)
                    self._fresh_inputs.discard(cell_id)
                    self._runtime_inputs.discard(cell_id)

            for cell_id in changed:
                current = incoming.get(cell_id)
                if current is None or current.kind == "effect":
                    continue
                previous = self._definitions.get(cell_id)
                if (
                    previous is not None
                    and previous.kind == "input"
                    and current.kind == "input"
                    and cell_id not in (preserved_inputs or {})
                    and previous.equal == current.equal
                    and isinstance(self._nodes.get(cell_id), Signal)
                ):
                    self._input_initializers[cell_id] = current
                    self._input_errors.pop(cell_id, None)
                    self._bump_revision(cell_id)
                    continue
                if previous is not None and previous.kind == current.kind == "linked" and previous.source == current.source and previous.computation == current.computation and previous.equal == current.equal and previous.name == current.name and previous.override != current.override and current.override is not None and self._dependencies.get(cell_id) == definition_dependencies(current, self._scope(cell_id)):
                    continue
                self._live_dependencies.pop(cell_id, None)
                node, dependencies = self._create_value_node(current)
                self._nodes[cell_id] = node
                if current.kind == "input" and preserved_inputs is not None and cell_id in preserved_inputs:
                    value, runtime_only = preserved_inputs[cell_id]
                    self._nodes[cell_id] = Signal(value, equal=self._cell_equality(current))
                    self._input_initializers.pop(cell_id, None)
                    self._fresh_inputs.discard(cell_id)
                    if runtime_only:
                        self._runtime_inputs.add(cell_id)
                self._dependencies[cell_id] = dependencies
                self._ensure_slot(cell_id)
                self._bump_revision(cell_id)

            # Resolve initial state after every value node exists, before starting
            # effects. Initializers can call function cells declared later in the file.
            for cell_id in tuple(self._input_initializers):
                try:
                    untracked(lambda cell_id=cell_id: self._initialize_input(cell_id))
                except Exception:
                    pass  # The snapshot reports the initialization error at its cell.

            for cell_id in changed:
                current = incoming.get(cell_id)
                previous = self._definitions.get(cell_id)
                if current is not None and current.kind == "linked":
                    node = self._nodes[cell_id]
                    override = current.override
                    self._linked_overrides[cell_id] = None
                    if override is not None:
                        if isinstance(node, LinkedSignal):
                            linked_node = cast(LinkedSignal[Any], node)
                            try:
                                linked_node()  # Refresh pending sources before the explicit override.
                                linked_node.set(parse_input(override))
                            except Exception:
                                pass  # Snapshot reports the derivation error; retain saved override data.
                        self._linked_overrides[cell_id] = override
                else:
                    self._linked_overrides.pop(cell_id, None)

            for cell_id, (value, runtime_only) in (preserved_inputs or {}).items():
                current = incoming.get(cell_id)
                if current is not None and current.kind == "linked":
                    self._nodes[cell_id].set(value)
                    if runtime_only:
                        self._runtime_inputs.add(cell_id)

            for cell_id in changed:
                current = incoming.get(cell_id)
                if current is None or current.kind != "effect":
                    continue
                previous = self._definitions.get(cell_id)
                preserve = (
                    previous is not None
                    and previous.kind == "effect"
                    and previous.source == current.source
                )
                self._create_effect(
                    current, old_effect_states.get(cell_id) if preserve else None
                )

        # A removed cell keeps its slot (cells that refer to it must see it come back), but
        # the slot still caches the last value and holds the old node. Reading it now fails,
        # and a failed computed signal keeps the error instead of the value.
        for cell_id in changed:
            if cell_id not in incoming:
                # Its widgets would otherwise only close when it runs again, which it never will.
                widgets.release(widgets.owner_key(self, cell_id), widgets.registry.sequence)
                for model_id, owner in list(self._widget_cells.items()):
                    if owner == cell_id:
                        del self._widget_cells[model_id]
            if cell_id not in incoming or incoming[cell_id].kind == "effect":
                slot = self._slots.get(cell_id)
                if slot is not None:
                    try:
                        slot()
                    except KeyError:
                        pass

    def _cell_equality(self, definition: CellDefinition) -> Callable[[Any, Any], bool]:
        comparison: Callable[[Any, Any], bool] = (lambda previous, current: previous is current) if not definition.equal else untracked(
            lambda: eval(compile(definition.equal or "", f"<cell {definition.id} equality>", "eval"), self._evaluation_globals())
        )
        if not callable(comparison):
            raise TypeError("Equality must be a Python function taking previous and current values")

        def compare(previous: Any, current: Any) -> bool:
            try:
                # Observe the decision already required by execution; never compare
                # values a second time just to populate diagnostics.
                equal = bool(untracked(lambda: comparison(previous, current))) if definition.equal else previous is current
                if self._update_trace.enabled:
                    self._update_trace.equalities[definition.id] = equal
                return equal
            except Exception as error:
                if definition.equal:
                    self._log_error(definition.id, error)
                raise
        return compare

    def _create_value_node(self, definition: CellDefinition) -> tuple[Any, list[str]]:
        try:
            equality = self._cell_equality(definition)
        except Exception as error:
            self._log_error(definition.id, error)
            return ComputeSignal(lambda error=error: _raise(error)), []
        self._input_initializers.pop(definition.id, None)
        self._input_errors.pop(definition.id, None)
        self._fresh_inputs.discard(definition.id)
        self._runtime_inputs.discard(definition.id)
        if definition.kind == "input":
            self._input_initializers[definition.id] = definition
            self._fresh_inputs.add(definition.id)
            return Signal(None, equal=equality), definition_dependencies(definition, self._scope(definition.id))

        try:
            if definition.kind == "resource":
                return self._create_resource_node(definition)
            if definition.kind == "markdown":
                parts, dependencies = compile_markdown(
                    definition.source, self._scope(definition.id), definition.id
                )
                self._markdown_parts[definition.id] = parts

                def compute_markdown(
                    parts: list[tuple[bool, Any, str | None]] = parts,
                ) -> str:
                    started = perf_counter()
                    active = self._begin_timers(definition.id)
                    try:
                        self._raise_if_stopped(definition.id)
                        rendered = self._render_markdown(parts)
                        self._logged_errors.pop(definition.id, None)
                        return rendered
                    except Exception as error:
                        self._log_error(definition.id, error)
                        raise
                    finally:
                        self._commit_timers(definition.id, active)
                        self._cell_durations[definition.id] = round(
                            (perf_counter() - started) * 1000, 3
                        )

                compute: Callable[[], Any] = compute_markdown
            else:
                code, dependencies, expression = compile_formula(
                    definition.source, self._scope(definition.id), cell_filename(definition.id)
                )

                # Advanced linked source/computation run synchronously in one cell
                # evaluation, preserving source reads, timers and widget ownership.
                pending_evaluation: tuple[float, Any, io.StringIO, io.StringIO] | None = None

                def compute_formula(
                    code: Any = code, expression: bool = expression,
                    *, bindings: dict[str, Any] | None = None,
                ) -> Any:
                    nonlocal pending_evaluation
                    if bindings is not None and pending_evaluation is not None:
                        started, active, output, warnings = pending_evaluation
                        pending_evaluation = None
                    else:
                        started = perf_counter()
                        active = self._begin_timers(definition.id)
                        output, warnings = io.StringIO(), io.StringIO()
                    continues = False
                    try:
                        self._raise_if_stopped(definition.id)
                        with _task_output(output, warnings):
                            value = (
                                eval(code, {**self._evaluation_globals(), **(bindings or {})})
                                if expression
                                else self._evaluate_formula_block(code, bindings)
                            )
                        if definition.kind == "linked" and (definition.computation is None or bindings is not None):
                            self._linked_overrides[definition.id] = None
                            self._runtime_inputs.discard(definition.id)
                        continues = definition.computation is not None and bindings is None
                        if continues:
                            pending_evaluation = (started, active, output, warnings)
                        else:
                            self._log_output(definition.id, output, warnings)
                            self._logged_errors.pop(definition.id, None)
                        return value
                    except Exception as error:
                        self._log_error(definition.id, error, output, warnings)
                        raise
                    finally:
                        if not continues:
                            self._commit_timers(definition.id, active)
                            self._cell_durations[definition.id] = round(
                                (perf_counter() - started) * 1000, 3
                            )

                compute = compute_formula
            if definition.kind == "linked" and definition.computation is not None:
                computation_code, computation_dependencies, computation_expression = compile_formula(
                    definition.computation, self._scope(definition.id), f"<cell {definition.id} computation>", bound_names={"source", "previous"},
                )
                dependencies = sorted(set(dependencies) | set(computation_dependencies))
                def compute_linked(source: Any, previous: Any) -> Any:
                    return compute_formula(computation_code, computation_expression, bindings={"source": source, "previous": previous})

                return LinkedSignal[Any](
                    source=compute,
                    computation=compute_linked,
                    equal=equality,
                ), dependencies
            node: ComputeSignal[Any] = LinkedSignal[Any](compute, equal=equality) if definition.kind == "linked" else ComputeSignal[Any](compute, equal=equality)
            return node, dependencies
        except Exception as error:
            # The cell could not be compiled (usually a SyntaxError): every read raises it.
            self._log_error(definition.id, error)
            return ComputeSignal(lambda error=error: _raise(error)), []

    def _create_resource_node(
        self, definition: CellDefinition
    ) -> tuple[ComputeSignal[Any], list[str]]:
        code, dependencies = compile_resource(
            definition.source, self._scope(definition.id), cell_filename(definition.id), explicit=definition.params is not None
        )

        params_code = None
        params_expression = False
        if definition.params is not None:
            params_code, parameter_dependencies, params_expression = compile_formula(definition.params, self._scope(definition.id), f"<cell {definition.id} parameters>")
            if dependencies:
                raise ValueError("Explicit resource loaders must read params; move cell references into Parameters")
            dependencies = parameter_dependencies

        def params() -> Any:
            reads: set[str] = set()
            self._live_dependencies[definition.id] = reads
            token = READ_CONTEXT.set((self, definition.id, current_consumer(), reads, False))
            try:
                self._raise_if_stopped(definition.id)
                # Environment changes and a loader's own clocks still invalidate the request.
                revision = (self._environment_revision(), self._timer_tick(definition.id)())
                if params_code is not None:
                    value = eval(params_code, self._evaluation_globals()) if params_expression else self._evaluate_formula_block(params_code)
                    return None if value is None else ResourceCellParams({"__explicit__": value}, revision)
                return ResourceCellParams({dependency: self._read(dependency) for dependency in dependencies}, revision)
            except Exception as error:
                self._log_error(definition.id, error)
                raise
            finally:
                READ_CONTEXT.reset(token)

        parameter_node = ComputeSignal(params, equal=values_equal)

        def request_params() -> Any:
            try:
                return parameter_node()
            except Exception:
                # The value wrapper surfaces parameter errors. None also aborts old loads.
                return None

        async def loader(loader_params: Any) -> Any:
            started = perf_counter()
            try:
                context = replace(loader_params, params=loader_params.params.values["__explicit__"]) if definition.params is not None else loader_params
                return await self._evaluate_resource(definition.id, code, context, explicit=definition.params is not None)
            finally:
                self._cell_durations[definition.id] = round(
                    (perf_counter() - started) * 1000, 3
                )

        resource = Resource(params=request_params, loader=loader)
        self._resources[definition.id] = resource

        def read_resource() -> Any:
            parameter_node()  # Establish parameter/error dependencies even while idle.
            if resource.has_value():
                return resource.value()
            status = resource.status()
            if status == ResourceStatus.ERROR:
                error = resource.error()
                raise error if error is not None else RuntimeError("Resource failed")
            raise ResourcePendingError(f"Resource {definition.id} is {status.value}")

        return ComputeSignal(read_resource, equal=self._cell_equality(definition)), dependencies

    async def _evaluate_resource(
        self, cell_id: str, code: Any, loader_params: Any, *, explicit: bool = False
    ) -> Any:
        output, warnings = io.StringIO(), io.StringIO()
        namespace = self._evaluation_globals()
        if not explicit:
            namespace["__read"] = loader_params.params.values.__getitem__
        else:
            def reject_read(key: str) -> Any:
                raise ValueError("Explicit resource loaders must use params, not live cell reads")
            namespace["__read"] = reject_read
        if explicit:
            namespace["params"] = loader_params.params
        namespace["cancellation"] = loader_params.cancellation
        namespace["resource_params"] = loader_params
        active = self._begin_timers(cell_id, track=False)
        try:
            self._raise_if_stopped(cell_id)
            exec(code, namespace)
            function = namespace["__resource_loader__"]
            with _task_output(output, warnings), untracked():
                value = await function()
            self._log_output(cell_id, output, warnings)
            self._logged_errors.pop(cell_id, None)
            return value
        except Exception as error:
            self._log_error(cell_id, error, output, warnings)
            raise
        finally:
            self._commit_timers(cell_id, active)

    async def _wait_for_resources(self) -> None:
        # Yield a few times so loaders start (and instant ones finish), then poll with a
        # real timer. A tight `sleep(0)` loop must not be used: in WebKit (Safari) Pyodide
        # runs immediate callbacks through a MessageChannel, which starves
        # timers, so a loader awaiting `asyncio.sleep(0.05)` would never wake up.
        spins = 0
        while True:
            await asyncio.sleep(0 if spins < 3 else 0.005)
            spins += 1
            if not any(resource.is_loading() for resource in self._resources.values()):
                await asyncio.sleep(0)
                if not any(
                    resource.is_loading() for resource in self._resources.values()
                ):
                    return

    def _create_effect(
        self,
        definition: CellDefinition,
        previous: EffectState | None = None,
    ) -> None:
        state = EffectState(
            id=definition.id,
            enabled=definition.enabled,
            trigger=definition.trigger,
            trigger_count=previous.trigger_count if previous else 0,
            last_triggered=previous.last_triggered if previous else None,
            output=previous.output if previous else "",
            status=previous.status if previous else "idle",
            duration_ms=previous.duration_ms if previous else None,
        )
        self._live_dependencies.pop(definition.id, None)
        self._effect_reads.pop(definition.id, None)
        self._effect_states[definition.id] = state

        try:
            code, dependencies = compile_effect(
                definition.source, self._scope(definition.id), cell_filename(definition.id)
            )
            self._dependencies[definition.id] = dependencies
            self._effect_codes[definition.id] = code
        except Exception as error:
            state.error = error_message(error)
            self._log_error(definition.id, error)
            state.error_detail = self._error_fields(definition.id, error).get("errorDetail")
            self._dependencies[definition.id] = []
            return

        if not definition.enabled or definition.trigger == "manual":
            return

        tick = self._effect_write_ticks[definition.id] = Signal(0)
        def run_effect() -> None:
            tick()
            self._execute_effect(code, state)

        self._effects[definition.id] = Effect(run_effect)

    def _execute_effect(self, code: Any, state: EffectState) -> None:
        output, warnings = io.StringIO(), io.StringIO()
        started = perf_counter()
        state.status = "running"
        active = self._begin_timers(state.id)
        failure: BaseException | None = None
        transaction: dict[str, tuple[str, Any]] = {}
        self._write_transactions[state.id] = transaction
        try:
            runs = self._effect_runs[state.id] = self._effect_runs.get(state.id, 0) + 1
            if runs > 1:
                self._effect_reruns += 1
            if runs > 50 or self._effect_reruns > 50:
                raise RuntimeError('Effect feedback loop: more than 50 re-executions in one update')
            self._effect_reads[state.id] = set()
            self._raise_if_stopped(state.id)
            with _task_output(output, warnings):
                exec(code, self._evaluation_globals())
            self._commit_cell_writes(transaction)
            state.error = None
            state.error_detail = None
            state.status = "succeeded"
        except Exception as error:
            failure = error
            state.error = error_message(error)
            state.status = "failed"
        finally:
            self._write_transactions.pop(state.id, None)
            self._commit_timers(state.id, active)
            state.trigger_count += 1
            state.last_triggered = datetime.now(UTC).isoformat(
                timespec="milliseconds"
            )
            state.output = output.getvalue().rstrip()
            state.duration_ms = round((perf_counter() - started) * 1000, 3)
            if failure is None:
                self._log_output(state.id, output, warnings)
                self._logged_errors.pop(state.id, None)
            else:
                self._log_error(state.id, failure, output, warnings)
                state.error_detail = self._error_fields(state.id, failure).get("errorDetail")

    def _evaluate_formula_block(self, code: Any, bindings: dict[str, Any] | None = None) -> Any:
        namespace = {**self._evaluation_globals(), **(bindings or {})}
        exec(code, namespace)
        return namespace[FORMULA_RESULT]

    # --- Logs: output, warnings, and errors with their traceback ----------------------

    def _log_output(self, cell_id: str, output: io.StringIO, warnings: io.StringIO) -> None:
        if isinstance(output, LineOutput):
            output.flush()
        if isinstance(warnings, LineOutput):
            warnings.flush()
        printed = output.getvalue().rstrip()
        if printed:
            self._append_log(cell_id, "info", printed)
        warned = warnings.getvalue().rstrip()
        if warned:
            self._append_log(cell_id, "warning", CELL_LOCATION.sub(cell_location, warned))

    def _log_error(
        self,
        cell_id: str,
        error: BaseException,
        output: io.StringIO | None = None,
        warnings: io.StringIO | None = None,
    ) -> None:
        """Log an error (after the output printed before it) once, at the cell where it
        happened. Cells that fail only because they read a failed cell (or a resource that
        is still loading) are not logged; the snapshot names the cell that caused their
        error instead. A cell that keeps failing the same way is logged once."""
        if isinstance(error, ResourcePendingError) or error_origin(error) is not None:
            return
        if isinstance(error, CellInterrupted):
            self._stopped.add(cell_id)  # where it ran, not the cells that read it
        detail = error_detail(error, cell_id)
        try:
            setattr(error, ERROR_ORIGIN, cell_id)
            setattr(error, ERROR_DETAIL, detail)
        except Exception:  # exceptions with __slots__: logged, but not attributable
            pass
        signature = (error_message(error), detail["traceback"])
        if self._logged_errors.get(cell_id) == signature:
            return
        self._logged_errors[cell_id] = signature
        if output is not None and warnings is not None:
            self._log_output(cell_id, output, warnings)
        self._append_log(
            cell_id,
            "error",
            error_message(error),
            traceback=detail["traceback"],
            **({"line": detail["line"]} if detail.get("line") else {}),
        )

    def _error_fields(self, cell_id: str, error: BaseException) -> dict[str, Any]:
        """`errorDetail` of a failed cell: where it failed, or which cell caused it."""
        origin = error_origin(error)
        if origin is not None and origin != cell_id:
            return {"errorDetail": {"origin": origin}}
        detail = getattr(error, ERROR_DETAIL, None) or error_detail(error, cell_id)
        return {"errorDetail": detail}

    def _append_log(self, cell_id: str, level: str, message: str, **extra: Any) -> None:
        if cell_id.startswith('action:') and cell_id.count(':') >= 2:
            _, name, run_id = cell_id.split(':', 2)
            cell_id = 'action:' + name
            extra['invocationId'] = run_id
        self._logs.append(
            {
                "id": uuid4().hex,
                "timestamp": datetime.now(UTC).isoformat(
                    timespec="milliseconds"
                ),
                "cellId": cell_id,
                "level": level,
                "message": message,
                **extra,
            }
        )
        if len(self._logs) > 500:
            del self._logs[:-500]
        if self.log_reporter is not None:
            self.log_reporter(dict(self._logs[-1]))

    def _ensure_slot(self, cell_id: str) -> ComputeSignal[Any]:
        slot = self._slots.get(cell_id)
        if slot is not None:
            return slot
        revision = Signal(0)
        self._revisions[cell_id] = revision
        last_revision: int | None = None
        replaced = False
        last_node_id: int | None = None
        last_version: int | None = None
        same_input_node = False
        input_unchanged = False

        def read_slot() -> Any:
            nonlocal last_revision, replaced, last_node_id, last_version, same_input_node, input_unchanged
            current_revision = revision()
            replaced = last_revision is not None and current_revision != last_revision
            last_revision = current_revision
            try:
                value = self._read_current(cell_id, revision)
            except Exception:
                last_node_id, last_version = None, None
                raise
            node = self._nodes[cell_id]
            definitions = self._incoming_definitions if self._incoming_definitions is not None else self._definitions
            same_input_node = definitions[cell_id].kind == "input" and id(node) == last_node_id
            node_version = signal_version(node)
            input_unchanged = same_input_node and node_version == last_version
            last_node_id, last_version = id(node), node_version
            return value

        def slot_equal(previous: Any, current: Any) -> bool:
            # A value node has already applied equality to ordinary updates.
            # Only node replacement needs comparison against the old slot value.
            if not replaced:
                return False
            # Editing an initializer invalidates readers before it runs. The
            # existing input Signal still owns equality; do not call it twice.
            if same_input_node:
                return input_unchanged
            definitions = self._incoming_definitions if self._incoming_definitions is not None else self._definitions
            definition = definitions.get(cell_id)
            return self._cell_equality(definition)(previous, current) if definition is not None else previous is current

        slot = ComputeSignal(read_slot, equal=slot_equal)
        self._slots[cell_id] = slot
        return slot

    def _bump_revision(self, cell_id: str) -> None:
        self._ensure_slot(cell_id)
        revision = self._revisions[cell_id]
        revision.set(revision() + 1)

    def _read_current(self, cell_id: str, revision: Signal[int]) -> Any:
        revision()
        node = self._nodes.get(cell_id)
        if node is None:
            raise KeyError(f"Cell {cell_id} does not contain a value")
        if cell_id in self._input_initializers or cell_id in self._input_errors:
            untracked(lambda: self._initialize_input(cell_id))
        return self._nodes[cell_id]()

    def _initialize_input(self, cell_id: str) -> None:
        if cell_id in self._input_errors:
            raise self._input_errors[cell_id]
        definition = self._input_initializers.get(cell_id)
        if definition is None:
            return
        if cell_id in self._input_initializing:
            raise RuntimeError(f"Circular input initialization at {cell_id}")
        self._input_initializing.add(cell_id)
        started = perf_counter()
        active = self._begin_timers(cell_id, track=False)
        output, warnings = io.StringIO(), io.StringIO()
        try:
            self._raise_if_stopped(cell_id)
            with _task_output(output, warnings):
                code, _, expression = compile_formula(definition.source or "None", self._scope(cell_id), cell_filename(cell_id))
                value = eval(code, self._evaluation_globals()) if expression else self._evaluate_formula_block(code)
            if inspect.isawaitable(value):
                if inspect.iscoroutine(value):
                    value.close()
                raise TypeError("Input initialization must be synchronous; use a resource for async work")
            if cell_id in self._fresh_inputs:
                self._nodes[cell_id] = Signal(value, equal=self._cell_equality(definition))
                self._fresh_inputs.discard(cell_id)
            else:
                self._nodes[cell_id].set(value)
            self._runtime_inputs.discard(cell_id)
            self._dependencies[cell_id] = definition_dependencies(definition, self._scope(cell_id))
            self._input_initializers.pop(cell_id, None)
            self._log_output(cell_id, output, warnings)
            self._logged_errors.pop(cell_id, None)
        except Exception as error:
            self._input_errors[cell_id] = error
            self._bump_revision(cell_id)
            self._log_error(cell_id, error, output, warnings)
            raise
        finally:
            self._input_initializing.discard(cell_id)
            self._commit_timers(cell_id, active)
            self._cell_durations[cell_id] = round((perf_counter() - started) * 1000, 3)

    def _read(self, cell_id: str) -> Any:
        actor = ACTIVE_CELL.get()
        if actor and actor[0] is self and actor[1] in self._write_transactions and isinstance(current_consumer(), Effect):
            self._effect_reads[actor[1]].add(cell_id)
        reads = READ_CONTEXT.get()
        if reads is not None and reads[0] is self and reads[2] is current_consumer():
            reads[3].add(cell_id)
        if cell_id in self._input_initializing:
            raise RuntimeError(f"Circular input initialization at {cell_id}")
        value = self._ensure_slot(cell_id)()
        active = ACTIVE_CELL.get()
        transaction = self._write_transactions.get(active[1], {}) if active and active[0] is self else {}
        # Action writes are already in the graph; only effects need a staged
        # read overlay. An action's write log must not hide a later effect write.
        pending = None if active and active[1].startswith('action:') else transaction.get(cell_id)
        if pending and pending[0] == 'set':
            value = pending[1]
        if is_anywidget(value):
            model_id = widgets.model_id_of(value)
            if model_id is not None:
                self._widget_cells[model_id] = cell_id
        return value

    def _resolve_cell_ref(self, name: str, sheet: str | None) -> CellRef[Any]:
        active = ACTIVE_CELL.get()
        if active is None or active[0] is not self:
            raise RuntimeError('Cell references are available inside workbook cells')
        scope = self._scope(active[1])
        target = scope.qualified(sheet, name) if sheet is not None else scope.coordinate(name) or scope.label(name)
        definitions = self._incoming_definitions if self._incoming_definitions is not None else self._definitions
        if target is None or target not in definitions:
            raise KeyError(f'Unknown cell reference: {sheet + "." if sheet else ""}{name}')
        return self._cell_ref(target)

    def _cell_ref(self, cell_id: str) -> CellRef[Any]:
        return CellRef(lambda: self._read(cell_id),
                       lambda value: self._stage_cell_write(cell_id, 'set', value),
                       lambda: self._stage_cell_write(cell_id, 'reset', None))

    def _stage_cell_write(self, cell_id: str, operation: str, value: Any) -> None:
        active = ACTIVE_CELL.get()
        transaction = self._write_transactions.get(active[1]) if active and active[0] is self else None
        if transaction is None:
            raise RuntimeError('Only effect cells and actions can write inputs')
        definitions = self._incoming_definitions if self._incoming_definitions is not None else self._definitions
        definition = definitions.get(cell_id)
        if definition is None or definition.kind not in ('input', 'linked'):
            raise TypeError(f'{cell_id} is read-only; only input and linked cells are writable')
        if operation == 'reset' and definition.kind != 'linked':
            raise TypeError('Only linked inputs can be reset')
        if not CELL_WRITES_ENABLED.get():
            return
        transaction[cell_id] = (operation, value)
        if active is not None and active[1].startswith('action:'):
            # Each explicit action write starts a new propagation. Long-running
            # actions may legitimately notify effects thousands of times; only
            # reruns within one propagation are potential feedback. An action
            # called by an effect must retain that effect's feedback budget.
            if not any(not key.startswith('action:') for key in self._write_transactions):
                self._effect_runs.clear()
                self._effect_reruns = 0
            # Actions are explicit imperative operations, like native model calls.
            # Publish each write now so computed/resource/effect consumers see it
            # during the action, including before the next await. Keep transaction
            # as a changed-ID log for the final snapshot, not a pending overlay.
            self._commit_cell_writes({cell_id: (operation, value)})
            self._settle_cell_writes()
            self._live_snapshot_dirty = True
            self._publish_action_snapshot()

    def _settle_cell_writes(self) -> None:
        # Reaktiv avoids re-entering an executing effect. Reschedule its own
        # changed reads once its callback has finished, instead of dropping them.
        while self._pending_write_effects:
            pending, self._pending_write_effects = self._pending_write_effects, {}
            with batch():
                for cell_id, runs in pending.items():
                    if cell_id in self._effects and self._effect_runs.get(cell_id, 0) == runs:
                        tick = self._effect_write_ticks[cell_id]
                        untracked(lambda: tick.set(tick() + 1))

    def _depends_on_write(self, effect_id: str, targets: set[str]) -> bool:
        seen: set[str] = set()
        def visit(cell_id: str) -> bool:
            if cell_id in targets:
                return True
            if cell_id in seen:
                return False
            seen.add(cell_id)
            return any(visit(dep) for dep in self._dependencies.get(cell_id, []))
        return any(visit(dep) for dep in set(self._dependencies.get(effect_id, [])) | self._effect_reads.get(effect_id, set()))

    def _commit_cell_writes(self, transaction: dict[str, tuple[str, Any]]) -> None:
        if transaction:
            if self._update_trace.enabled:
                self._update_trace.roots.update(transaction)
            self.revision = uuid4().hex
        definitions = self._incoming_definitions if self._incoming_definitions is not None else self._definitions
        # Refresh linked derivations before changing inputs, then apply explicit overrides last.
        for cell_id in transaction:
            if definitions[cell_id].kind == 'linked':
                untracked(lambda cell_id=cell_id: self._nodes[cell_id]())
        written: set[str] = set()
        runs_before = dict(self._effect_runs)
        with batch():
            for cell_id, (operation, value) in transaction.items():
                definition = definitions[cell_id]
                if definition.kind != 'input':
                    continue
                # Persist literal values when possible. Opaque Python objects remain
                # live state; their initialization code is the reproducible saved source.
                if not definition.save_value:
                    # Avoid even converting large acquisitions into Python literals.
                    source = definition.source
                    self._runtime_inputs.add(cell_id)
                else:
                    try:
                        source = input_source_with_value(definition.source, literal_source(value))
                        self._runtime_inputs.discard(cell_id)
                    except TypeError:
                        source = definition.source
                        self._runtime_inputs.add(cell_id)
                if definition.source != source:
                    updated = replace(definition, source=source)
                    definitions[cell_id] = updated
                    self._cell_changes[cell_id] = updated
                node = self._nodes[cell_id]
                version = signal_version(node)
                self._input_initializers.pop(cell_id, None)
                had_error = self._input_errors.pop(cell_id, None) is not None
                if cell_id in self._fresh_inputs:
                    self._nodes[cell_id] = Signal(value, equal=self._cell_equality(definition))
                    self._fresh_inputs.discard(cell_id)
                    untracked(lambda cell_id=cell_id: self._bump_revision(cell_id))
                    written.add(cell_id)
                else:
                    node.set(value)
                    if had_error:
                        untracked(lambda cell_id=cell_id: self._bump_revision(cell_id))
                if signal_version(node) != version:
                    written.add(cell_id)
            for cell_id, (operation, value) in transaction.items():
                definition = definitions[cell_id]
                if definition.kind != 'linked':
                    continue
                if operation == 'reset':
                    if definition.override is None and self._linked_overrides.get(cell_id) is None and cell_id not in self._runtime_inputs:
                        continue
                    node, dependencies = self._create_value_node(replace(definition, override=None))
                    self._nodes[cell_id] = node
                    self._dependencies[cell_id] = dependencies
                    self._linked_overrides[cell_id] = None
                    self._runtime_inputs.discard(cell_id)
                    untracked(lambda: self._bump_revision(cell_id))
                    written.add(cell_id)
                    updated = replace(definition, override=None)
                else:
                    try:
                        override = literal_source(value)
                        self._runtime_inputs.discard(cell_id)
                    except TypeError:
                        override = None
                        self._runtime_inputs.add(cell_id)
                    untracked(lambda: self._nodes[cell_id]())
                    version = signal_version(self._nodes[cell_id])
                    self._nodes[cell_id].set(value)
                    if signal_version(self._nodes[cell_id]) != version:
                        written.add(cell_id)
                    self._linked_overrides[cell_id] = override
                    updated = replace(definition, override=override)
                if updated != definition:
                    definitions[cell_id] = updated
                    self._cell_changes[cell_id] = updated
        # Native effects can suppress notifications while a nested callback is
        # running. Queue dependent effects that did not already run after this
        # write; the run count also prevents duplicate native/deferred callbacks.
        for effect_id in self._effects:
            runs = runs_before.get(effect_id, 0)
            if self._effect_runs.get(effect_id, 0) == runs and self._depends_on_write(effect_id, written):
                self._pending_write_effects[effect_id] = runs

    def register_bindings(self, widget: Any, bindings: Mapping[str, str]) -> None:
        """Called by bind(): every target must be an input cell (widgets set inputs only)."""
        for trait, target in bindings.items():
            definition = self._definitions.get(target)
            if definition is None or definition.kind not in ("input", "linked"):
                kind = "missing" if definition is None else f"a {definition.kind} cell"
                raise ValueError(f"bind({trait}=…): {target} is {kind}; a widget can only be bound to input cells")
        model_id = widgets.model_id_of(widget)
        if model_id is not None:
            self._widget_bindings[model_id] = dict(bindings)

    def update_widget(
        self, cell_id: str, state: Mapping[str, Any], model_id: str | None = None
    ) -> WorkbookSnapshot:
        """Apply state changed in the widget's view (model.save_changes()) to the Python
        widget: its own state, which no other cell reads (bound traits are written to their
        input cells by the app instead). ``model_id`` names a nested widget
        (``widget_manager.get_model``); a model that no longer exists is ignored."""
        reads = READ_CONTEXT.get()
        if reads is not None and reads[0] is self and reads[2] is current_consumer():
            reads[3].add(cell_id)
        if cell_id in self._input_initializing:
            raise RuntimeError(f"Circular input initialization at {cell_id}")
        value = self._ensure_slot(cell_id)()
        if not is_anywidget(value):
            raise ValueError(f"Cell {cell_id} is not an anywidget")
        target = model_id or widgets.model_id_of(value)
        delivered = target is not None and widgets.deliver_update(target, dict(state))
        if not delivered and model_id is None:
            # A widget without a registered comm (a widget made outside a cell).
            value.set_state(widgets.decode_value(dict(state)))
        self._flush_widgets()
        return self.snapshot(changed=[cell_id])

    def widget_message(
        self,
        cell_id: str,
        content: Any,
        buffers: Iterable[Any] = (),
        model_id: str | None = None,
    ) -> WorkbookSnapshot:
        """A view sent a custom message (``model.send``): the widget's ``on_msg``
        handlers (and anywidget commands) run; replies reach the view with the snapshot."""
        reads = READ_CONTEXT.get()
        if reads is not None and reads[0] is self and reads[2] is current_consumer():
            reads[3].add(cell_id)
        if cell_id in self._input_initializing:
            raise RuntimeError(f"Circular input initialization at {cell_id}")
        value = self._ensure_slot(cell_id)()
        target = model_id or widgets.model_id_of(value)
        if target is None or not widgets.deliver_custom(target, content, list(buffers)):
            raise ValueError(f"Cell {cell_id} is not a widget that can receive messages")
        self._flush_widgets()
        return self.snapshot(changed=[cell_id])

    def _flush_widgets(self) -> None:
        """Widgets changed by Python code (an effect, a message handler, an observer):
        their views get the new state with the next snapshot; no cell depends on it."""
        widgets.registry.take_changed()

    # --- Clock cells: every(...) / at(...), see timers.py -------------------------------

    def _timer_tick(self, cell_id: str) -> Signal[int]:
        tick = self._timer_ticks.get(cell_id)
        if tick is None:
            tick = self._timer_ticks[cell_id] = Signal(0)
        return tick

    def _begin_timers(self, cell_id: str, *, track: bool = True, widget: bool = False) -> Any:
        """Start evaluating a cell: timers it registers from now on replace its old ones."""
        if not widget and not cell_id.startswith("action:"):
            self._update_trace.executed(cell_id)
        self._timer_pending[cell_id] = []
        self._widget_generation[cell_id] = widgets.registry.sequence
        self._report_progress("start", cell_id)
        reads: set[str] = set()
        if track:
            (self._live_widget_dependencies if widget else self._live_dependencies)[cell_id] = reads
        return (ACTIVE_CELL.set((self, cell_id)), READ_CONTEXT.set((self, cell_id, current_consumer(), reads, widget) if track else None))

    def _report_progress(self, event: str, cell_id: str) -> None:
        if self.progress is None:
            return
        try:
            self.progress(event, ":".join(cell_id.split(":")[:2]) if cell_id.startswith("action:") else cell_id)
        except Exception:  # pragma: no cover - a host's reporter must never break a run
            pass

    def register_timer(self, cell_id: str, spec: TimerSpec | None) -> datetime:
        """Called by every()/at() inside a cell; returns the time of the cell's last tick.
        ``spec`` is None for a paused clock (``enabled=False``)."""
        self._timer_tick(cell_id)()  # the cell re-runs when it ticks
        if spec is not None:
            self._timer_pending.setdefault(cell_id, []).append(spec)
        last = self._timer_last.get(cell_id)
        if last is None:
            last = self._timer_last[cell_id] = self._clock()
        return last.replace(microsecond=0)

    def _commit_timers(self, cell_id: str, active: Any) -> None:
        ACTIVE_CELL.reset(active[0])
        READ_CONTEXT.reset(active[1])
        self._report_progress("end", cell_id)
        if cell_id in self._resources:
            self._live_snapshot_dirty = True
        # Widgets the cell created in earlier runs are replaced: close them.
        widgets.release(widgets.owner_key(self, cell_id), self._widget_generation.pop(cell_id, 0))
        specs = tuple(self._timer_pending.pop(cell_id, ()))
        if not specs:
            # No longer a clock, or paused (`every(60, enabled=False)`): stop ticking.
            self._timer_specs.pop(cell_id, None)
            self._timer_due.pop(cell_id, None)
            return
        if self._timer_specs.get(cell_id) != specs or cell_id not in self._timer_due:
            self._timer_specs[cell_id] = specs
            now = self._clock()
            self._timer_due[cell_id] = min(spec.next_after(now) for spec in specs)

    def _forget_timer(self, cell_id: str) -> None:
        self._timer_specs.pop(cell_id, None)
        self._timer_due.pop(cell_id, None)
        self._timer_last.pop(cell_id, None)
        self._timer_pending.pop(cell_id, None)

    def _fire_timer(self, cell_id: str) -> bool:
        specs = self._timer_specs.get(cell_id)
        if specs is None:
            return False  # a stale tick: the cell changed or is no longer a clock
        now = self._clock()
        self._timer_last[cell_id] = now
        self._timer_due[cell_id] = min(spec.next_after(now) for spec in specs)
        tick = self._timer_tick(cell_id)
        tick.set(tick() + 1)
        return True

    def resample_view(self, token: str, ranges: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """The points of a resampled chart inside the visible ``ranges`` (resample.py): asked by
        the chart when the user zooms or pans. Runs no cells."""
        return resampling.view(token, ranges)

    def tick_timer(self, cell_id: str) -> WorkbookSnapshot:
        """Fire a clock cell now: it takes the current time and everything reading it
        re-runs. Hosts call this when the timer in ``snapshot.timers`` is due."""
        fired = self._fire_timer(cell_id)
        self._flush_widgets()
        return self.snapshot(changed=[cell_id] if fired else [])

    async def tick_timer_async(self, cell_id: str) -> WorkbookSnapshot:
        """Like :meth:`tick_timer`, and waits for resources reloaded by the tick."""
        fired = self._fire_timer(cell_id)
        await self._wait_for_resources()
        self._flush_widgets()
        return self.snapshot(changed=[cell_id] if fired else [])

    def timer_schedule(self) -> tuple[dict[str, Any], ...]:
        """Current clock deadlines for an embedding host, without evaluating cells."""
        return self._timer_payload()

    def _timer_payload(self) -> tuple[dict[str, Any], ...]:
        now = self._clock()
        return tuple(
            {
                "cellId": cell_id,
                "label": " · ".join(spec.label for spec in self._timer_specs[cell_id]),
                "lastAt": self._timer_last[cell_id].isoformat(timespec="seconds"),
                "nextAt": due.isoformat(timespec="seconds"),
                "nextInSeconds": round(max(0.0, (due - now).total_seconds()), 3),
            }
            for cell_id, due in sorted(self._timer_due.items(), key=lambda item: item[1])
            if cell_id in self._definitions and cell_id in self._timer_specs
        )

    def _render_markdown(
        self,
        parts: list[tuple[bool, Any, str | None]],
        *,
        embed_images: bool = False,
        outputs: str = "keep",
    ) -> str:
        return render_markdown(
            parts, self._evaluation_globals(), self._rich_payload, self._table_payload,
            embed_images=embed_images, outputs=outputs,
        )

    def render_note(self, cell_id: str) -> str:
        """Return a Markdown cell as self-contained Markdown with embedded images."""

        parts = self._markdown_parts.get(cell_id)
        if parts is None:
            raise KeyError(f"Cell {cell_id} is not a Markdown cell")
        self._read(cell_id)  # surface evaluation errors for this note first
        return self._render_markdown(parts, embed_images=True, outputs="unwrap")

    def render_note_page(self, cell_id: str) -> str:
        """A note for a static web page: outputs stay linked (``![Plot](#cell-C1)``) and wide
        or full-width values are marked (see ``_render_markdown``)."""

        parts = self._markdown_parts.get(cell_id)
        if parts is None:
            raise KeyError(f"Cell {cell_id} is not a Markdown cell")
        self._read(cell_id)
        return self._render_markdown(parts, outputs="mark")

    def rich_output(self, cell_id: str) -> dict[str, Any] | None:
        """Return the cached image payload for a cell whose value is a plot."""

        return self._rich_payload(cell_id, self._read(cell_id))

    def _rich_payload(self, cell_id: str, value: Any) -> dict[str, Any] | None:
        return self._outputs.rich(cell_id, value)

    def _table_payload(self, cell_id: str, value: Any) -> dict[str, Any] | None:
        return self._outputs.table(cell_id, value)

    def _shared_code_globals(self) -> dict[str, Any]:
        """What shared code can use (the same defaults cells get)."""
        values: dict[str, Any] = {
            "asyncio": asyncio,
            "math": math,
            "statistics": statistics,
            "env": self._environment,
            "cells": self._cell_namespace,
            "actions": self._action_namespace,
            "batch": batch,
            "Artifact": Artifact,
            "artifact": artifact,
            "every": every,
            "at": at,
            "html": html,
            "resampled": resampled,
            "HTML": HTML,
            "bind": widgets.bind,
            "__binding": widgets.Binding,
            "np": optional_numpy,
            "values_equal": values_equal,
        }
        return values

    def _evaluation_globals(self) -> dict[str, Any]:
        values: dict[str, Any] = {
            "__builtins__": CELL_BUILTINS,
            "__read": self._read,
            "asyncio": asyncio,
            "math": math,
            "statistics": statistics,
            "env": self._environment,
            "cells": self._cell_namespace,
            "actions": self._action_namespace,
            "batch": batch,
            "Artifact": Artifact,
            "artifact": artifact,
            "every": every,
            "at": at,
            "html": html,
            "resampled": resampled,
            "HTML": HTML,
            "bind": widgets.bind,
            "__binding": widgets.Binding,
            "np": optional_numpy,
            "values_equal": values_equal,
        }
        values.update(self._import_globals)
        values.update(self._user_globals)
        return values


def _computational(definition: CellDefinition | None) -> CellDefinition | None:
    # Presentation, type hints and persistence policy never change a value.
    return None if definition is None else replace(definition, color="", view=None, annotation="", save_value=True)


def _raise(error: BaseException) -> Any:
    raise error


class _ActionNamespace:
    def __init__(self, workbook: ReactiveWorkbook) -> None:
        self.workbook = workbook
    def __getattr__(self, name: str) -> BoundAction[Any, Any]:
        return self.workbook.action_method(name)


class _ActionOwner:
    def __init__(self, workbook: ReactiveWorkbook, references: Mapping[str, str]) -> None:
        self.__workbook, self.__references = workbook, references
    @property
    def workbook(self) -> _ActionOwner:
        """`self` in an action is the workbook; `self.workbook.Sheet.member` is the cell spelling."""
        return self
    def __getattr__(self, name: str) -> Any:
        return self.__workbook.model_member(name, self.__references)


class _WorksheetActionNamespace:
    def __init__(self, workbook: ReactiveWorkbook, name: str, references: Mapping[str, str], members: Mapping[str, str]) -> None:
        self.workbook, self.name, self.references = workbook, name, references
        self.members = {path: cell_id for cell_id, path in members.items()}

    def __getattr__(self, name: str) -> Any:
        path = self.name + '.' + name
        cell_id = self.references.get(path) or self.members.get(path)
        if cell_id is None:
            raise AttributeError(f'Unknown worksheet cell: {path}')
        return self.workbook.model_cell_member(cell_id)
