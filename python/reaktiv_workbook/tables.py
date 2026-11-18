"""Tabular cell values (DataFrames, Series, lists of records/rows) as display tables.

A table payload is plain JSON the app renders natively (notes, inspector, grid):

    {"kind": "DataFrame", "columns": ["month", "income"], "index": None,
     "indexName": None, "rows": [["Jan", 6400], ...], "rowCount": 9,
     "columnCount": 2, "truncated": False}

Only the first ``MAX_ROWS`` rows and ``MAX_COLUMNS`` columns are sent; the counts
describe the full value. pandas is duck-typed, never imported here.
"""

from __future__ import annotations

import datetime as _dt
import math
from typing import Any, Optional, cast

from .narrowing import as_sequence

MAX_ROWS = 200
MAX_COLUMNS = 40
MARKDOWN_ROWS = 50


def table_payload(value: Any) -> Optional[dict[str, Any]]:
    """Describe ``value`` as a table, or ``None`` when it is not tabular."""
    module = type(value).__module__
    name = type(value).__name__
    if module.startswith("pandas") and name == "DataFrame":
        return _dataframe(value)
    if module.startswith("pandas") and name == "Series":
        return _dataframe(value.to_frame(name=value.name if value.name is not None else "value"), kind="Series")
    items = as_sequence(value)
    if items:
        if all(isinstance(row, dict) for row in items):
            return _records(items)
        rows = [as_sequence(row) for row in items]
        if all(row is not None for row in rows):
            widths = {len(row) for row in rows if row is not None}
            if len(widths) == 1 and widths != {0}:
                return _rows(items)
    return None


def table_summary(payload: dict[str, Any]) -> str:
    """Short grid label, e.g. ``DataFrame · 12 rows × 6 columns``."""
    rows, columns = payload["rowCount"], payload["columnCount"]
    return (
        f"{payload['kind']} · {rows:,} row{'s' if rows != 1 else ''} × "
        f"{columns} column{'s' if columns != 1 else ''}"
    )


def table_markdown(payload: dict[str, Any], max_rows: int = MARKDOWN_ROWS) -> str:
    """GitHub-flavoured Markdown table (for notes, the CLI, and exports)."""
    columns = list(payload["columns"])
    index = payload.get("index")
    header = ([payload.get("indexName") or ""] if index is not None else []) + columns
    numeric = [
        all(isinstance(row[position], (int, float)) or row[position] is None for row in payload["rows"])
        for position in range(len(columns))
    ]
    align = ([":--"] if index is not None else []) + ["--:" if flag else ":--" for flag in numeric]
    lines = [
        "| " + " | ".join(_markdown_cell(cell) for cell in header) + " |",
        "| " + " | ".join(align) + " |",
    ]
    for position, row in enumerate(payload["rows"][:max_rows]):
        cells = ([index[position]] if index is not None else []) + list(row)
        lines.append("| " + " | ".join(_markdown_cell(cell) for cell in cells) + " |")
    hidden_rows = payload["rowCount"] - min(max_rows, len(payload["rows"]))
    hidden_columns = payload["columnCount"] - len(columns)
    notes: list[str] = []
    if hidden_rows > 0:
        notes.append(f"{hidden_rows:,} more rows")
    if hidden_columns > 0:
        notes.append(f"{hidden_columns} more columns")
    if notes:
        lines.append("")
        lines.append(f"*… {', '.join(notes)} ({table_summary(payload)})*")
    return "\n".join(lines)


def _dataframe(frame: Any, kind: str = "DataFrame") -> dict[str, Any]:
    shown = frame.iloc[:MAX_ROWS, :MAX_COLUMNS]
    index = frame.index
    default_index = (
        type(index).__name__ == "RangeIndex" and index.start == 0 and index.step == 1
    )
    return {
        "kind": kind,
        "columns": [_label(column) for column in shown.columns],
        "index": None if default_index else [_cell(item) for item in shown.index],
        "indexName": None if default_index else _label(index.name) if index.name is not None else None,
        "rows": [[_cell(item) for item in row] for row in shown.itertuples(index=False, name=None)],
        "rowCount": int(frame.shape[0]),
        "columnCount": int(frame.shape[1]),
        "truncated": frame.shape[0] > MAX_ROWS or frame.shape[1] > MAX_COLUMNS,
    }


def _records(records: Any) -> dict[str, Any]:
    columns: list[Any] = []
    for record in records:
        for key in record:
            if key not in columns:
                columns.append(key)
    shown_columns = columns[:MAX_COLUMNS]
    return {
        "kind": "records",
        "columns": [_label(column) for column in shown_columns],
        "index": None,
        "indexName": None,
        "rows": [[_cell(record.get(column)) for column in shown_columns] for record in records[:MAX_ROWS]],
        "rowCount": len(records),
        "columnCount": len(columns),
        "truncated": len(records) > MAX_ROWS or len(columns) > MAX_COLUMNS,
    }


def _rows(rows: Any) -> dict[str, Any]:
    width = len(rows[0])
    shown = min(width, MAX_COLUMNS)
    return {
        "kind": "rows",
        "columns": [str(position) for position in range(shown)],
        "index": None,
        "indexName": None,
        "rows": [[_cell(item) for item in row[:shown]] for row in rows[:MAX_ROWS]],
        "rowCount": len(rows),
        "columnCount": width,
        "truncated": len(rows) > MAX_ROWS or width > MAX_COLUMNS,
    }


def _label(value: Any) -> str:
    if isinstance(value, tuple):
        return " / ".join(str(part) for part in cast(tuple[object, ...], value))
    return str(value)


def _cell(value: Any) -> Any:
    """JSON-safe cell: numbers stay numbers (for alignment); missing values are None."""
    if hasattr(value, "item") and type(value).__module__.startswith("numpy"):
        value = value.item()
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) else value if math.isfinite(value) else str(value)
    if isinstance(value, str):
        return value
    if type(value).__name__ in {"NaTType", "NAType"}:
        return None
    if isinstance(value, _dt.datetime):
        return value.date().isoformat() if value == _dt.datetime.combine(value.date(), _dt.time()) else value.isoformat(sep=" ")
    if isinstance(value, _dt.date):
        return value.isoformat()
    return str(value)


def _markdown_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:,.4f}".rstrip("0").rstrip(".")
    return str(value).replace("|", "\\|").replace("\n", " ")
