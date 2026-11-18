"""Actionable, bounded diagnostics for a failed static workbook save check."""
from __future__ import annotations

import __future__
import ast
import re
from typing import Any, Mapping

from .actions import action_validation_error, method_node
from .sheets import qualify
from .narrowing import as_mapping, as_sequence


def verification_error(prefix: str, error: Exception, generated: str | None, expected: Mapping[str, Any]) -> str:
    # Report action editor lines rather than blaming the last grid cell or shared
    # code when a method cannot be parsed/compiled by the static file worker.
    for item in as_sequence(expected.get("actions")) or ():
        candidate = as_mapping(item)
        if candidate is None or not isinstance(raw := candidate.get("source"), str):
            continue
        name = str(candidate.get("name", "(new action)"))
        try:
            method_node(raw)
            compile(raw, f"<action {name}>", "exec", flags=__future__.annotations.compiler_flag)
        except (SyntaxError, ValueError, TypeError) as problem:
            return f"{prefix}: {action_validation_error(name, raw, problem)}"
    syntax: SyntaxError | None = None
    cause: BaseException | None = error
    while cause is not None:
        if isinstance(cause, SyntaxError) and cause.lineno is not None:
            syntax = cause
        cause = cause.__cause__
    cells = [cell for item in as_sequence(expected.get("cells")) or () if (cell := as_mapping(item)) is not None]
    cell: Mapping[str, Any] | None = None
    generated_line = syntax.lineno if syntax else None
    excerpt_line = generated_line
    if syntax is not None and generated is not None:
        # Python points at the following decorator when a method has no body.
        definition = re.search(r"after (?:function|class) definition on line (\d+)", syntax.msg)
        anchor = int(definition[1]) if definition else generated_line or 1
        excerpt_line = anchor
        markers = list(re.finditer(r"(?m)^    @cell\(\s*(['\"])([^'\"]+)\1", generated))
        declarations = {match[2]: match[1] for match in re.finditer(
            r"(?m)^    ([A-Za-z_]\w*)\s*=\s*worksheet\(\s*([A-Za-z_]\w*)", generated)}
        first_sheet = next(iter(declarations.values()), '')
        classes = list(re.finditer(r"(?m)^class ([A-Za-z_]\w*)\(", generated))
        for marker in markers:
            if generated.count("\n", 0, marker.start()) + 1 > anchor:
                break
            owner = next((match[1] for match in reversed(classes) if match.start() < marker.start()), '')
            sheet = declarations.get(owner, '')
            position = qualify('' if sheet == first_sheet else sheet, marker[2])
            cell = next((item for item in cells if item.get("id") == position), None)

    local_error: SyntaxError | None = None
    local_source = ""
    field = "code"
    # A reference writer can fail before it has produced a full generated file.
    candidates = [cell] if cell is not None else cells
    for candidate in candidates:
        for key, caption in (("source", "code"), ("params", "resource parameters"), ("computation", "linked computation")):
            if key == "source" and candidate.get("kind") == "markdown":
                continue
            raw = candidate.get(key)
            if not isinstance(raw, str):
                continue
            try:
                ast.parse(raw.strip() or "None")
            except SyntaxError as problem:
                cell, local_source, local_error, field = candidate, raw.strip(), problem, caption
                break
        if local_error is not None:
            break

    message = local_error.msg if local_error is not None else syntax.msg if syntax is not None else str(error)
    label = f"Cell {cell['id']}" if cell is not None else "Workbook"
    if cell is not None and cell.get("name"):
        label += f" ({cell['name']})"
    details = [f"{prefix}: {label}: {message}"]
    if local_error is not None:
        line = local_error.lineno or 1
        details.append(f"In the cell editor, {field} line {line}, column {local_error.offset or 1}:")
        details.append(_excerpt(local_source, line))
        if "indented block" in message:
            details.append("Add an indented body below the def, class, if, for, or other block header. Use pass for an intentionally empty block.")
        elif "indent" in message or "tabs" in message:
            details.append("Check indentation around this line. Use consistent spaces and align the block with its surrounding code.")
        else:
            details.append("Check this line and the preceding line for missing colons, unmatched brackets, or unclosed quotes, then apply the correction and save again.")
    else:
        if generated_line is not None:
            details.append(f"Generated Python file line {generated_line}, column {syntax.offset or 1 if syntax else 1}. This location refers to the proposed file, not the workbook currently on disk.")
            if generated is not None and cell is not None:
                details.append(_excerpt(generated, excerpt_line or generated_line))
        if cell is not None:
            raw = cell.get("source")
            if isinstance(raw, str) and not ast.parse(raw.strip() or "None").body:
                details.append("This cell contains only comments. The app should save it as an empty operation; you do not need to change valid comments to make saving work. To display a heading, use a Markdown cell; to store text in an input, put it in Python quotes.")
            else:
                details.append("The cell code parses successfully, but the app could not generate a matching workbook. Open the cell to inspect it; copy these details when reporting the file-generation problem.")
        else:
            details.append("The app could not generate or validate the workbook. Check shared code and workbook settings; copy these details when reporting the problem.")
    return "\n".join(details)


def _excerpt(source: str, line: int) -> str:
    lines = source.splitlines()
    start = max(0, line - 3)
    end = min(len(lines), line + 2)
    return "\n".join(f"{'>' if index + 1 == line else ' '} {index + 1}: {lines[index][:240]}" for index in range(start, end))
