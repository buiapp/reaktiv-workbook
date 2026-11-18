"""Bounded estimates of evaluated value sizes; never read reactive signals."""

from __future__ import annotations

import sys
from typing import Any, cast

MAX_OBJECTS = 5000
MAX_DEPTH = 32


def value_memory(value: Any, budget: list[int] | None = None) -> dict[str, Any]:
    seen: set[int] = set()
    remaining = budget if budget is not None else [MAX_OBJECTS]
    limited = False

    def size(item: Any, depth: int = 0) -> int:
        nonlocal limited
        identity = id(item)
        if identity in seen:
            return 0
        if len(seen) >= MAX_OBJECTS or remaining[0] <= 0 or depth > MAX_DEPTH:
            limited = True
            return 0
        seen.add(identity)
        remaining[0] -= 1
        kind = cast(type[Any], type(item))
        # numpy is optional: an array exists only once numpy has been imported.
        numpy = sys.modules.get("numpy")
        if numpy is not None and kind is numpy.ndarray:
            limited = limited or item.dtype.hasobject
            header = numpy.ndarray.__sizeof__(item) - (item.nbytes if item.flags.owndata else 0)
            return header + item.nbytes
        if (kind.__module__ == "pandas" or kind.__module__.startswith("pandas.")) and kind.__name__ in ("DataFrame", "Series"):
            # Buffer sizes only: pandas' deep scan can invoke user __sizeof__ methods.
            dtypes = item.dtypes if kind.__name__ == "DataFrame" else [item.dtype]
            limited = limited or any(getattr(dtype, "hasobject", True) for dtype in dtypes)
            usage = item.memory_usage(index=True, deep=False)
            return int(usage.sum() if kind.__name__ == "DataFrame" else usage)
        if kind in (dict, list, tuple, set, frozenset):
            total = sys.getsizeof(item)
            entries = item.items() if kind is dict else item
            for entry in entries:
                if len(seen) >= MAX_OBJECTS or remaining[0] <= 0:
                    limited = True
                    break
                if kind is dict:
                    total += size(entry[0], depth + 1) + size(entry[1], depth + 1)
                else:
                    total += size(entry, depth + 1)
            return total
        if kind in (str, bytes, bytearray, int, float, complex, bool, type(None)):
            return sys.getsizeof(item)
        # Do not invoke arbitrary __sizeof__ methods or walk live custom object graphs.
        limited = True
        return object.__sizeof__(item)

    return {"bytes": size(value), "limited": limited}
