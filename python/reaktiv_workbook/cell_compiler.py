"""Compile cell and note source without reading or executing the live graph.

ReferenceScope owns name resolution; this module owns the resulting Python AST.
Compiled code keeps its original cell filename and linecache source for debugging.
"""
from __future__ import annotations

import ast
import linecache
import re
from collections.abc import Iterable, Mapping
from types import CodeType
from typing import Any

from .model import CellDefinition
from .sheets import ReferenceScope, as_scope
from .source_analysis import known_literal, remember_literal

MARKDOWN_INTERPOLATION = re.compile(r"\{\{(.*?)\}\}", re.DOTALL)


def cell_filename(cell_id: str) -> str:
    return f"<cell {cell_id}>"


def register_source(filename: str, source: str) -> None:
    lines = [line + "\n" for line in source.splitlines()]
    linecache.cache[filename] = (len(source), None, lines, filename)


class CellReferenceTransformer(ast.NodeTransformer):
    def __init__(
        self,
        aliases: Mapping[str, str] | ReferenceScope | None = None,
        bound_names: Iterable[str] = (),
    ) -> None:
        self.dependencies: set[str] = set()
        # A ReferenceScope adds the cell's own sheet (for bare coordinates) and the
        # sheet names (for `Sheet.A1`); a plain mapping is labels only.
        self.scope = as_scope(aliases)
        self.aliases = self.scope.aliases
        self.bound_names = frozenset(bound_names)

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        root: ast.expr = node
        while isinstance(root, ast.Attribute):
            root = root.value
        if isinstance(root, ast.Name) and root.id == 'cells' and 'cells' not in self.bound_names:
            return node  # Explicit handles are objects, not shorthand value reads.
        # `Budget.A1`: a cell on another sheet.
        if (
            isinstance(node.ctx, ast.Load)
            and isinstance(node.value, ast.Name)
            and node.value.id not in self.bound_names
        ):
            target = self.scope.qualified(node.value.id, node.attr)
            if target is not None:
                self.dependencies.add(target)
                return ast.copy_location(
                    ast.Call(
                        func=ast.Name(id="__read", ctx=ast.Load()),
                        args=[ast.Constant(target)],
                        keywords=[],
                    ),
                    node,
                )
        return self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> ast.AST:
        if node.id in self.bound_names:
            return node
        dependency = self.scope.coordinate(node.id) or self.scope.label(node.id)
        if isinstance(node.ctx, ast.Load) and dependency is not None:
            self.dependencies.add(dependency)
            return ast.copy_location(
                ast.Call(
                    func=ast.Name(id="__read", ctx=ast.Load()),
                    args=[ast.Constant(dependency)],
                    keywords=[],
                ),
                node,
            )
        return node


    def _handle_target(self, node: ast.expr) -> str | None:
        parts: list[str] = []
        while isinstance(node, ast.Attribute):
            parts.insert(0, node.attr)
            node = node.value
        if not isinstance(node, ast.Name) or node.id != 'cells' or 'cells' in self.bound_names:
            return None
        if len(parts) == 1:
            return self.scope.coordinate(parts[0]) or self.scope.label(parts[0])
        if len(parts) == 2:
            return self.scope.qualified(parts[0], parts[1])
        return None

    def visit_Call(self, node: ast.Call) -> ast.AST:
        target = self._handle_target(node.func.value) if isinstance(node.func, ast.Attribute) and node.func.attr == 'get' else self._handle_target(node.func)
        if target is not None:
            self.dependencies.add(target)
        # `bind(widget, x=vector_x)`: the keyword passes the input cell itself (id and
        # value), so the view's changes can be written back to it (widgets.bind).
        node = self.generic_visit(node)  # type: ignore[assignment]
        if isinstance(node.func, ast.Name) and node.func.id == "bind" and "bind" not in self.bound_names:
            for keyword in node.keywords:
                value = keyword.value
                if (
                    keyword.arg is not None
                    and isinstance(value, ast.Call)
                    and isinstance(value.func, ast.Name)
                    and value.func.id == "__read"
                ):
                    keyword.value = ast.copy_location(
                        ast.Call(func=ast.Name(id="__binding", ctx=ast.Load()), args=[value.args[0], value], keywords=[]),
                        value,
                    )
        return node


