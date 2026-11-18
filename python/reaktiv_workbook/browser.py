"""Small JSON boundary used by the Pyodide Web Worker."""

import json

from .file_api import inspect_document as inspect_source
from .model import move_cell_group, move_cells, verify_written_document
from .workbook import ReactiveWorkbook
from .output_transport import pack_outputs
from .narrowing import string_list


_workbook = ReactiveWorkbook()
_known_outputs: list[str] | None = None


def set_output_cache(serialized_keys: str) -> None:
    global _known_outputs
    value: object = json.loads(serialized_keys)
    _known_outputs = None if value is None else (string_list(value) or [])[:128]


def _encode_result(value: object) -> str:
    return json.dumps(value if _known_outputs is None else pack_outputs(value, _known_outputs), allow_nan=False)



def _clean_code(code: object) -> str | None:
    if code is None or not isinstance(code, str):
        return None
    return code


def inspect_document(source: str) -> str:
    """Parse workbook source without importing or executing it."""

    return json.dumps(inspect_source(source), allow_nan=False)


def verify_document(source: str, serialized_document: str) -> str:
    """Check a file the app is about to save: JSON list of problems (empty = it loads back
    as the same workbook). See ``verify_written_document``."""

    return json.dumps(verify_written_document(source, json.loads(serialized_document)))


def apply_model(
    serialized_definitions: str,
    serialized_variables: str = "{}",
    serialized_imports: str = "[]",
    serialized_sheets: str = "null",
    code: str | None = None,
    serialized_stopped: str = "null",
    allow_cell_writes: bool = True,
    serialized_actions: str = "[]",
    enable_update_tracing: bool = False,
) -> str:
    _workbook.set_update_tracing(enable_update_tracing)
    definitions = json.loads(serialized_definitions)
    variables = json.loads(serialized_variables)
    imports = json.loads(serialized_imports)
    snapshot = _workbook.apply(
        definitions,
        actions=json.loads(serialized_actions),
        variables=variables,
        imports=imports,
        sheets=json.loads(serialized_sheets),
        code=_clean_code(code),
        stopped=json.loads(serialized_stopped),
        allow_cell_writes=allow_cell_writes,
    )
    return _encode_result(snapshot.to_dict())


async def apply_model_async(
    serialized_definitions: str,
    serialized_variables: str = "{}",
    serialized_imports: str = "[]",
    serialized_sheets: str = "null",
    code: str | None = None,
    serialized_stopped: str = "null",
    allow_cell_writes: bool = True,
    serialized_actions: str = "[]",
    enable_update_tracing: bool = False,
) -> str:
    _workbook.set_update_tracing(enable_update_tracing)
    definitions = json.loads(serialized_definitions)
    variables = json.loads(serialized_variables)
    imports = json.loads(serialized_imports)
    snapshot = await _workbook.apply_async(
        definitions,
        actions=json.loads(serialized_actions),
        variables=variables,
        imports=imports,
        sheets=json.loads(serialized_sheets),
        code=_clean_code(code),
        stopped=json.loads(serialized_stopped),
        allow_cell_writes=allow_cell_writes,
    )
    return _encode_result(snapshot.to_dict())


async def update_action(serialized_definition: str, expected_revision: str) -> str:
    return _encode_result(await _workbook.update_action_async(json.loads(serialized_definition), expected_revision))


def update_widget(cell_id: str, serialized_state: str, model_id: str | None = None) -> str:
    snapshot = _workbook.update_widget(cell_id, json.loads(serialized_state), model_id or None)
    return _encode_result(snapshot.to_dict())


def widget_message(cell_id: str, serialized_message: str) -> str:
    """A view's model.send(content, callbacks, buffers): {content, buffers, modelId}."""
    message = json.loads(serialized_message)
    snapshot = _workbook.widget_message(
        cell_id, message.get("content"), message.get("buffers") or [], message.get("modelId") or None
    )
    return _encode_result(snapshot.to_dict())


async def tick_timer(cell_id: str) -> str:
    """A clock cell (every/at) is due: tick it and wait for the resources it reloads."""
    snapshot = await _workbook.tick_timer_async(cell_id)
    return _encode_result(snapshot.to_dict())


def resample_view(token: str, serialized_ranges: str) -> str:
    """Points of a resampled chart in the visible ranges (resample.py)."""
    return json.dumps(_workbook.resample_view(token, json.loads(serialized_ranges)), allow_nan=False)


