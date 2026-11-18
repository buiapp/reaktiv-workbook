"""Static workbook file operations; no workbook imports, execution, or kernel state.

The browser ships these modules as a small ``reaktiv_workbook_files`` package so
importing this boundary never imports reaktiv_workbook's runtime-facing __init__.
"""
from __future__ import annotations

import __future__
import ast
import json
from dataclasses import replace
from typing import Any, Mapping

from .model import SheetDocument
from .save_diagnostics import verification_error


def python_source_format(source: str) -> int:
    """Identify managed source syntax statically; JSON schema versions are unrelated."""
    from .workbook_format import is_structured
    return 2 if is_structured(ast.parse(source)) else 1


def inspect_document(source: str) -> dict[str, Any]:
    """Return editor data plus opening provenance; never execute user code."""
    return {**SheetDocument.loads(source).to_dict(), "sourceFormatVersion": python_source_format(source)}


def serialize_document(document: Mapping[str, Any]) -> dict[str, Any]:
    """Generate with the sole Python writer and validate before any file is written."""
    source: str | None = None
    try:
        parsed = replace(SheetDocument.from_dict(document), snapshot=None)
        # AST parsing alone accepts e.g. await in a synchronous method. Compile
        # definitions without executing bodies, defaults, imports or device code.
        for action in parsed.actions:
            compile(action.source, f"<action {action.name}>", "exec", flags=__future__.annotations.compiler_flag)
        source = parsed.dumps()
    except Exception as error:
        return {
            "source": "",
            "problems": [verification_error("The workbook could not be generated", error, source, document)],
        }
    # This source was just generated from the expected document by the sole
    # deterministic writer. verify_written_document would generate the identical
    # file again and parse both copies. Validate this generated file once instead;
    # the general verifier remains for independently supplied/generated files.
    try:
        SheetDocument.loads(source)
    except Exception as error:
        return {"source": source, "problems": [
            verification_error("The file would not load", error, source, document)
        ]}
    return {"source": source, "problems": []}


def serialize_document_json(serialized_document: str) -> str:
    return json.dumps(serialize_document(json.loads(serialized_document)), allow_nan=False)
