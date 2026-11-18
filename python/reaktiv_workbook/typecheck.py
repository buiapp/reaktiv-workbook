"""Type checking of workbooks.

A workbook file composes typed ``Worksheet`` classes on a ``Workbook``; ``cell()`` keeps
each worksheet member's type (``self.revenue()`` is an ``int`` for ``field(125000)``), so a checker that
reads the whole file follows types from cell to cell. This module writes the workbook as a
file, runs pyright on it with the packages of the Python that runs the workbook, and maps every
diagnostic back to its cell — with ``self.revenue()`` written as ``revenue`` again.

pyright is found as ``REAKTIV_PYRIGHT`` (a command), as an installed ``pyright`` package, or
through uv (``REAKTIV_UV`` or ``uv`` on PATH) at a pinned version, so results do not change between machines.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Optional, Sequence

from .analysis_document import analysis_document
from .model import SheetDocument
from .narrowing import as_list, as_mapping

PYRIGHT_VERSION = "1.1.414"
MODES = ("standard", "strict")
TIMEOUT_SECONDS = 120
WORKBOOK_FILE = "workbook.py"
# The generated file defines no annotations of its own for these (the app's cell code may still
# be strict about its own names).
_QUIET_RULES = {"reportMissingModuleSource"}


@dataclass(frozen=True)
class _Member:
    """Where a cell is in the generated file."""

    cell_id: str
    first: int  # first line of the member (decorators included)
    last: int
    body: int  # first line of the cell's code
    lines: int  # lines of the cell's source
    section: str = "source"


def pyright_command() -> Optional[list[str]]:
    """How to run pyright here, or None when it cannot be found."""
    explicit = os.environ.get("REAKTIV_PYRIGHT")
    if explicit:
        return explicit.split()
    if importlib.util.find_spec("pyright") is not None:
        return [sys.executable, "-m", "pyright"]
    uv = os.environ.get("REAKTIV_UV") or shutil.which("uv")
    if uv:
        return [uv, "tool", "run", "--quiet", "--from", f"pyright[nodejs]=={PYRIGHT_VERSION}", "pyright"]
    found = shutil.which("pyright")
    return [found] if found else None


def check_document(document: SheetDocument, mode: str = "standard") -> dict[str, Any]:
    """``{"available": bool, "reason"?: str, "diagnostics": [...]}``. Each diagnostic has
    ``cellId`` (None for shared code and imports), ``line`` (within the cell), ``severity``
    (error, warning), ``rule``, and ``message``."""
    if mode not in MODES:
        raise ValueError(f"Type checking mode must be one of {', '.join(MODES)}")
    command = pyright_command()
    if command is None:
        return {
            "available": False,
            "reason": "pyright was not found: install uv (or pyright) to check types.",
            "diagnostics": [],
        }
    source = replace(analysis_document(document), snapshot=None).dumps()
    members, labels = _members(source, document)
    with tempfile.TemporaryDirectory(prefix="reaktiv-types-") as folder:
        root = Path(folder)
        (root / WORKBOOK_FILE).write_text(source, encoding="utf-8")
        (root / "pyrightconfig.json").write_text(json.dumps(_config(mode)), encoding="utf-8")
        try:
            result = subprocess.run(
                [*command, "--outputjson", "--pythonpath", sys.executable, "--project", str(root)],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            return {"available": False, "reason": f"pyright did not run: {error}", "diagnostics": []}
    try:
        report = as_mapping(json.loads(result.stdout)) or {}
    except ValueError:
        reason = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
        return {"available": False, "reason": f"pyright failed: {reason[0]}", "diagnostics": []}
    diagnostics = [
        diagnostic
        for item in as_list(report.get("generalDiagnostics")) or []
        if (diagnostic := _diagnostic(item, members, labels)) is not None
    ]
    return {"available": True, "diagnostics": diagnostics}


def _config(mode: str) -> dict[str, Any]:
    # The workbook's own Python sees these too: the app's sources on PYTHONPATH (local kernel),
    # and the packages installed with it.
    paths = [path for path in sys.path if path and os.path.isdir(path)]
    return {
        "include": [WORKBOOK_FILE],
        "typeCheckingMode": mode,
        "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}",
        "extraPaths": paths,
        **{rule: False for rule in _QUIET_RULES},
    }


def _members(source: str, document: SheetDocument) -> tuple[list[_Member], dict[str, str]]:
    """Each cell's lines in the generated file, and how to name a member in messages."""
    sources = {cell.id: cell.source for cell in document.cells}
    parameters = {cell.id: cell.params for cell in document.cells if cell.params is not None}
    computations = {cell.id: cell.computation for cell in document.cells if cell.computation is not None}
    names = {cell.id: cell.name for cell in document.cells}
    module = ast.parse(source)
    members: list[_Member] = []
    all_members: dict[str, str] = {}
    worksheets = {node.value.args[0].id: node.targets[0].id for owner in module.body if isinstance(owner, ast.ClassDef) for node in owner.body if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'worksheet' and node.value.args and isinstance(node.value.args[0], ast.Name)}
    for statement in module.body:
        if not isinstance(statement, ast.ClassDef):
            continue
        member_cells: dict[str, str] = {}
        sheet = worksheets.get(statement.name)
        def resolved_position(item: ast.stmt) -> str | None:
            coordinate = _position(item)
            return (f'{sheet}!{coordinate}' if sheet and sheet != document.sheet_name else coordinate) if coordinate else None
        for item in statement.body:
            position = resolved_position(item)
            if isinstance(item, ast.Assign) and position is not None and isinstance(item.targets[0], ast.Name):
                member_cells[item.targets[0].id] = position
            elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and position is not None:
                member_cells[item.name] = position
        computation_members: dict[str, str] = {}
        for item in statement.body:
            if isinstance(item, ast.FunctionDef) and (position := resolved_position(item)) is not None:
                for marker in item.decorator_list:
                    if isinstance(marker, ast.Call) and isinstance(marker.func, ast.Name) and marker.func.id == "linked":
                        for keyword in marker.keywords:
                            if keyword.arg == "computation" and isinstance(keyword.value, ast.Name):
                                computation_members[keyword.value.id] = position
        for item in statement.body:
            cell_id = resolved_position(item)
            if cell_id is None and isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                cell_id = computation_members.get(item.name) or member_cells.get(_loader_of(item) or "")  # a resource's loader
            if cell_id is None or cell_id not in sources:
                continue
            first = min([item.lineno, *(decorator.lineno for decorator in getattr(item, "decorator_list", []))])
            body = item.lineno + 1 if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) else item.lineno
            section = "source"
            text = sources[cell_id]
            if isinstance(item, ast.FunctionDef) and item.name in computation_members:
                section = "computation"
                text = computations[cell_id] or ""
            if isinstance(item, ast.FunctionDef) and resolved_position(item) is not None and cell_id in parameters:
                section = "parameters"
                text = parameters[cell_id] or ""
            elif isinstance(item, ast.AsyncFunctionDef) and _loader_of(item) is not None:
                user_body = list(item.body)
                while user_body and isinstance(user_body[0], ast.Assign) and any(isinstance(target, ast.Name) and target.id in {"params", "cancellation"} for target in user_body[0].targets):
                    statement = user_body.pop(0)
                    body = (statement.end_lineno or statement.lineno) + 1
            members.append(_Member(cell_id, first, item.end_lineno or item.lineno, body, max(1, len(text.splitlines())), section))
        all_members.update({f'{sheet}.{member}' if sheet else member: cell_id for member, cell_id in member_cells.items()})
    labels = {member: names.get(cell_id) or cell_id for member, cell_id in all_members.items()}
    return members, labels


