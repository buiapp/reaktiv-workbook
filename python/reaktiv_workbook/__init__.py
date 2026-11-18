"""Public Python API for Reaktiv Workbook."""

from .action import ActionDescriptor, BoundAction, action
from .actions import ActionDefinition
from .cell_access import CellRef, cell_refs
from .artifact import Artifact, artifact
from .html_output import HTML, html
from .resample import resampled
from .widgets import WidgetStateError, bind
from .model import (
    CellDefinition,
    FORMAT_NAME,
    FORMAT_VERSION,
    SheetDocument,
    move_cell_group,
    move_cells,
)
from .workbook import ReactiveWorkbook, WorkbookSnapshot
from .timers import at, every
from .schema import CellMetadata, cell, input_cell, markdown, sheet
from .composition import Workbook, Worksheet, worksheet, workbook_config

__all__ = [
    "WorkbookSession",
    "SheetSession",
    "Workbook", "Worksheet", "worksheet", "workbook_config",
    "action",
    "BoundAction",
    "ActionDescriptor",
    "ActionDefinition",
    "CellRef",
    "cell_refs",
    "CellDefinition",
    "CellMetadata",
    "Artifact",
    "HTML",
    "FORMAT_NAME",
    "FORMAT_VERSION",
    "ReactiveWorkbook",
    "SheetDocument",
    "WidgetStateError",
    "WorkbookSnapshot",
    "artifact",
    "bind",
    "at",
    "every",
    "html",
    "resampled",
    "move_cells",
    "move_cell_group",
    "cell",
    "input_cell",
    "markdown",
    "sheet",
]


# The browser runtime imports this package too; the embedded host depends on CPython's
# HTTP server and threading, so load it only when explicitly requested.
from typing import TYPE_CHECKING, Any
if TYPE_CHECKING:
    from .session import WorkbookSession, SheetSession


def __getattr__(name: str) -> Any:
    if name in {"WorkbookSession", "SheetSession"}:
        from .session import WorkbookSession
        return WorkbookSession
    raise AttributeError(name)
