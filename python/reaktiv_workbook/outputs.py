"""Snapshot companions next to workbook files."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Optional

from .narrowing import as_dict

EXCLUDE_LINE = "*.py.snapshot.json"


def outputs_path(workbook: Path) -> Path:
    return workbook.with_name(f"{workbook.name}.snapshot.json")

def read_outputs(workbook: Path) -> Optional[dict[str, Any]]:
    """The sidecar outputs of a workbook, or None (missing or unreadable: it is only a cache)."""
    try:
        path = outputs_path(workbook)
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    outputs = as_dict(value)
    return outputs if outputs is not None and isinstance(outputs.get("cells"), list) else None


def write_outputs(workbook: Path, outputs: Optional[dict[str, Any]]) -> None:
    """Write the sidecar (None removes it) and make sure git ignores it."""
    path = outputs_path(workbook)
    if outputs is None:
        path.unlink(missing_ok=True)
        return
    _exclude(workbook.resolve().parent)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(outputs, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def _exclude(folder: Path) -> None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-path", "info/exclude"],
            cwd=folder,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return  # no git: nothing to exclude from
    if result.returncode != 0:
        return
    exclude = folder / result.stdout.strip()
    current = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
    if any(line.strip() == EXCLUDE_LINE for line in current.splitlines()):
        return
    exclude.parent.mkdir(parents=True, exist_ok=True)
    separator = "" if not current or current.endswith("\n") else "\n"
    exclude.write_text(
        f"{current}{separator}# Reaktiv Workbook: saved outputs of workbooks\n{EXCLUDE_LINE}\n", encoding="utf-8"
    )
