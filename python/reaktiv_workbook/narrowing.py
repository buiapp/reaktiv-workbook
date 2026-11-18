"""Typed narrowing for values that arrive untyped: JSON from the app or a file, user configuration,
and cell values. ``isinstance(value, Mapping)`` alone leaves keys and values unknown to the type
checker (pyright strict, see pyrightconfig.json); these helpers state what the code relies on.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Optional, cast


def as_mapping(value: object) -> Optional[Mapping[str, Any]]:
    """``value`` as a mapping with string keys, or None. Keys are not converted: JSON objects
    and the configuration the package accepts have string keys."""
    return cast(Mapping[str, Any], value) if isinstance(value, Mapping) else None


def as_dict(value: object) -> Optional[dict[str, Any]]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def as_list(value: object) -> Optional[list[Any]]:
    return cast(list[Any], value) if isinstance(value, list) else None


def as_sequence(value: object) -> Optional[Sequence[Any]]:
    """Lists and tuples (not strings or bytes)."""
    return cast(Sequence[Any], value) if isinstance(value, (list, tuple)) else None


def string_list(value: object) -> Optional[list[str]]:
    """A list whose items are all strings, or None."""
    items = as_list(value)
    if items is None or not all(isinstance(item, str) for item in items):
        return None
    return cast(list[str], items)
