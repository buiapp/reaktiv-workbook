"""Serializable explicit model methods, without executing workbook source when opening it."""

from __future__ import annotations
import ast
from dataclasses import dataclass, field, replace
import json
import keyword
import textwrap
from typing import Any, Mapping
from .narrowing import as_mapping


def method_node(source: str) -> ast.FunctionDef | ast.AsyncFunctionDef:
    module = ast.parse(source)
    if len(module.body) != 1 or not isinstance(
        module.body[0], (ast.FunctionDef, ast.AsyncFunctionDef)
    ):
        raise ValueError("An action must contain one def or async def method")
    node = module.body[0]
    if node.decorator_list:
        raise ValueError(
            "Action source excludes decorators; @action is added when saving"
        )
    if (
        not node.args.args
        or node.args.args[0].arg != "self"
        or node.args.posonlyargs
        or node.args.vararg
        or node.args.kwarg
    ):
        raise ValueError(
            "Actions require self followed by named or keyword-only parameters; *args/**kwargs are not supported"
        )
    for default in [
        *node.args.defaults,
        *(value for value in node.args.kw_defaults if value is not None),
    ]:
        try:
            ast.literal_eval(default)  # Never execute defaults during inspection.
        except (ValueError, TypeError) as error:
            expression = (ast.get_source_segment(source, default) or "expression")[:160]
            raise ValueError(
                f"Parameter defaults on line {default.lineno} must be literal Python values, not {expression}. "
                "Use a saved cell binding for a live workbook value."
            ) from error
    return node


def action_validation_error(name: str, source: str, error: Exception) -> str:
    """Keep the action/editor location and a bounded excerpt across transports."""
    if isinstance(error, SyntaxError):
        line = error.lineno or 1
        lines = source.splitlines()
        excerpt = lines[line - 1][:240] if 0 < line <= len(lines) else (error.text or "").strip()[:240]
        return (f"Action {name}, line {line}, column {error.offset or 1}: {error.msg}\n"
                f"> {line}: {excerpt}\nFix this method in Actions, then Apply or Save again.")
    return f"Action {name}: {error}\nFix this method in Actions, then Apply or Save again."


def parameters(source: str) -> list[dict[str, Any]]:
    node = method_node(source)
    args = node.args.args[1:]
    defaults = [None] * (len(args) - len(node.args.defaults)) + list(node.args.defaults)
    result: list[dict[str, Any]] = []
    for parameter, default in [
        *zip(args, defaults),
        *zip(node.args.kwonlyargs, node.args.kw_defaults),
    ]:
        item: dict[str, Any] = {
            "name": parameter.arg,
            "annotation": ast.get_source_segment(source, parameter.annotation)
            if parameter.annotation
            else "",
            "required": default is None,
        }
        if default is not None:
            value = ast.literal_eval(default)
            try:
                item["default"] = json.loads(json.dumps(value, allow_nan=False))
            except (TypeError, ValueError):
                item["default"] = repr(value)
        result.append(item)
    return result


def validate_action_bindings(value: Any) -> dict[str, Any]:
    """Argument choices are data; resolving a cell or default happens on invocation."""
    bindings = as_mapping(value)
    if bindings is None:
        raise ValueError("Action arguments must be an object")
    for name, raw in bindings.items():
        if not name.isidentifier() or keyword.iskeyword(name):
            raise ValueError("Action arguments must name Python parameters")
        binding = as_mapping(raw)
        if binding is None or set(binding) not in ({"cell"}, {"value"}, {"default"}):
            raise ValueError("An action argument must contain cell, value, or default")
        if "cell" in binding and (
            not isinstance(binding["cell"], str) or not binding["cell"]
        ):
            raise ValueError("An action cell binding must name a cell id")
        if "default" in binding and binding["default"] is not True:
            raise ValueError("An action default binding must be True")
    return dict(bindings)


