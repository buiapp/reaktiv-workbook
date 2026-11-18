"""Tracked workbook variables and shared-code namespace initialization."""
from __future__ import annotations

import builtins
import re
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

from reaktiv import Signal

from .cell_compiler import register_source
from .execution_errors import SHARED_CODE_FILE, error_message

CELL_BUILTINS = builtins.__dict__


class ReactiveEnvironment(Mapping[str, str]):
    """Read-only workbook variables that track access inside reactive consumers."""

    def __init__(
        self,
        values: Callable[[], Mapping[str, str]],
        revision: Signal[int],
    ) -> None:
        self._values = values
        self._revision = revision

    def __getitem__(self, key: str) -> str:
        self._revision()
        return self._values()[key]

    def __iter__(self) -> Iterator[str]:
        self._revision()
        return iter(dict(self._values()))

    def __len__(self) -> int:
        self._revision()
        return len(self._values())


def normalize_variables(variables: Mapping[Any, Any]) -> dict[str, str]:
    """Checked here: variables come from JSON and files, whatever their declared type."""
    normalized: dict[str, str] = {}
    for key, value in variables.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid environment variable name: {key!r}")
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            raise ValueError(
                f"Environment variable {key!r} must be a single-line string"
            )
        normalized[key] = value
    return normalized


def execute_imports(
    imports: Iterable[str], code: str = "", base: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Run global imports, then the shared code, into one namespace for every cell.

    Functions defined in shared code keep this namespace as their globals, so it also
    holds what cells see by default (np, math, env, …)."""
    namespace: dict[str, Any] = {**(base or {}), "__builtins__": CELL_BUILTINS}
    for statement in imports:
        exec(compile(statement, "<workbook-import>", "exec"), namespace, namespace)
    if code:
        try:
            register_source(SHARED_CODE_FILE, code)
            exec(compile(code, SHARED_CODE_FILE, "exec"), namespace, namespace)
        except Exception as error:
            line = _shared_code_line(error)
            where = f" (line {line})" if line else ""
            raise RuntimeError(f"Shared code{where}: {error_message(error)}") from error
    return {key: value for key, value in namespace.items() if key != "__builtins__"}


def _shared_code_line(error: BaseException) -> int | None:
    if isinstance(error, SyntaxError):
        return error.lineno
    frame = error.__traceback__
    line = None
    while frame is not None:
        if frame.tb_frame.f_code.co_filename == SHARED_CODE_FILE:
            line = frame.tb_lineno
        frame = frame.tb_next
    return line
