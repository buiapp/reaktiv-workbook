"""Bounded display and wire encoding of arbitrary Python cell values.

This module never reads the graph. Rich output and tables are prepared by the
output owner and passed in so encoding cannot evaluate or duplicate a plot.
"""
from __future__ import annotations

import ast
import inspect
import itertools
import math
import sys
from datetime import date, datetime, time
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    import numpy as np

from .artifact import Artifact
from .narrowing import as_dict, as_list, as_sequence
from .rich_output import HTML_MIME_TYPE, is_anywidget
from .tables import table_summary

NOTE_TABLE_KINDS = frozenset({"DataFrame", "Series"})


def parse_input(source: str) -> Any:
    value = source.strip()
    if value == "":
        return None
    try:
        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return source


def _numpy() -> Any:
    """numpy if it has been imported: it is optional, and its values exist only after an import."""
    return sys.modules.get("numpy")


def _as_array(value: object) -> np.ndarray[Any, Any] | None:
    """``value`` as a NumPy array, or None."""
    numpy = _numpy()
    return cast("np.ndarray[Any, Any]", value) if numpy is not None and isinstance(value, numpy.ndarray) else None


def values_equal(left: Any, right: Any, seen: set[tuple[int, int]] | None = None) -> bool:
    # Values with different Python types must not retain a stale signal value
    # after their saved literal changes (e.g. 1 -> True, or [1] -> [1.0]).
    if left is right:
        return True
    if type(left) is not type(right):
        return False
    if type(left) in (list, tuple, dict):
        seen = set() if seen is None else seen
        pair = (id(left), id(right))
        if pair in seen:
            return True
        seen.add(pair)
        if type(left) is dict:
            first, second = as_dict(cast(Any, left)) or {}, as_dict(right) or {}
            return len(first) == len(second) and all(
                values_equal(a, b, seen) and values_equal(x, y, seen)
                for (a, x), (b, y) in zip(first.items(), second.items())
            )
        first_sequence, second_sequence = as_sequence(left) or [], as_sequence(right) or []
        return len(first_sequence) == len(second_sequence) and all(
            values_equal(a, b, seen) for a, b in zip(first_sequence, second_sequence)
        )
    if _as_array(left) is not None or _as_array(right) is not None:
        numpy = _numpy()
        try:
            return bool(numpy.array_equal(left, right, equal_nan=True))
        except TypeError:
            return bool(numpy.array_equal(left, right))
    try:
        return bool(left == right)
    except (TypeError, ValueError):
        return False


def format_display(value: Any) -> str:
    if isinstance(value, Artifact):
        return value.filename
    array = _as_array(value)
    if array is not None:
        return _numpy().array2string(array, precision=4, threshold=8)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return str(value)
        return f"{value:,.4f}".rstrip("0").rstrip(".")
    if value is None:
        return ""
    if isinstance(value, type):
        return f"class {value.__name__}"
    if inspect.isfunction(value) or inspect.isbuiltin(value):
        try:
            return f"ƒ {value.__name__}{inspect.signature(value)}"
        except (TypeError, ValueError):
            return f"ƒ {value.__name__}"
    if isinstance(value, (list, tuple, dict, set, frozenset)):
        # A long container would print every item (megabytes for a big list): shorten it
        # the way NumPy shortens arrays. Strings and notes keep their full text.
        text = _short_repr(value, DISPLAY_LIMIT)
        return text if len(text) <= DISPLAY_LIMIT else f"{text[:DISPLAY_LIMIT]}…"
    return str(value)


DISPLAY_LIMIT = 10_000