@dataclass(frozen=True)
class ActionDefinition:
    name: str
    source: str
    label: str = ""
    references: dict[str, str] = field(default_factory=dict[str, str])
    bindings: dict[str, Any] = field(default_factory=dict[str, Any])
    exposed: bool = True

    def __post_init__(self) -> None:
        if (
            not self.name.isidentifier()
            or keyword.iskeyword(self.name)
            or self.exposed
            and self.name.startswith("_")
        ):
            raise ValueError("Action names must be public Python identifiers")
        node = method_node(self.source)
        if node.name != self.name:
            raise ValueError("Action name must match its def name")
        names = {item["name"] for item in parameters(self.source)}
        if not set(self.bindings) <= names:
            raise ValueError("Action bindings must refer to existing parameters")
        validate_action_bindings(self.bindings)
        used = action_cell_members(self.source)
        object.__setattr__(self, "references", {key: target for key, target in self.references.items() if key in used})

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "source": self.source,
            "label": self.label,
            "references": dict(self.references),
            "bindings": dict(self.bindings),
            "exposed": self.exposed,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ActionDefinition:
        refs, bindings = (
            as_mapping(value.get("references", {})),
            as_mapping(value.get("bindings", {})),
        )
        if (
            refs is None
            or bindings is None
            or not all(isinstance(v, str) for v in refs.values())
        ):
            raise ValueError("Invalid action references or bindings")
        return cls(
            str(value.get("name", "")),
            str(value.get("source", "")),
            str(value.get("label", "")),
            {key: str(v) for key, v in refs.items()},
            dict(bindings),
            value.get("exposed", True) is not False,
        )


def parse_actions(
    source: str,
    members: list[ast.stmt],
    positions: Mapping[str, str],
    bindings: Mapping[str, Any],
) -> tuple[ActionDefinition, ...]:
    linked_helpers = {
        keyword.value.id for node in members if isinstance(node, ast.FunctionDef)
        for marker in node.decorator_list if isinstance(marker, ast.Call) and isinstance(marker.func, ast.Name) and marker.func.id == "linked"
        for keyword in marker.keywords if keyword.arg == "computation" and isinstance(keyword.value, ast.Name)
    }
    result: list[ActionDefinition] = []
    for node in members:
        if isinstance(node, ast.FunctionDef) and node.name in linked_helpers:
            continue
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        marker = next(
            (
                item
                for item in node.decorator_list
                if isinstance(item, ast.Name)
                and item.id == "action"
                or isinstance(item, ast.Call)
                and isinstance(item.func, ast.Name)
                and item.func.id == "action"
            ),
            None,
        )
        if marker is None and (node.decorator_list or node.name.startswith("__")):
            continue
        if marker is not None and len(node.decorator_list) != 1:
            raise ValueError(
                "@action cannot be combined with cell/computed/effect decorators"
            )
        lines = source.splitlines()
        end = node.end_lineno or node.lineno
        while end < len(lines) and (
            not lines[end].strip()
            or lines[end].startswith(" " * (node.col_offset + 1))
            and lines[end].lstrip().startswith("#")
        ):
            end += 1
        body = textwrap.dedent("\n".join(lines[node.lineno - 1 : end])).rstrip()
        label = ""
        if isinstance(marker, ast.Call):
            if marker.args or any(item.arg != "label" for item in marker.keywords):
                raise ValueError("@action supports the label keyword")
            label = str(
                next(
                    (
                        ast.literal_eval(item.value)
                        for item in marker.keywords
                        if item.arg == "label"
                    ),
                    "",
                )
            )
        used = action_cell_members(body)
        refs = {member: positions[member] for member in positions if member in used}
        result.append(
            ActionDefinition(
                node.name,
                body,
                label,
                refs,
                dict(as_mapping(bindings.get(node.name, {})) or {}),
                marker is not None,
            )
        )
    return tuple(result)


