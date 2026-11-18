"""Temporary Python console state, separate from workbook definitions."""

from __future__ import annotations

import ast
from .output_capture import capture_output
import io
import traceback
from typing import Any, Mapping, Optional, cast

LIMIT = 16000


class ConsoleOutput(io.StringIO):
    def write(self, text: str) -> int:
        remaining = max(0, LIMIT - self.tell())
        super().write(text[:remaining])
        return len(text)


class PythonConsole:
    def __init__(self) -> None:
        self._namespaces: dict[str, dict[str, Any]] = {}

    def execute(self, source: str, sheet: str, context: Mapping[str, Any]) -> dict[str, Any]:
        namespace = self._namespaces.setdefault(sheet, {})
        namespace.update(context)
        output, warnings = ConsoleOutput(), ConsoleOutput()
        display, error = "", None
        try:
            if len(source) > 100000:
                raise ValueError("Console commands are limited to 100,000 characters")
            module = ast.parse(source, filename="<console>")
            expression: Optional[ast.expr] = None
            if module.body and isinstance(module.body[-1], ast.Expr):
                expression = cast(ast.Expr, module.body.pop()).value
            with capture_output(output, warnings):
                exec(compile(module, "<console>", "exec"), namespace, namespace)
                if expression is not None:
                    value = eval(compile(ast.Expression(expression), "<console>", "eval"), namespace, namespace)
                    namespace["_"] = value
                    if value is not None:
                        display = repr(value)[:LIMIT]
        except BaseException as exception:
            # exit(), keyboard interrupts and interrupted commands are console results.
            error = "".join(traceback.format_exception(exception))[-LIMIT:]
        for name in context:
            if name != "_":
                namespace.pop(name, None)
        return {"output": output.getvalue(), "stderr": warnings.getvalue(), "display": display, "error": error}
