"""Cell failure types and bounded user-facing traceback details."""
from __future__ import annotations

import os
import re
import sys
import traceback
from typing import Any

from .cell_compiler import CELL_FUNCTIONS, cell_filename


class CellStopped(RuntimeError):
    """A cell that ran too long and was stopped: it does not run again until the app releases
    it (the cell is changed or run again)."""

    def __init__(self, message: str = "Stopped: this cell ran too long. Change it or run it again to retry.") -> None:
        super().__init__(message)


class CellInterrupted(CellStopped):
    """Raised inside a running cell by the host (``RuntimeServer.interrupt``)."""

    def __init__(self) -> None:
        super().__init__("Stopped while running. Change the cell or run it again to retry.")


class ResourcePendingError(RuntimeError):
    """Raised when a downstream cell reads an unresolved resource."""


ERROR_ORIGIN = "_reaktiv_workbook_origin"
ERROR_DETAIL = "_reaktiv_workbook_detail"
SHARED_CODE_FILE = "<shared-code>"
_ENGINE_DIRECTORIES = tuple(
    os.path.dirname(os.path.abspath(path)) + os.sep
    for path in (getattr(sys.modules[name], "__file__", None) for name in (__name__, "reaktiv"))
    if isinstance(path, str)
)
# Frames inside libraries: only the innermost ones help ("where in pandas did it fail").
_LIBRARY_FRAMES = 3


# "<cell A7>:2: UserWarning: …" (how Python prints warnings) → "Line 2: UserWarning: …".
CELL_LOCATION = re.compile(r"<cell [^>\n]*>:(\d+): ")


def cell_location(match: re.Match[str]) -> str:
    return f"Line {match.group(1)}: "


def error_origin(error: BaseException) -> str | None:
    return getattr(error, ERROR_ORIGIN, None)


def _frame_label(filename: str) -> str:
    if filename.startswith("<cell ") and filename.endswith(">"):
        return f"Cell {filename[6:-1]}"
    if filename == SHARED_CODE_FILE:
        return "Shared code"
    if filename == "<workbook-import>":
        return "Workbook imports"
    parts = filename.replace("\\", "/").split("/")
    return "/".join(parts[-3:])


def error_detail(error: BaseException, cell_id: str) -> dict[str, Any]:
    """Where an error happened, for the Logs panel: a traceback limited to cell code,
    shared code, and the innermost library frames (engine frames are noise), plus the
    failing line of the cell itself."""
    own = cell_filename(cell_id)
    lines = ["Traceback (most recent call last):"]
    line: int | None = None
    source: str | None = None
    syntax_error = error if isinstance(error, SyntaxError) and error.lineno is not None else None
    syntax = syntax_error is not None
    extracted: list[traceback.FrameSummary] = [] if syntax else list(traceback.extract_tb(error.__traceback__))
    frames = [frame for frame in extracted if not frame.filename.startswith(_ENGINE_DIRECTORIES)]
    library = [frame for frame in frames if not frame.filename.startswith("<")]
    hidden = {id(frame) for frame in library[:-_LIBRARY_FRAMES]}
    for index, frame in enumerate(frames):
        if id(frame) in hidden or frame.filename == "<string>":
            continue
        # Block formulas and effects run as a function: its hidden call is not cell code.
        following = frames[index + 1] if index + 1 < len(frames) else None
        if (
            frame.name == "<module>"
            and following is not None
            and following.filename == frame.filename
            and following.name in CELL_FUNCTIONS
        ):
            continue
        where = "" if frame.name in ("<module>", *CELL_FUNCTIONS) else f", in {frame.name}"
        lines.append(f"  {_frame_label(frame.filename)}, line {frame.lineno}{where}")
        if frame.line:
            lines.append(f"    {frame.line}")
        if frame.filename == own:
            line, source = frame.lineno, frame.line or None
    if syntax_error is not None:
        # Compile errors have no useful frames: the location is on the exception.
        filename = syntax_error.filename or own
        if filename in ("<unknown>", "<string>"):
            filename = own
        lines.append(f"  {_frame_label(filename)}, line {syntax_error.lineno}")
        text = (syntax_error.text or "").rstrip("\n")
        if text:
            stripped = text.lstrip()
            lines.append(f"    {stripped}")
            if syntax_error.offset:
                lines.append("    " + " " * max(0, syntax_error.offset - 1 - (len(text) - len(stripped))) + "^")
        if filename == own:
            line, source = syntax_error.lineno, text.strip() or None
    cause = error.__cause__ or (None if error.__suppress_context__ else error.__context__)
    lines.append(error_message(error))
    if cause is not None and not syntax:
        lines.append(f"Caused by {error_message(cause)}")
    detail: dict[str, Any] = {"traceback": "\n".join(lines)}
    if line is not None:
        detail["line"] = line
    if source:
        detail["source"] = source
    return detail


def error_message(error: BaseException) -> str:
    if isinstance(error, SyntaxError) and error.lineno is not None:
        # Without the internal file name: "SyntaxError: invalid syntax (line 2)".
        return f"{type(error).__name__}: {error.msg} (line {error.lineno})"
    return f"{type(error).__name__}: {error}"