def _short_repr(value: Any, budget: int) -> str:
    """``repr`` of a container in its own order, ending in ``...`` once about ``budget``
    characters are written (so a list of millions of items is never printed whole)."""
    mapping = as_dict(value)
    collection = (
        cast("list[Any] | tuple[Any, ...] | set[Any] | frozenset[Any]", value)
        if isinstance(value, (list, tuple, set, frozenset))
        else None
    )
    if mapping is not None:
        items: list[Any] = list(itertools.islice(mapping.items(), budget // 4 + 1))
        total = len(mapping)
        opening, closing = "{", "}"
    elif collection:
        items = list(itertools.islice(collection, budget // 4 + 1))
        total = len(collection)
        brackets: dict[type[object], tuple[str, str]] = {
            list: ("[", "]"), tuple: ("(", ")"), set: ("{", "}"), frozenset: ("frozenset({", "})"),
        }
        opening, closing = brackets.get(type(collection), (f"{type(collection).__name__}([", "])"))
    else:
        text = repr(cast(object, value))
        return text if len(text) <= budget else f"{text[:budget]}…"
    parts: list[str] = []
    used = len(opening) + len(closing)
    for item in items:
        if used >= budget:
            parts.append("...")
            break
        room = budget - used
        part = (
            f"{_short_repr(item[0], room)}: {_short_repr(item[1], room)}"
            if mapping is not None
            else _short_repr(item, room)
        )
        parts.append(part)
        used += len(part) + 2
    else:
        if len(items) < total:
            parts.append("...")
    trailing = "," if isinstance(value, tuple) and total == 1 else ""
    return f"{opening}{', '.join(parts)}{trailing}{closing}"


# Raw values travel with every snapshot (input widgets and KPI tiles read them). A large
# value (a long array, a big dict of arrays) would make the snapshot huge — hundreds of MB
# to encode, send, and parse — so it is sent without its raw value; display, tables, and
# plots are separate and stay.
VALUE_ITEM_LIMIT = 10_000


class _ValueTooLarge(Exception):
    pass


def _jsonable(value: Any) -> Any:
    """``value`` as JSON data, or None when it holds more than ``VALUE_ITEM_LIMIT`` items."""
    try:
        return _jsonable_within(value, [VALUE_ITEM_LIMIT])
    except _ValueTooLarge:
        return None


def _plain_json(value: Any) -> Any:
    """``tolist()`` output as JSON data: complex numbers and NaN/inf as text (the app shows
    them; strict JSON has no such numbers)."""
    items = as_list(value)
    if items is not None:
        return [_plain_json(item) for item in items]
    if isinstance(value, complex):
        return repr(value)
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return repr(value)


def _jsonable_within(value: Any, budget: list[int]) -> Any:
    def spend(items: int) -> None:
        budget[0] -= items
        if budget[0] < 0:
            raise _ValueTooLarge

    if isinstance(value, Artifact):
        return {
            "filename": value.filename,
            "mimeType": value.media_type,
            "size": value.size,
            "sha256": value.digest,
        }
    array = _as_array(value)
    if array is not None:
        spend(int(array.size))  # checked before converting: tolist() of a huge array is slow
        items: object = array.tolist()
        # Complex numbers, NaN/inf, and objects are not plain JSON: convert item by item.
        return _plain_json(items) if array.dtype.kind in "cfO" else items
    numpy = _numpy()
    if numpy is not None and isinstance(value, numpy.generic):
        return _jsonable_within(value.item(), budget)
    if isinstance(value, complex):
        return repr(value)
    if (mapping := as_dict(value)) is not None:
        spend(len(mapping))
        return {str(key): _jsonable_within(item, budget) for key, item in mapping.items()}
    if (sequence := as_sequence(value)) is not None:
        spend(len(sequence))
        return [_jsonable_within(item, budget) for item in sequence]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return str(value)
    if isinstance(value, str):
        spend(len(value) // 100)
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return repr(value)


def snapshot_value(
    cell_id: str,
    value: Any,
    *,
    value_type: str | None = None,
    resource_status: str | None = None,
    duration_ms: float | None = None,
    rich_output: dict[str, Any] | None = None,
    table: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if rich_output is not None and is_anywidget(value):
        display = f"{type(value).__name__} widget"
    elif rich_output is not None and rich_output["mimeType"] == HTML_MIME_TYPE:
        display = "HTML"
    elif rich_output is not None:
        display = "Plot"
    elif table is not None and table["kind"] in NOTE_TABLE_KINDS:
        display = table_summary(table)
    else:
        display = format_display(value)
    snapshot = {
        "id": cell_id,
        "display": display,
        "value": _jsonable(value),
        "valueType": (
            "artifact"
            if isinstance(value, Artifact)
            else "rich-output"
            if rich_output is not None
            else value_type or type(value).__name__
        ),
        "error": None,
        "durationMs": duration_ms,
    }
    if callable(value):
        try:
            signature = inspect.signature(value)
            if all(item.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY) for item in signature.parameters.values()):
                snapshot['callable'] = {'signature':str(signature), 'names':[item.name for item in signature.parameters.values()], 'async':inspect.iscoroutinefunction(value)}
        except (ValueError, TypeError):
            pass
    if isinstance(value, Artifact):
        snapshot["artifact"] = value.to_payload()
    if rich_output is not None:
        snapshot["richOutput"] = rich_output
    if table is not None:
        snapshot["table"] = table
    if resource_status is not None:
        snapshot["resourceStatus"] = resource_status
    return snapshot