def compile_cell(
    source: str,
    mode: str,
    aliases: Mapping[str, str] | ReferenceScope | None = None,
    filename: str | None = None,
    *, bound_names: Iterable[str] = (),
) -> tuple[CodeType, list[str]]:
    """Compile cell code. With ``filename`` (see ``cell_filename``) the source is
    registered for tracebacks; without it the code is only analysed (dependencies)."""
    filename = _source_file(source, filename)
    parsed = ast.parse(source.strip(), filename=filename, mode=mode)
    if isinstance(parsed, ast.Expression):
        try:
            literal_value = ast.literal_eval(parsed)
        except (ValueError, TypeError):
            pass
        else:
            remember_literal(source, literal_value)
            del literal_value
            return compile(parsed, filename, mode), []
    transformer = CellReferenceTransformer(aliases, _bound_names(parsed) | set(bound_names))
    transformed = transformer.visit(parsed)
    ast.fix_missing_locations(transformed)
    return compile(transformed, filename, mode), sorted(transformer.dependencies)


def _source_file(source: str, filename: str | None) -> str:
    if filename is None:
        return f"<cell:{source[:16]}>"
    register_source(filename, source.strip())
    return filename


DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def compile_formula(
    source: str,
    aliases: Mapping[str, str] | ReferenceScope | None = None,
    filename: str | None = None,
    *, bound_names: Iterable[str] = (),
) -> tuple[CodeType, list[str], bool]:
    """A one-expression formula is evaluated; any other runs as the body of a function,
    so ``return`` works anywhere and the last expression is the value (a final
    ``def``/``class`` makes a function cell). The result lands in ``FORMULA_RESULT``."""
    try:
        code, dependencies = compile_cell(source, "eval", aliases, filename, bound_names=bound_names)
        return code, dependencies, True
    except SyntaxError:
        filename = _source_file(source, filename)
        parsed = ast.parse(source.strip(), filename=filename, mode="exec")
        function = _cell_function(FORMULA_FUNCTION, _returning_body(parsed.body, definitions=True))
        call = ast.copy_location(
            ast.Assign(
                targets=[ast.Name(id=FORMULA_RESULT, ctx=ast.Store())],
                value=ast.Call(func=ast.Name(id=FORMULA_FUNCTION, ctx=ast.Load()), args=[], keywords=[]),
            ),
            function,
        )
        module = ast.Module(body=[function, call], type_ignores=[])
        transformer = CellReferenceTransformer(aliases, _bound_names(module) | set(bound_names))
        transformed = transformer.visit(module)
        ast.fix_missing_locations(transformed)
        code = compile(transformed, filename, "exec")
        return code, sorted(transformer.dependencies), False


def compile_effect(
    source: str,
    aliases: Mapping[str, str] | ReferenceScope | None = None,
    filename: str | None = None,
) -> tuple[CodeType, list[str]]:
    """An effect runs as module code; one that uses ``return`` (to stop early) runs as the
    body of a function instead."""
    filename = _source_file(source, filename)
    parsed = ast.parse(source.strip(), filename=filename, mode="exec")
    module: ast.Module = parsed
    if _has_return(parsed.body):
        function = _cell_function(EFFECT_FUNCTION, parsed.body)
        call = ast.copy_location(
            ast.Expr(value=ast.Call(func=ast.Name(id=EFFECT_FUNCTION, ctx=ast.Load()), args=[], keywords=[])),
            function,
        )
        module = ast.Module(body=[function, call], type_ignores=[])
    transformer = CellReferenceTransformer(aliases, _bound_names(module))
    transformed = transformer.visit(module)
    ast.fix_missing_locations(transformed)
    return compile(transformed, filename, "exec"), sorted(transformer.dependencies)


def compile_resource(
    source: str,
    aliases: Mapping[str, str] | ReferenceScope | None = None,
    filename: str | None = None,
    *, explicit: bool = False,
) -> tuple[CodeType, list[str]]:
    filename = "<resource-cell>" if filename is None else _source_file(source, filename)
    parsed = ast.parse(source.strip(), filename=filename, mode="exec")
    function = ast.AsyncFunctionDef(
        name="__resource_loader__",
        args=_no_arguments(),
        body=_returning_body(parsed.body, definitions=False) or [ast.Pass()],
        decorator_list=[],
        type_params=[],
    )
    module = ast.Module(body=[function], type_ignores=[])
    transformer = CellReferenceTransformer(aliases, _bound_names(module) | ({"params", "resource_params", "cancellation"} if explicit else set()))
    transformed = transformer.visit(module)
    ast.fix_missing_locations(transformed)
    return compile(transformed, filename, "exec"), sorted(transformer.dependencies)


FORMULA_FUNCTION = "__formula__"
FORMULA_RESULT = "__formula_result__"
EFFECT_FUNCTION = "__effect__"
CELL_FUNCTIONS = (FORMULA_FUNCTION, EFFECT_FUNCTION, "__resource_loader__")


def _no_arguments() -> ast.arguments:
    return ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[])


