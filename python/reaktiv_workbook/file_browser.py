"""Directory listings for the browser's file/folder picker (CLI sessions only).

The CLI runs the workbook on the user's own machine, so path widgets pick paths from
this machine. Lists names and kinds only: never reads, writes or follows file contents.
A session shared on the network (``--allow-remote``) confines paths to the workbook's
folder (``root``), so a link does not reveal the rest of the machine.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

# Large folders stay usable; the picker shows that the listing was cut short.
MAX_ENTRIES = 2000


def resolve_within(value: str, default: Path, root: Path | None) -> Path:
    """``value`` as an absolute path (relative to ``default``); inside ``root`` when given.
    Symbolic links and ``..`` are resolved first, so neither can leave ``root``."""
    path = Path(value).expanduser() if value else default
    if not path.is_absolute():
        path = default / path
    path = path.resolve()
    if root is not None and not path.is_relative_to(root.resolve()):
        # PermissionError: a refusal by policy (HTTP 403), which the app does not retry.
        raise PermissionError("Only paths inside the workbook's folder can be used in a shared session")
    return path


def list_directory(payload: Mapping[str, Any], default: Path, root: Path | None = None) -> dict[str, Any]:
    """List ``payload['path']`` (default: ``default``) for the picker.

    A file path lists its folder, so a picker opens next to the current value. Hidden
    entries (dot files) are omitted unless ``payload['hidden']`` is true. With ``root``,
    only that folder and its subfolders can be listed.
    """
    requested = payload.get("path")
    if requested is not None and not isinstance(requested, str):
        raise TypeError("path must be a string")
    show_hidden = payload.get("hidden") is True
    folder = resolve_within(requested or '', default, root)
    if folder.is_file():
        folder = folder.parent
    if not folder.is_dir():
        raise ValueError(f"Not a folder: {folder}")
    entries: list[dict[str, str]] = []
    truncated = False
    try:
        children = sorted(folder.iterdir(), key=lambda child: child.name.lower())
    except PermissionError as error:
        raise ValueError(f"Cannot list {folder}: permission denied") from error
    for child in children:
        if not show_hidden and child.name.startswith("."):
            continue
        try:
            kind = "folder" if child.is_dir() else "file"
        except OSError:
            continue  # broken link or inaccessible entry
        if len(entries) >= MAX_ENTRIES:
            truncated = True
            break
        entries.append({"name": child.name, "kind": kind, "path": str(child)})
    entries.sort(key=lambda entry: entry["kind"] != "folder")  # folders first, stable by name
    parent = folder.parent
    top = folder == parent or (root is not None and folder == root.resolve())
    return {
        "path": str(folder),
        "parent": None if top else str(parent),
        "home": str(root.resolve() if root is not None else Path.home()),
        "entries": entries,
        "truncated": truncated,
    }