def run_effect(cell_id: str) -> str:
    snapshot = _workbook.run_effect(cell_id)
    return _encode_result(snapshot.to_dict())


def move_model(
    serialized_definitions: str, source_id: str, target_id: str, serialized_sheets: str = "null"
) -> str:
    definitions = json.loads(serialized_definitions)
    moved = move_cells(definitions, source_id, target_id, json.loads(serialized_sheets))
    return json.dumps([cell.to_dict() for cell in moved], allow_nan=False)


def move_model_group(
    serialized_definitions: str,
    serialized_source_ids: str,
    anchor_id: str,
    target_id: str,
    serialized_sheets: str = "null",
) -> str:
    definitions = json.loads(serialized_definitions)
    source_ids = json.loads(serialized_source_ids)
    moved = move_cell_group(
        definitions, source_ids, anchor_id, target_id, json.loads(serialized_sheets)
    )
    return json.dumps([cell.to_dict() for cell in moved], allow_nan=False)


def clear_logs() -> str:
    return _encode_result(_workbook.clear_logs().to_dict())


def set_log_reporter(report: object) -> None:
    """The worker forwards each bounded log entry while Python is running."""
    _workbook.log_reporter = None if report is None else (lambda entry: report(json.dumps(entry, allow_nan=False)))  # type: ignore[operator]


def set_progress_reporter(report: object) -> None:
    """The worker passes a JavaScript function ``(event, cellId)``; it posts each cell's
    start and end to the app while Python is still running."""
    _workbook.progress = None if report is None else (lambda event, cell_id: report(event, cell_id))  # type: ignore[operator]


def set_snapshot_reporter(report: object) -> None:
    """Publish throttled action output frames without completing the worker request."""
    _workbook.snapshot_reporter = None if report is None else (lambda snapshot: report(_encode_result(snapshot)))  # type: ignore[operator]


def run_console(source: str, sheet: str = "") -> str:
    return json.dumps(_workbook.run_console(source, sheet), allow_nan=False)


def cell_memory() -> str:
    return json.dumps(_workbook.cell_memory(), allow_nan=False)


async def run_action(name: str, serialized_arguments: str = '{}', run_id: str = '') -> str:
    known = _known_outputs
    result = (await _workbook.run_action_async(name, json.loads(serialized_arguments), run_id=run_id or None)).to_dict()
    return json.dumps(result if known is None else pack_outputs(result, known), allow_nan=False)


def cancel_resource(cell_id: str) -> str:
    return json.dumps({'cancelled': _workbook.cancel_resource(cell_id)})


def cancel_action(name: str, run_id: str = '') -> str:
    return json.dumps({'cancelled':_workbook.cancel_action(name, run_id or None)})


async def move_workbook_command(serialized: str) -> str:
    from .moves import move_workbook
    from .narrowing import as_mapping, string_list
    value = as_mapping(json.loads(serialized))
    if value is None:
        raise TypeError("Move command must be an object")
    revision, source, target = (value.get(key) for key in ("expectedRevision", "sourceId", "targetId"))
    if not isinstance(revision, str) or not isinstance(source, str) or not isinstance(target, str):
        raise TypeError("Move command requires revision, source and target")
    selected = string_list(value["sourceIds"]) if value.get("sourceIds") is not None else None
    if value.get("sourceIds") is not None and selected is None:
        raise TypeError("sourceIds must be an array of strings")
    return _encode_result(await move_workbook(_workbook, revision, source, target, selected))


def queue_action_inputs(run_id: str, serialized_sources: str) -> str:
    from .narrowing import as_mapping
    sources = as_mapping(json.loads(serialized_sources))
    if sources is None or not all(isinstance(value, str) for value in sources.values()):
        raise TypeError('sources must map cell IDs to literal Python strings')
    return json.dumps({'accepted': _workbook.action_inputs.submit(run_id, {key: str(value) for key, value in sources.items()})})


async def set_inputs(serialized_sources: str) -> str:
    from .narrowing import as_mapping
    sources = as_mapping(json.loads(serialized_sources))
    if sources is None or not all(isinstance(value, str) for value in sources.values()):
        raise TypeError('sources must map cell IDs to literal Python strings')
    known = _known_outputs
    result = (await _workbook.set_inputs_async({key: str(value) for key, value in sources.items()})).to_dict()
    return json.dumps(result if known is None else pack_outputs(result, known), allow_nan=False)