def _position(item: ast.stmt) -> Optional[str]:
    """The position of a cell member: ``x = cell("A1", ...)`` or ``@cell("A1", ...)``."""
    calls: list[ast.expr] = []
    if isinstance(item, ast.Assign):
        calls.append(item.value)
    elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
        calls.extend(item.decorator_list)
    for call in calls:
        if (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "cell"
            and call.args
            and isinstance(call.args[0], ast.Constant)
            and isinstance(call.args[0].value, str)
        ):
            return call.args[0].value
    return None


def _loader_of(item: ast.FunctionDef | ast.AsyncFunctionDef) -> Optional[str]:
    for decorator in item.decorator_list:
        if isinstance(decorator, ast.Attribute) and decorator.attr == "loader" and isinstance(decorator.value, ast.Name):
            return decorator.value.id
    return None


_SELF_READ = re.compile(r"self\.([A-Za-z_][A-Za-z0-9_]*)(?:\.value)?\(\)")


def _diagnostic(item: object, members: Sequence[_Member], labels: dict[str, str]) -> Optional[dict[str, Any]]:
    entry = as_mapping(item)
    if entry is None or entry.get("severity") not in ("error", "warning"):
        return None
    rule = entry.get("rule")
    if rule in _QUIET_RULES:
        return None
    start = as_mapping(as_mapping((as_mapping(entry.get("range")) or {}).get("start")) or {}) or {}
    line = int(start.get("line", 0)) + 1  # pyright counts from 0
    member = next((member for member in members if member.first <= line <= member.last), None)
    text = _SELF_READ.sub(lambda match: labels.get(match.group(1), match.group(1)), str(entry.get("message", "")))
    # pyright puts the reason first and indented details (with no-break spaces) after it.
    message, _, detail = text.partition("\n")
    return {
        "cellId": member.cell_id if member is not None else None,
        **({"section": member.section} if member is not None and member.section != "source" else {}),
        "line": min(max(1, line - member.body + 1), member.lines) if member is not None else None,
        "severity": entry["severity"],
        "rule": rule if isinstance(rule, str) else "",
        "message": message,
        "detail": "\n".join(part.replace("\u00a0", " ").strip() for part in detail.splitlines() if part.strip()),
    }
