"""Revision-checked moves against the live workbook, with sparse definition patches."""
from __future__ import annotations

from dataclasses import replace
from typing import Any
from time import perf_counter
from .model import cell_coordinates, move_cells, move_cell_group, translate_cell_id
from .sheets import split_cell_id
from .narrowing import as_mapping, as_sequence
from .actions import ActionDefinition, rewrite_action_handles
from .workbook import ReactiveWorkbook

class MoveConflict(ValueError):
    """The command must be reviewed against the latest workbook; never replay it."""

class MoveRejected(ValueError):
    """Planning failed before the live workbook was changed; another move is safe."""


async def move_workbook(
    workbook: ReactiveWorkbook, expected_revision: str, source_id: str,
    target_id: str, source_ids: list[str] | None = None,
) -> dict[str, Any]:
    started = perf_counter()
    if expected_revision != workbook.revision:
        raise MoveConflict('Move conflict: the workbook changed. Refresh before moving cells again.')
    document = workbook.document
    try:
        before = {cell.id: cell for cell in document.cells}
        moved = (move_cell_group(document.cells, source_ids, source_id, target_id, document.sheet_names)
                 if source_ids else move_cells(document.cells, source_id, target_id, document.sheet_names))
        if source_ids:
            positions = {key: translate_cell_id(key, source_id, target_id) for key in source_ids}
        else:
            positions = {source_id: target_id}
            if target_id in before and target_id != source_id:
                positions[target_id] = source_id
        origins = {positions.get(key, key): key for key in before}
        patches: list[dict[str, Any]] = []
        for cell in moved:
            previous_id = origins[cell.id]
            old, new = before[previous_id].to_dict(), cell.to_dict()
            patch = {key: new.get(key) for key in old.keys() | new.keys() if old.get(key) != new.get(key)}
            if patch:
                patches.append({'previousId': previous_id, 'changes': patch})
        handles: dict[str, str] = {}
        after = {cell.id: cell for cell in moved}
        for old_id, new_id in positions.items():
            old_sheet, old_coordinate = split_cell_id(old_id)
            new_sheet, new_coordinate = split_cell_id(new_id)
            old_cell, new_cell = before[old_id], after[new_id]
            destination = f"{new_sheet or document.sheet_name}.{new_cell.name or new_coordinate}"
            for alias in {old_coordinate, old_cell.name or old_coordinate}:
                handles[f"{old_sheet or document.sheet_name}.{alias}"] = destination
                if not old_sheet:
                    handles[alias] = destination
        actions: list[ActionDefinition] = []
        for action in document.actions:
            bindings: dict[str, Any] = {}
            for key, value in action.bindings.items():
                binding = as_mapping(value)
                target = binding.get('cell') if binding else None
                bindings[key] = {**binding, 'cell': positions.get(target, target)} if binding and isinstance(target, str) else value
            actions.append(replace(action, source=rewrite_action_handles(action, handles), references={k: positions.get(v, v) for k, v in action.references.items()}, bindings=bindings))
        # Kernels may only know occupied extents, while the UI has additional empty
        # rows/columns. Grow before constructing the validated moved document.
        grids = {'': (document.columns, document.rows)} | {tab.name: (tab.columns, tab.rows) for tab in document.sheets}
        destinations = set(positions.values())
        for cell in moved:
            if cell.id not in destinations:
                continue
            sheet = split_cell_id(cell.id)[0]
            column, row = cell_coordinates(cell.id)
            span = as_sequence(cell.view.get('span', [1, 1])) if cell.view else [1, 1]
            assert span is not None  # CellDefinition validates spans.
            columns, rows = grids[sheet]
            grids[sheet] = (max(columns, column + int(span[0]) - 1), max(rows, row + int(span[1]) - 1))
        updated = replace(document, cells=moved, actions=tuple(actions),
            columns=grids[''][0], rows=grids[''][1],
            sheets=tuple(replace(tab, columns=grids[tab.name][0], rows=grids[tab.name][1]) for tab in document.sheets),
            note_order=tuple(positions.get(key, key) for key in document.note_order),
            note_parents={positions.get(k, k): positions.get(v, v) for k, v in document.note_parents.items()})
    except (ValueError, KeyError, SyntaxError) as error:
        # Planning only reads definitions. Never classify live-apply failures below
        # as safe refusals: user code may have changed runtime state by then.
        raise MoveRejected(str(error)) from error
    planned = perf_counter()
    graph = await workbook.load_moved_document_async(updated, positions)
    # Keep script sessions and saved metadata consistent with the moved definitions.
    return {'patches': patches, 'graph': graph.to_dict(), 'actions': [a.to_dict() for a in actions],
            'timings': {'rewriteMs': (planned-started)*1000, 'applyMs': (perf_counter()-planned)*1000}}
