"""Stateless, opt-in references to rich outputs the receiver explicitly retains.

No graph reads or server-side client history. Skipped progress frames are safe:
only content hashes supplied by this request may be omitted from its response.
"""
from __future__ import annotations

import hashlib
from typing import Any

from .narrowing import as_mapping, as_list


def pack_outputs(value: Any, known: list[str] | None = None) -> Any:
    retained = set(known or ())

    def visit(raw: Any) -> Any:
        items = as_list(raw)
        if items is not None:
            return [visit(item) for item in items]
        mapping = as_mapping(raw)
        if mapping is None:
            return raw
        result = dict(mapping)
        output = as_mapping(mapping.get('richOutput'))
        if output is not None:
            mime, data = output.get('mimeType'), output.get('dataBase64')
            if isinstance(mime, str) and isinstance(data, str):
                key = hashlib.sha256((mime + '\0' + data).encode()).hexdigest()
                result['richOutput'] = {'cacheKey': key} if key in retained else {**output, 'cacheKey': key}
        # Never traverse raw cell values, source, widget state or saved documents.
        for key in ('cells', 'actions', 'output', 'graph', 'snapshot'):
            if key in result:
                result[key] = visit(result[key])
        return result

    result = visit(value)
    mapping = as_mapping(result)
    return {**mapping, 'outputCacheVersion': 1} if mapping is not None and any(key in mapping for key in ('cells', 'graph', 'snapshot')) else result