def _cell_function(name: str, body: list[ast.stmt]) -> ast.FunctionDef:
    function = ast.FunctionDef(
        name=name, args=_no_arguments(), body=body or [ast.Pass()], decorator_list=[], type_params=[]
    )
    return ast.copy_location(function, body[0]) if body else function


def _returning_body(body: list[ast.stmt], *, definitions: bool) -> list[ast.stmt]:
    """``body`` with its last expression (and, for formulas, a final ``def``/``class``)
    returned."""
    if not body:
        return body
    final = body[-1]
    if isinstance(final, ast.Expr):
        return [*body[:-1], ast.copy_location(ast.Return(value=final.value), final)]
    if definitions and isinstance(final, DEFINITIONS):
        # A cell ending in `def`/`class` holds that function or class (a function
        # cell): other cells call it by the cell's label.
        name = ast.Name(id=final.name, ctx=ast.Load())
        return [*body, ast.copy_location(ast.Return(value=name), final)]
    return body


def _has_return(statements: list[ast.stmt]) -> bool:
    """Whether the code returns (outside functions and classes it defines)."""

    class Finder(ast.NodeVisitor):
        found = False

        def visit_Return(self, node: ast.Return) -> None:
            self.found = True

        def visit_FunctionDef(self, node: ast.AST) -> None:
            pass

        visit_AsyncFunctionDef = visit_ClassDef = visit_Lambda = visit_FunctionDef

    finder = Finder()
    for statement in statements:
        finder.visit(statement)
    return finder.found


def compile_markdown(
    source: str,
    aliases: Mapping[str, str] | ReferenceScope | None = None,
    cell_id: str | None = None,
) -> tuple[list[tuple[bool, Any, str | None]], list[str]]:
    """Split Markdown into static text and compiled ``{{ expression }}`` parts.

    Each part is ``(is_expression, text_or_code, referenced_cell_id)``; the cell
    id is set when the expression is a plain cell reference such as ``{{ C1 }}``
    so rich outputs can be linked instead of re-encoded into every note.
    """

    parts: list[tuple[bool, Any, str | None]] = []
    dependencies: set[str] = set()
    cursor = 0
    for match in MARKDOWN_INTERPOLATION.finditer(source):
        parts.append((False, source[cursor : match.start()], None))
        expression = match.group(1).strip()
        if not expression:
            raise SyntaxError("Markdown interpolation cannot be empty")
        # Each {{ expression }} is its own "file", so an error names the expression.
        code, expression_dependencies = compile_cell(
            expression,
            "eval",
            aliases,
            None if cell_id is None else f"<cell {cell_id} {{{{ {expression} }}}}>",
        )
        scope = as_scope(aliases)
        sheet_name, dot, attribute = expression.partition(".")
        reference = (
            scope.coordinate(expression)
            or scope.label(expression)
            or (scope.qualified(sheet_name, attribute) if dot else None)
        )
        parts.append((True, code, reference))
        dependencies.update(expression_dependencies)
        cursor = match.end()
    parts.append((False, source[cursor:], None))
    return parts, sorted(dependencies)


def definition_dependencies(
    definition: CellDefinition, aliases: Mapping[str, str] | ReferenceScope
) -> list[str]:
    """Resolve dependency metadata without mutating the live graph."""

    if definition.kind in ("input", "formula", "linked") and definition.computation is None and known_literal(definition.source):
        return []
    try:
        if definition.kind == "markdown":
            return compile_markdown(definition.source, aliases)[1]
        if definition.kind == "resource":
            return sorted(set(compile_resource(definition.source, aliases, explicit=definition.params is not None)[1]) | set(compile_formula(definition.params, aliases)[1] if definition.params is not None else []))
        if definition.kind == "linked" and definition.computation is not None:
            return sorted(set(compile_formula(definition.source, aliases)[1]) | set(compile_formula(definition.computation, aliases, bound_names={"source", "previous"})[1]))
        if definition.kind in ("input", "formula", "linked"):
            return compile_formula(definition.source, aliases)[1]
        if definition.kind == "effect":
            return compile_effect(definition.source, aliases)[1]
    except Exception:
        return []
    return []


def _bound_names(tree: ast.AST) -> set[str]:
    names = {node.arg for node in ast.walk(tree) if isinstance(node, ast.arg)} | {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    }
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update(
                alias.asname or alias.name.split(".")[0] for alias in node.names
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                names.update(argument.arg for argument in node.args.args)
                names.update(argument.arg for argument in node.args.kwonlyargs)
                names.update(argument.arg for argument in node.args.posonlyargs)
                if node.args.vararg is not None:
                    names.add(node.args.vararg.arg)
                if node.args.kwarg is not None:
                    names.add(node.args.kwarg.arg)
    return names
