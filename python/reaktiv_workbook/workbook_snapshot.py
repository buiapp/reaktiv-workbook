"""Settled workbook result shared by the CLI, browser and HTTP hosts."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .model import CellDefinition


@dataclass(frozen=True)
class WorkbookSnapshot:
    cells: tuple[dict[str, Any], ...]
    dependencies: dict[str, list[str]]
    effects: tuple[dict[str, Any], ...]
    logs: tuple[dict[str, Any], ...]
    changed: tuple[str, ...]
    initialized: bool
    # Clock cells (every/at) and when each ticks next; the host fires `tick_timer`.
    timers: tuple[dict[str, Any], ...] = ()
    # Custom messages from Python widgets to their views (widget.send(...)).
    widget_messages: tuple[dict[str, Any], ...] = ()
    # Cells stopped for running too long (the host keeps them stopped; CellStopped).
    stopped: tuple[str, ...] = ()
    cell_changes: tuple[CellDefinition, ...] = ()
    actions: tuple[dict[str, Any], ...] = ()
    workbook_revision: str = ""
    widget_dependencies: dict[str, list[str]] | None = None
    source_dependencies: dict[str, list[str]] | None = None
    dependency_states: dict[str, str] | None = None
    update_trace: dict[str, Any] | None = None
    timings: dict[str, float] | None = None
    snapshot_epoch: str = ""
    snapshot_sequence: int = 0
    # Python-only invocation outcome: never encoded or retained in graph history.
    action_value: Any = None
    action_error: BaseException | None = None

    @property
    def rebuilt(self) -> bool:
        """Compatibility flag: true only for the first graph initialization."""

        return self.initialized

    def to_dict(self) -> dict[str, Any]:
        return {
            "cells": list(self.cells),
            **({"snapshotEpoch": self.snapshot_epoch, "snapshotSequence": self.snapshot_sequence} if self.snapshot_epoch else {}),
            "workbookRevision": self.workbook_revision,
            **({"timings": self.timings} if self.timings is not None else {}),
            **({"updateTrace": self.update_trace} if self.update_trace is not None else {}),
            **({"actions": list(self.actions)} if self.actions else {}),
            **({"cellChanges": [cell.to_dict() for cell in self.cell_changes]} if self.cell_changes else {}),
            "dependencies": self.dependencies,
            "sourceDependencies": self.source_dependencies or {},
            "dependencyStates": self.dependency_states or {},
            **({"widgetDependencies": self.widget_dependencies} if self.widget_dependencies else {}),
            "effects": list(self.effects),
            "logs": list(self.logs),
            "changed": list(self.changed),
            "timers": list(self.timers),
            **({"widgetMessages": list(self.widget_messages)} if self.widget_messages else {}),
            **({"stopped": list(self.stopped)} if self.stopped else {}),
            "rebuilt": self.rebuilt,
            "updateMode": "initialized" if self.initialized else "incremental",
        }
