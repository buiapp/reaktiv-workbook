"""Bounded syntax facts, independent of workbook labels and sheet scope.

Keep candidate name tokens, not every token or AST node of large literal buffers.
Resolution against the current scope remains the caller's responsibility.
"""
from __future__ import annotations

import ast
from collections import OrderedDict
from dataclasses import dataclass
import io
from threading import RLock
import tokenize

Window = tuple[tokenize.TokenInfo, tuple[tokenize.TokenInfo, ...]]
_LIMIT = 16 * 1024 * 1024
_LOCK = RLock()
_MISSING = object()

@dataclass
class Analysis:
    windows: tuple[Window, ...]
    bound: frozenset[str] | None = None
    literal: bool = False
    literal_type: str | None = None

_CACHE: OrderedDict[str, Analysis] = OrderedDict()
_cache_weight = 0

def _weight(source: str, item: Analysis) -> int:
    return len(source) * 4 + len(item.windows) * 768

def _remember(source: str, item: Analysis) -> Analysis:
    global _cache_weight
    with _LOCK:
        old = _CACHE.pop(source, None)
        if old is not None:
            _cache_weight -= _weight(source, old)
        weight = _weight(source, item)
        if weight <= _LIMIT:
            while _CACHE and (_cache_weight + weight > _LIMIT or len(_CACHE) >= 256):
                key, value = _CACHE.popitem(last=False)
                _cache_weight -= _weight(key, value)
            _CACHE[source] = item
            _cache_weight += weight
    return item

def _cached(source: str) -> Analysis | None:
    with _LOCK:
        item = _CACHE.get(source)
        if item is not None:
            _CACHE.move_to_end(source)
        return item

def remember_literal(source: str, value: object = _MISSING, *, kind: str | None = None) -> None:
    """Called only after AST literal validation; never infer this from cell kind."""
    _remember(source, Analysis((), frozenset(), True, kind or (None if value is _MISSING else type(value).__name__)))

def literal_type(source: str) -> str | None:
    item = _cached(source)
    return item.literal_type if item is not None and item.literal else None

def known_literal(source: str) -> bool:
    item = _cached(source)
    return item is not None and item.literal

def reference_windows(source: str) -> tuple[Window, ...]:
    item = _cached(source)
    if item is not None:
        return item.windows
    tokens = [t for t in tokenize.generate_tokens(io.StringIO(source).readline)
              if t.type not in (tokenize.NL, tokenize.COMMENT)]
    windows = tuple((t, tuple(tokens[i+1:i+5])) for i, t in enumerate(tokens)
                    if t.type == tokenize.NAME and (i == 0 or tokens[i-1].string != '.'))
    return _remember(source, Analysis(windows)).windows

def bound_identifiers(source: str) -> frozenset[str]:
    reference_windows(source)
    item = _cached(source)
    if item is not None and item.bound is not None:
        return item.bound
    bound: set[str] = set()
    for node in ast.walk(ast.parse(source.strip())):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            bound.add(node.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update(alias.asname or alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
    result = frozenset(bound)
    if item is not None:
        item.bound = result
    return result