def action_owner_attributes(source: str, *, decorated: bool = False) -> list[ast.Attribute]:
    """Attributes of the action owner; a nested self parameter is another object."""
    root = ast.parse(source).body[0] if decorated else method_node(source)
    if not isinstance(root, (ast.FunctionDef, ast.AsyncFunctionDef)):
        raise ValueError("An action must be a method")
    attributes: list[ast.Attribute] = []

    def visit(node: ast.AST) -> None:
        if node is not root and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            args = node.args
            parameters = [*args.posonlyargs, *args.args, *args.kwonlyargs]
            if args.vararg is not None:
                parameters.append(args.vararg)
            if args.kwarg is not None:
                parameters.append(args.kwarg)
            if any(arg.arg == "self" for arg in parameters):
                # Defaults execute in the enclosing scope, even when the body shadows self.
                for default in [*args.defaults, *(value for value in args.kw_defaults if value is not None)]:
                    visit(default)
                return
        if isinstance(node, ast.Attribute):
            attributes.append(node)
        for child in ast.iter_child_nodes(node):
            visit(child)

    visit(root)
    return attributes


def action_cell_members(source: str) -> set[str]:
    """Actual self.member accesses, excluding comments and literal strings."""
    from .workbook_format import attribute_path
    return {path.removeprefix('self.') for item in action_owner_attributes(source)
            if (path := attribute_path(item)) is not None and path.startswith('self.')}



def resolve_action_references(definition: ActionDefinition, members: Mapping[str, str]) -> ActionDefinition:
    # Explicit bindings survive moves/renames; infer only new members actually used.
    by_name = {name: cell_id for cell_id, name in members.items()}
    references = {name: definition.references.get(name, by_name[name])
                  for name in action_cell_members(definition.source) if name in by_name}
    references.update(definition.references)
    return replace(definition, references=references)


def rewrite_members(definition: ActionDefinition, members: Mapping[str, str]) -> str:
    from .workbook_format import attribute_path, edit_nodes
    edits: list[tuple[ast.AST, str]] = []
    for item in action_owner_attributes(definition.source):
        path = attribute_path(item)
        if not isinstance(item, ast.Attribute) or path is None or not path.startswith('self.'):
            continue
        key = path.removeprefix('self.')
        if key not in definition.references:
            continue
        target = members.get(definition.references[key])
        if target is None:
            raise ValueError(f"Action {definition.name} references a missing cell: {key}")
        edits.append((item, 'self.' + target))
    return edit_nodes(definition.source, edits)


def rewrite_action_handles(definition: ActionDefinition, targets: Mapping[str, str]) -> str:
    """Rewrite explicit self.cells handles using AST spans; preserve source and strings."""
    source = definition.source
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    edits: list[tuple[int, int, str]] = []
    for node in action_owner_attributes(source):
        if not isinstance(node, ast.Attribute):
            continue
        names: list[str] = []
        part: ast.expr = node
        while isinstance(part, ast.Attribute):
            names.insert(0, part.attr)
            part = part.value
        if not isinstance(part, ast.Name) or part.id != "self" or not names or names[0] != "cells":
            continue
        key = ".".join(names[1:])
        replacement = targets.get(key)
        if replacement is None:
            continue
        assert node.end_lineno is not None and node.end_col_offset is not None
        start = offsets[node.lineno - 1] + len(lines[node.lineno - 1].encode()[:node.col_offset].decode())
        end = offsets[node.end_lineno - 1] + len(lines[node.end_lineno - 1].encode()[:node.end_col_offset].decode())
        edits.append((start, end, "self.cells." + replacement))
    # Qualified handles include a shorter prefix attribute; retain the longest match.
    accepted: list[tuple[int, int, str]] = []
    for edit in sorted(edits, key=lambda value: (value[0], -value[1])):
        if not accepted or edit[0] >= accepted[-1][1]:
            accepted.append(edit)
    for start, end, replacement in reversed(accepted):
        source = source[:start] + replacement + source[end:]
    return source
