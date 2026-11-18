"""Versioned document model for Reaktiv Workbook files."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
import ast
import io
import inspect
import json
import keyword
from pathlib import Path
import re
import textwrap
import tokenize
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence, Union

from .source_analysis import bound_identifiers, known_literal, remember_literal, literal_type
from .actions import ActionDefinition, parse_actions, rewrite_members
from .narrowing import as_list, as_mapping, as_sequence
from .widget_config import WIDGET_TYPES as WIDGET_TYPES, WIDGET_SETTINGS, normalize_widget, widget_expression
from .sheets import (
    DEFAULT_SHEET_NAME,
    ReferenceScope,
    iter_coordinate_references,
    qualify,
    relative_reference,
    sheet_prefixes,
    split_cell_id,
    valid_sheet_name,
)


FORMAT_NAME = "reaktiv-workbook"
FORMAT_VERSION = 4
# First-sheet cells are plain coordinates; other sheets prefix them: "Budget!A1".
CELL_ID = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*$")
CELL_KINDS = frozenset({"input", "linked", "formula", "resource", "markdown", "effect"})
EFFECT_TRIGGERS = frozenset({"auto", "manual"})
MARKDOWN_INTERPOLATION = re.compile(r"\{\{(.*?)\}\}", re.DOTALL)
MARKDOWN_CELL_LINK = re.compile(
    r"(?P<prefix>#(?:sheet-input:|cell-|note-))(?P<cell>(?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*)(?=[?)\s#'\">]|$)"
)
CELL_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")


@dataclass(frozen=True)
class CellDefinition:
    """Serializable definition of one spreadsheet cell."""

    id: str
    kind: str
    source: str
    enabled: bool = True
    trigger: str = "auto"
    name: str = ""
    color: str = ""
    # Dashboard presentation in the grid, e.g. {"display": "rendered", "span": [2, 2],
    # "widget": {"type": "range", "min": 0, "max": 1}}; None means a plain value cell.
    view: Optional[dict[str, Any]] = None
    # Type hint of a formula's value (`float`, `pd.DataFrame`); written as the method's return
    # annotation, checked by `reaktiv-workbook` type checking.
    annotation: str = ""
    override: Optional[str] = None
    equal: str = ""
    # None: simple async body with automatic snapshots. Otherwise synchronous params code.
    params: Optional[str] = None
    # Optional linked computation receiving source and previous (PreviousState or None).
    computation: Optional[str] = None
    # False retains the initializer when actions/effects write live input values.
    save_value: bool = True

    def __post_init__(self) -> None:
        if not CELL_ID.fullmatch(self.id):
            raise ValueError(f"Invalid cell id: {self.id!r}")
        if self.kind not in CELL_KINDS:
            raise ValueError(f"Invalid cell kind for {self.id}: {self.kind!r}")
        if not isinstance(self.source, str):
            raise TypeError(f"Cell {self.id} source must be a string")
        if not isinstance(self.save_value, bool):
            raise TypeError("Input save_value must be a boolean")
        if not self.save_value and self.kind != "input":
            raise ValueError("save_value=False applies only to input cells")
        if not isinstance(self.enabled, bool):
            raise TypeError(f"Cell {self.id} enabled must be a boolean")
        if self.trigger not in EFFECT_TRIGGERS:
            raise ValueError(f"Invalid effect trigger for {self.id}: {self.trigger!r}")
        if self.name == 'cells':
            raise ValueError('The label cells is reserved for the cell-reference namespace')
        if self.name and (not self.name.isidentifier() or keyword.iskeyword(self.name)):
            raise ValueError(f"Invalid Python cell name for {self.id}: {self.name!r}")
        if self.color and not CELL_COLOR.fullmatch(self.color):
            raise ValueError(f"Invalid cell color for {self.id}: {self.color!r}")
        if self.override is not None and (self.kind != "linked" or not isinstance(self.override, str)):
            raise TypeError("Only linked inputs accept a string override")
        if not isinstance(self.equal, str):
            raise TypeError("Cell equality must be a Python expression string")
        if self.equal and self.kind == "effect":
            raise ValueError("Effects have no value to compare")
        object.__setattr__(self, "equal", self.equal.strip())
        if self.params is not None and (self.kind != "resource" or not isinstance(self.params, str) or not self.params.strip()):
            raise ValueError("Resource parameters must be nonempty synchronous Python code")
        if self.computation is not None and (self.kind != "linked" or not isinstance(self.computation, str) or not self.computation.strip()):
            raise ValueError("Linked computation must be nonempty synchronous Python code")
        object.__setattr__(self, "color", self.color.lower())
        object.__setattr__(self, "view", normalize_view(self.view, self.id))
        object.__setattr__(self, "annotation", normalize_annotation(self.annotation, self.kind, self.id))

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "CellDefinition":
        cell_id = value.get("id")
        kind = value.get("kind")
        source = value.get("source")
        enabled = value.get("enabled", True)
        trigger = value.get("trigger", "auto")
        name = value.get("name", "")
        color = value.get("color", "")
        view = value.get("view")
        annotation = value.get("annotation", "")
        if not isinstance(cell_id, str):
            raise TypeError("Cell id must be a string")
        if not isinstance(kind, str):
            raise TypeError(f"Cell {cell_id} kind must be a string")
        if not isinstance(source, str):
            raise TypeError(f"Cell {cell_id} source must be a string")
        if not isinstance(name, str):
            raise TypeError(f"Cell {cell_id} name must be a string")
        if not isinstance(color, str):
            raise TypeError(f"Cell {cell_id} color must be a string")
        if not isinstance(annotation, str):
            raise TypeError(f"Cell {cell_id} type hint must be a string")
        return cls(cell_id, kind, source, enabled, trigger, name, color, view, annotation, value.get("override"), value.get("equal", ""), value.get("params"), value.get("computation"), value.get("saveValue", True))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "source": self.source,
            "enabled": self.enabled,
            "trigger": self.trigger,
            "name": self.name,
            "color": self.color,
            **({"view": self.view} if self.view else {}),
            **({"annotation": self.annotation} if self.annotation else {}),
            **({"equal": self.equal} if self.equal else {}),
            **({"computation": self.computation} if self.computation is not None else {}),
            **({"params": self.params} if self.params is not None else {}),
            **({"override": self.override} if self.override is not None else {}),
            **({"saveValue": False} if not self.save_value else {}),
        }


def normalize_annotation(annotation: str, kind: str, cell_id: str = "") -> str:
    """A formula's type hint: one Python expression (``float``, ``list[str]``,
    ``pd.DataFrame``); other kinds have none."""
    text = " ".join(annotation.split()) if isinstance(annotation, str) else ""
    if not text or kind not in ("formula", "linked"):
        return ""
    try:
        ast.parse(text, mode="eval")
    except SyntaxError as error:
        raise ValueError(f"Cell {cell_id} type hint is not a Python type: {text!r}") from error
    return text


VIEW_DISPLAYS = frozenset({"value", "rendered"})
MAX_SPAN = 50


def normalize_view(view: Any, cell_id: str = "") -> Optional[dict[str, Any]]:
    """Validate a cell's dashboard view; defaults are dropped so plain cells stay None."""
    if view is None:
        return None
    view = as_mapping(view)
    if view is None:
        raise TypeError(f"Cell {cell_id} view must be a mapping")
    normalized: dict[str, Any] = {}
    display = view.get("display", "value")
    if display not in VIEW_DISPLAYS:
        raise ValueError(f"Cell {cell_id} view display must be 'value' or 'rendered'")
    if display != "value":
        normalized["display"] = display
    span = as_sequence(view.get("span", [1, 1]))
    if (
        span is None
        or len(span) != 2
        or not all(isinstance(item, int) and not isinstance(item, bool) for item in span)
        or not all(1 <= item <= MAX_SPAN for item in span)
    ):
        raise ValueError(f"Cell {cell_id} view span must be [columns, rows] from 1 to {MAX_SPAN}")
    if list(span) != [1, 1]:
        normalized["span"] = [span[0], span[1]]
    page = view.get("page")
    if page is not None and not isinstance(page, bool):
        raise TypeError(f"Cell {cell_id} view page must be True or False")
    if page is False:
        normalized["page"] = False
    markdown = view.get("markdown")
    if markdown is not None:
        if not isinstance(markdown, bool):
            raise TypeError(f"Cell {cell_id} view markdown must be True or False")
        normalized["markdown"] = markdown
    raw_color = view.get("color")
    if raw_color is not None:
        expression = widget_expression('color', raw_color)
        if expression is None:
            raise ValueError(f'Cell {cell_id} view color must be {{"expr": "Python expression"}}')
        ast.parse(expression, mode='eval')
        normalized['color'] = {'expr': expression.strip()}
    raw_widget = view.get("widget")
    if raw_widget is not None:
        normalized["widget"] = normalize_widget(raw_widget, cell_id)
    return normalized or None


CellLike = Union[CellDefinition, Mapping[str, Any]]


def _sheet_map(
    sheets: Optional[Sequence[str]], cells: Iterable[CellDefinition]
) -> dict[str, str]:
    """Sheet name -> id prefix; inferred from qualified ids when names are not given."""
    if sheets:
        return sheet_prefixes(sheets[0], tuple(sheets[1:]))
    extra = tuple(sorted({split_cell_id(cell.id)[0] for cell in cells} - {""}))
    return sheet_prefixes(DEFAULT_SHEET_NAME, extra)


@dataclass(frozen=True)
class SheetTab:
    """An additional sheet (tab) of a workbook: its name and grid layout. The first
    sheet's layout lives on SheetDocument itself (columns, rows, sizes, sheet_name)."""

    name: str
    columns: int = 10
    rows: int = 16
    column_widths: dict[str, int] = field(default_factory=dict[str, int])
    row_heights: dict[str, int] = field(default_factory=dict[str, int])

    def __post_init__(self) -> None:
        if not valid_sheet_name(self.name):
            raise ValueError(f"Invalid sheet name {self.name!r}; use a Python identifier")
        for value, label in ((self.columns, "columns"), (self.rows, "rows")):
            if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                raise ValueError(f"Sheet {self.name} {label} must be a positive integer")
        object.__setattr__(
            self, "column_widths", _normalize_sizes(self.column_widths, minimum=64, maximum=480)
        )
        object.__setattr__(
            self, "row_heights", _normalize_sizes(self.row_heights, minimum=28, maximum=240)
        )

    @classmethod
    def from_dict(cls, value: object) -> "SheetTab":
        tab = as_mapping(value)
        grid = as_mapping(tab.get("grid", {})) if tab is not None else None
        layout = as_mapping(tab.get("layout", {})) if tab is not None else None
        if tab is None or grid is None or layout is None:
            raise TypeError("A sheet must be an object with a grid and a layout")
        return cls(
            name=tab.get("name", ""),
            columns=grid.get("columns", 10),
            rows=grid.get("rows", 16),
            column_widths=dict(as_mapping(layout.get("columnWidths", {})) or {}),
            row_heights=dict(as_mapping(layout.get("rowHeights", {})) or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "grid": {"columns": self.columns, "rows": self.rows},
            "layout": {"columnWidths": self.column_widths, "rowHeights": self.row_heights},
        }


def normalize_cells(cells: Iterable[CellLike]) -> tuple[CellDefinition, ...]:
    """Validate, normalize, and coordinate-sort cell definitions."""

    normalized: dict[str, CellDefinition] = {}
    names: dict[str, str] = {}
    for item in cells:
        cell = (
            item if isinstance(item, CellDefinition) else CellDefinition.from_dict(item)
        )
        if cell.id in normalized:
            raise ValueError(f"Duplicate cell id: {cell.id}")
        if cell.name:
            key = qualify(split_cell_id(cell.id)[0], cell.name)
            previous = names.get(key)
            if previous is not None:
                raise ValueError(
                    f"Duplicate cell label {cell.name!r}: {previous} and {cell.id}"
                )
            names[key] = cell.id
        if cell.kind != "effect" and (not cell.enabled or cell.trigger != "auto"):
            cell = replace(cell, enabled=True, trigger="auto")
        normalized[cell.id] = cell
    return tuple(sorted(normalized.values(), key=lambda cell: _cell_sort_key(cell.id)))


def verify_written_document(source: str, expected: Mapping[str, Any]) -> list[str]:
    """Problems that would make a saved file differ from the workbook in the app; empty when
    the file loads back the same. ``expected`` is the app's document (``to_dict`` shape).

    The reference is this package's own writer: the expected document is written with it and
    loaded back, so labels and coordinates are compared in the same canonical form."""
    from .save_diagnostics import verification_error

    try:
        written = SheetDocument.loads(source)
    except Exception as error:  # noqa: BLE001 - any failure means the file is unusable
        return [verification_error("The file would not load", error, source, expected)]
    reference_source: str | None = None
    try:
        reference_source = replace(SheetDocument.from_dict(expected), snapshot=None).dumps()
        reference = SheetDocument.loads(reference_source)
    except Exception as error:  # noqa: BLE001
        return [verification_error("The workbook could not be checked", error, reference_source, expected)]
    problems: list[str] = []
    actual_cells = {cell.id: cell for cell in written.cells}
    expected_cells = {cell.id: cell for cell in reference.cells}
    for cell_id, cell in expected_cells.items():
        label = f"Cell {cell_id}" + (f" ({cell.name})" if cell.name else "")
        other = actual_cells.get(cell_id)
        if other is None:
            problems.append(f"{label} would be missing")
            continue
        for attribute, description in (
            ("save_value", "input value persistence"), ("kind", "kind"), ("source", "code"), ("name", "label"), ("enabled", "on/off state"),
            ("trigger", "trigger"), ("color", "colour"), ("view", "display settings"),
            ("equal", "equality function"), ("params", "resource parameters"), ("computation", "linked computation"), ("annotation", "type hint"), ("override", "linked input override"),
        ):
            if getattr(cell, attribute) != getattr(other, attribute):
                problems.append(f"{label}: its {description} would change")
    for cell_id in sorted(set(actual_cells) - set(expected_cells)):
        problems.append(f"Cell {cell_id} would appear although it is not in the workbook")
    for attribute, description in (
        ("name", "name"), ("packages", "packages"), ("imports", "imports"), ("code", "shared code"),
        ("save_outputs", "output snapshot preference"),
        ("actions", "actions"), ("variables", "environment variables"), ("note_order", "note order"), ("note_parents", "note hierarchy"), ("sheets", "sheets"),
        ("sheet_name", "first sheet's name"), ("kernel", "kernel"), ("python", "Python version"),
    ):
        if getattr(reference, attribute, None) != getattr(written, attribute, None):
            problems.append(f"The workbook's {description} would change")
    return problems


def _rewrite_widget_view(view: Optional[dict[str, Any]], rewrite: Callable[[str], str], coordinates: Optional[Mapping[str, str]] = None) -> Optional[dict[str, Any]]:
    if view is None:
        return None
    color = as_mapping(view.get('color'))
    if color is not None:
        view = {**view, 'color': {'expr': rewrite(str(color['expr']))}}
    widget = as_mapping(view.get("widget"))
    if widget is None:
        return view
    clean = dict(widget)
    for key in WIDGET_SETTINGS:
        value = clean.get(key)
        expression = widget_expression(key, value)
        if expression is not None:
            clean[key] = {"expr": rewrite(expression)} if as_mapping(value) is not None else rewrite(expression)
    bindings = as_mapping(clean.get("actionArguments"))
    if bindings is not None and coordinates:
        updated: dict[str, Any] = {}
        for name, raw in bindings.items():
            binding = as_mapping(raw)
            target = binding.get("cell") if binding is not None else None
            updated[name] = {"cell": coordinates.get(target, target)} if isinstance(target, str) else raw
        clean["actionArguments"] = updated
    return {**view, "widget": clean}


def validate_cell_placements(cells: Sequence[CellDefinition], coordinates: Mapping[str, str]) -> None:
    """Reject collisions involving moved cells using their complete final footprints.

    Unchanged legacy overlaps are not inspected; loading/saving old documents stays
    compatible. Group moves and swaps are checked after all source areas are vacated.
    """
    rectangles: dict[str, list[tuple[str, int, int, int, int, bool]]] = {}
    for cell in cells:
        target = coordinates.get(cell.id, cell.id)
        sheet = split_cell_id(target)[0]
        column, row = cell_coordinates(target)
        span = as_sequence(cell.view.get('span', [1, 1])) if cell.view else [1, 1]
        # CellDefinition already validated/normalized spans.
        assert span is not None
        width, height = int(span[0]), int(span[1])
        rectangles.setdefault(sheet, []).append((target, column, row, column + width, row + height, cell.id in coordinates))
    for sheet in rectangles.values():
        for target, left, top, right, bottom, moved in sheet:
            if not moved:
                continue
            for other, other_left, other_top, other_right, other_bottom, _ in sheet:
                if target != other and left < other_right and other_left < right and top < other_bottom and other_top < bottom:
                    raise ValueError(f'Cell {target} would overlap cell {other}. Choose an empty area outside resized cells.')


def move_cells(
    cells: Iterable[CellLike],
    source_id: str,
    target_id: str,
    sheets: Optional[Sequence[str]] = None,
) -> tuple[CellDefinition, ...]:
    """Move or swap cell identities while preserving references to moved content."""

    normalized = normalize_cells(cells)
    aliases = {qualify(split_cell_id(c.id)[0], c.name): c.id for c in normalized if c.name}
    if source_id == target_id:
        return normalized
    if not any(cell.id == source_id for cell in normalized):
        raise KeyError(f"Cell {source_id} does not exist")
    coordinates = {source_id: target_id}
    if any(cell.id == target_id for cell in normalized):
        coordinates[target_id] = source_id
    validate_cell_placements(normalized, coordinates)

    moved: list[CellDefinition] = []
    for cell in normalized:
        try:
            source = cell.source
            scope_sheet, scope_sheets = split_cell_id(cell.id)[0], _sheet_map(sheets, normalized)
            if cell.kind == "markdown":
                source = _rewrite_markdown_references(source, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases)
            else:
                source = _rewrite_python(source, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases)
        except (IndentationError, tokenize.TokenError) as error:
            raise ValueError(
                f"Cannot safely move cells while {cell.id} has incomplete Python source: {error}"
            ) from error
        view = _rewrite_widget_view(cell.view, lambda expression: _rewrite_python(expression, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases), coordinates)
        moved.append(replace(cell, id=coordinates.get(cell.id, cell.id), source=source, view=view, params=_rewrite_python(cell.params, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases) if cell.params is not None else None, computation=_rewrite_python(cell.computation, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases, frozenset({"source", "previous"})) if cell.computation is not None else None))
    return normalize_cells(moved)


def move_cell_group(
    cells: Iterable[CellLike],
    source_ids: Iterable[str],
    anchor_id: str,
    target_id: str,
    sheets: Optional[Sequence[str]] = None,
) -> tuple[CellDefinition, ...]:
    """Move selected cells by one offset — within a sheet or onto another sheet (the
    sheet of ``target_id``) — and rewrite coordinate references atomically."""

    normalized = normalize_cells(cells)
    aliases = {qualify(split_cell_id(c.id)[0], c.name): c.id for c in normalized if c.name}
    selected = set(source_ids)
    if not selected:
        return normalized
    existing = {cell.id for cell in normalized}
    missing = selected - existing
    if missing:
        raise KeyError(f"Cells do not exist: {', '.join(sorted(missing))}")
    if anchor_id not in selected:
        raise ValueError("The dragged cell must be part of the selection")
    source_sheet, target_sheet = split_cell_id(anchor_id)[0], split_cell_id(target_id)[0]
    if any(split_cell_id(cell_id)[0] != source_sheet for cell_id in selected):
        raise ValueError("Move cells from one sheet at a time")
    anchor_column, anchor_row = cell_coordinates(anchor_id)
    target_column, target_row = cell_coordinates(target_id)
    column_delta = target_column - anchor_column
    row_delta = target_row - anchor_row
    if column_delta == 0 and row_delta == 0 and source_sheet == target_sheet:
        return normalized

    coordinates: dict[str, str] = {}
    for cell_id in selected:
        column, row = cell_coordinates(cell_id)
        next_column = column + column_delta
        next_row = row + row_delta
        if next_column < 1 or next_row < 1:
            raise ValueError("The selection cannot be moved outside the sheet")
        coordinates[cell_id] = qualify(target_sheet, f"{_column_name(next_column)}{next_row}")
    destinations = set(coordinates.values())
    if len(destinations) != len(coordinates):
        raise ValueError("The selection has overlapping destinations")
    occupied = destinations & (existing - selected)
    if occupied:
        raise ValueError(
            "The selection would overwrite cells: " + ", ".join(sorted(occupied))
        )

    validate_cell_placements(normalized, coordinates)
    moved: list[CellDefinition] = []
    for cell in normalized:
        try:
            source = cell.source
            scope_sheet, scope_sheets = split_cell_id(cell.id)[0], _sheet_map(sheets, normalized)
            to_sheet = split_cell_id(coordinates[cell.id])[0] if cell.id in coordinates else None
            if cell.kind == "markdown":
                source = _rewrite_markdown_references(
                    source, coordinates, scope_sheet, scope_sheets, to_sheet, aliases
                )
            else:
                source = _rewrite_python(source, coordinates, scope_sheet, scope_sheets, to_sheet, aliases)
        except (IndentationError, tokenize.TokenError) as error:
            raise ValueError(
                f"Cannot safely move cells while {cell.id} has incomplete Python source: {error}"
            ) from error
        view = _rewrite_widget_view(cell.view, lambda expression: _rewrite_python(expression, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases), coordinates)
        moved.append(replace(cell, id=coordinates.get(cell.id, cell.id), source=source, view=view, params=_rewrite_python(cell.params, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases) if cell.params is not None else None, computation=_rewrite_python(cell.computation, coordinates, scope_sheet, scope_sheets, split_cell_id(coordinates.get(cell.id, cell.id))[0], aliases, frozenset({"source", "previous"})) if cell.computation is not None else None))
    return normalize_cells(moved)


def normalize_note_parents(cells: Sequence[CellDefinition], parents: object) -> dict[str, str]:
    mapping = as_mapping(parents)
    if mapping is None or any(not isinstance(parent, str) for parent in mapping.values()):
        raise TypeError("Note parents must map child cell ids to parent cell ids")
    ids = {cell.id for cell in cells if cell.kind == "markdown" and (cell.view or {}).get("page") is not False}
    valid = {child: str(parent) for child, parent in mapping.items() if child in ids and parent in ids and child != parent}
    result: dict[str, str] = {}
    for child, parent in valid.items():
        seen = {child}
        cursor = parent
        while cursor and cursor not in seen:
            seen.add(cursor)
            cursor = valid.get(cursor, "")
        if not cursor:
            result[child] = parent
    return result


@dataclass(frozen=True)
class SheetDocument:
    """Portable, versioned representation of a reactive spreadsheet."""

    name: str = "Untitled"
    columns: int = 10
    rows: int = 16
    cells: tuple[CellDefinition, ...] = field(default_factory=tuple)
    packages: tuple[str, ...] = field(default_factory=tuple)
    imports: tuple[str, ...] = field(default_factory=tuple)
    variables: dict[str, str] = field(default_factory=dict[str, str])
    column_widths: dict[str, int] = field(default_factory=dict[str, int])
    row_heights: dict[str, int] = field(default_factory=dict[str, int])
    zoom: float = 1.0
    note_zoom: float = 1.0
    # Manual order of notes in the notes list (cell ids); notes not listed follow in
    # sheet order. Empty = sheet order.
    note_order: tuple[str, ...] = field(default_factory=tuple)
    note_parents: dict[str, str] = field(default_factory=dict[str, str])
    # Last evaluated results (see make_snapshot) so notes can be read without running
    # the graph. File saves use a .snapshot.json companion; JSON API documents carry it separately.
    snapshot: Optional[dict[str, Any]] = None
    # Where the workbook runs: "pyodide" (in the app, sandboxed) or "local" (real
    # CPython: open it with `reaktiv-workbook edit`). `python` pins the version, which
    # `--sandbox` honours ("" = the launching interpreter).
    kernel: str = "pyodide"
    python: str = ""
    # Sheets (tabs): the first sheet is named `sheet_name` and uses the layout fields
    # above; `sheets` holds the others.
    sheet_name: str = DEFAULT_SHEET_NAME
    sheets: tuple[SheetTab, ...] = ()
    # Shared code: functions, classes, and constants available to every cell. Written
    # at module level in the .sheet.py (between `env` and the sheet class).
    code: str = ""
    actions: tuple[ActionDefinition, ...] = ()
    save_outputs: bool = True

    @property
    def sheet_names(self) -> tuple[str, ...]:
        return (self.sheet_name, *(sheet.name for sheet in self.sheets))

    def __post_init__(self) -> None:
        if not isinstance(self.save_outputs, bool):
            raise TypeError("saveOutputs must be a boolean")
        if len({item.name for item in self.actions}) != len(self.actions):
            raise ValueError("Action method names must be unique")
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("Document name must be a non-empty string")
        if (
            not isinstance(self.columns, int)
            or isinstance(self.columns, bool)
            or self.columns < 1
        ):
            raise ValueError("Grid columns must be a positive integer")
        if (
            not isinstance(self.rows, int)
            or isinstance(self.rows, bool)
            or self.rows < 1
        ):
            raise ValueError("Grid rows must be a positive integer")
        cells = normalize_cells(self.cells)
        tabs = tuple(
            sheet if isinstance(sheet, SheetTab) else SheetTab.from_dict(sheet)
            for sheet in self.sheets
        )
        object.__setattr__(self, "sheets", tabs)
        if not valid_sheet_name(self.sheet_name):
            raise ValueError(f"Invalid sheet name {self.sheet_name!r}; use a Python identifier")
        if len(set(self.sheet_names)) != len(self.sheet_names):
            raise ValueError("Sheet names must be unique")
        grids = {"": (self.columns, self.rows)} | {tab.name: (tab.columns, tab.rows) for tab in tabs}
        names: set[str] = set()
        for cell in cells:
            sheet = split_cell_id(cell.id)[0]
            if sheet not in grids:
                raise ValueError(f"Cell {cell.id} is on an unknown sheet {sheet!r}")
            column, row = cell_coordinates(cell.id)
            if column > grids[sheet][0] or row > grids[sheet][1]:
                raise ValueError(f"Cell {cell.id} is outside the document grid")
            if cell.name and cell.name in self.sheet_names:
                raise ValueError(f"Cell label {cell.name!r} clashes with a sheet name")
            if cell.name and qualify(sheet, cell.name) in names:
                raise ValueError(f"Duplicate Python cell name: {cell.name}")
            if cell.name:
                names.add(qualify(sheet, cell.name))
        object.__setattr__(self, "cells", cells)
        object.__setattr__(self, "packages", _normalize_packages(self.packages))
        object.__setattr__(self, "imports", normalize_imports(self.imports))
        object.__setattr__(self, "code", normalize_code(self.code))
        object.__setattr__(self, "variables", _normalize_variables(self.variables))
        object.__setattr__(
            self,
            "column_widths",
            _normalize_sizes(self.column_widths, minimum=64, maximum=480),
        )
        object.__setattr__(
            self,
            "row_heights",
            _normalize_sizes(self.row_heights, minimum=28, maximum=240),
        )
        if not isinstance(self.zoom, (int, float)) or isinstance(self.zoom, bool):
            raise TypeError("Document zoom must be a number")
        if not 0.1 <= float(self.zoom) <= 2:
            raise ValueError("Document zoom must be between 0.1 and 2")
        object.__setattr__(self, "zoom", float(self.zoom))
        if not isinstance(self.note_zoom, (int, float)) or isinstance(
            self.note_zoom, bool
        ):
            raise TypeError("Document note zoom must be a number")
        if not 0.7 <= float(self.note_zoom) <= 1.6:
            raise ValueError("Document note zoom must be between 0.7 and 1.6")
        object.__setattr__(self, "note_zoom", float(self.note_zoom))
        if not isinstance(self.note_order, (list, tuple)) or not all(
            isinstance(item, str) for item in self.note_order
        ):
            raise TypeError("Document note order must be a list of cell ids")
        object.__setattr__(self, "note_order", tuple(dict.fromkeys(self.note_order)))
        object.__setattr__(self, "note_parents", normalize_note_parents(self.cells, self.note_parents))
        if self.kernel not in KERNEL_KINDS:
            raise ValueError(f"Document kernel must be one of {sorted(KERNEL_KINDS)}")
        if self.python and not re.fullmatch(r"3\.\d{1,2}(\.\d{1,2})?", self.python):
            raise ValueError(f"Invalid Python version {self.python!r}; use e.g. '3.12'")
        if self.snapshot is not None and not (
            isinstance(self.snapshot, Mapping) and isinstance(self.snapshot.get("cells"), list)
        ):
            raise TypeError("Document snapshot must be a mapping with a 'cells' list")

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "SheetDocument":
        if value.get("format") != FORMAT_NAME:
            raise ValueError(f"Not a {FORMAT_NAME!r} document")
        version = value.get("version")
        if version != FORMAT_VERSION or isinstance(version, bool):
            raise ValueError(
                f"Unsupported {FORMAT_NAME} version {version!r}; expected {FORMAT_VERSION}"
            )
        name = value.get("name", "Untitled")
        grid = as_mapping(value.get("grid", {}))
        cells = as_list(value.get("cells", []))
        raw_actions = as_list(value.get("actions", []))
        if raw_actions is None:
            raise TypeError("Document actions must be an array")
        actions: list[ActionDefinition] = []
        for raw_action in raw_actions:
            action_value = as_mapping(raw_action)
            if action_value is None:
                raise TypeError("Document action must be an object")
            actions.append(ActionDefinition.from_dict(action_value))
        environment = as_mapping(value.get("environment", {}))
        layout = as_mapping(value.get("layout", {}))
        sheets = as_list(value.get("sheets", []))
        if not isinstance(name, str):
            raise TypeError("Document name must be a string")
        if grid is None:
            raise TypeError("Document grid must be an object")
        if cells is None:
            raise TypeError("Document cells must be an array")
        if environment is None:
            raise TypeError("Document environment must be an object")
        if sheets is None:
            raise TypeError("Document sheets must be an array")
        packages = as_list(environment.get("packages", []))
        imports = as_list(environment.get("imports", []))
        variables = as_mapping(environment.get("variables", {}))
        if packages is None:
            raise TypeError("Document environment packages must be an array")
        if imports is None:
            raise TypeError("Document environment imports must be an array")
        if variables is None:
            raise TypeError("Document environment variables must be an object")
        if layout is None:
            raise TypeError("Document layout must be an object")
        column_widths = as_mapping(layout.get("columnWidths", {}))
        row_heights = as_mapping(layout.get("rowHeights", {}))
        if column_widths is None or row_heights is None:
            raise TypeError("Document layout sizes must be objects")
        return cls(
            name=name,
            save_outputs=value.get("saveOutputs", True),
            columns=grid.get("columns", 10),
            rows=grid.get("rows", 16),
            cells=normalize_cells(cells),
            packages=tuple(packages),
            imports=tuple(imports),
            variables=dict(variables),
            column_widths=dict(column_widths),
            row_heights=dict(row_heights),
            zoom=layout.get("zoom", 1.0),
            note_zoom=layout.get("noteZoom", 1.0),
            note_order=tuple(layout.get("noteOrder", ())),
            note_parents=layout.get("noteParents", {}),
            snapshot=value.get("snapshot"),
            kernel=environment.get("kernel", "pyodide"),
            python=environment.get("python", ""),
            sheet_name=value.get("sheetName", DEFAULT_SHEET_NAME),
            sheets=tuple(SheetTab.from_dict(sheet) for sheet in sheets),
            code=environment.get("code", ""),
            actions=tuple(actions),
        )

    @classmethod
    def loads(cls, serialized: str) -> "SheetDocument":
        return _load_python_document(serialized)

    @classmethod
    def load(cls, path: Union[str, Path]) -> "SheetDocument":
        """Read a workbook file; its saved outputs come from the sidecar when the file keeps
        none in older files (``outputs.py``)."""
        from .outputs import read_outputs

        document = cls.loads(Path(path).read_text(encoding="utf-8"))
        sidecar = read_outputs(Path(path))
        if sidecar is not None:
            document = replace(document, snapshot=sidecar)
        return document

    def to_dict(self) -> dict[str, Any]:
        return {
            **({"actions": [item.to_dict() for item in self.actions]} if self.actions else {}),
            **({"saveOutputs": False} if not self.save_outputs else {}),
            "format": FORMAT_NAME,
            "version": FORMAT_VERSION,
            "name": self.name,
            "grid": {"columns": self.columns, "rows": self.rows},
            "environment": {
                "packages": list(self.packages),
                "imports": list(self.imports),
                "variables": dict(self.variables),
                **({"code": self.code} if self.code else {}),
                **_kernel_config(self),
            },
            "layout": {
                "columnWidths": self.column_widths,
                "rowHeights": self.row_heights,
                "zoom": self.zoom,
                "noteZoom": self.note_zoom,
                **({"noteOrder": list(self.note_order)} if self.note_order else {}),
                **({"noteParents": dict(self.note_parents)} if self.note_parents else {}),
            },
            "cells": [cell.to_dict() for cell in self.cells],
            **_sheets_config(self),
            **({"snapshot": self.snapshot} if self.snapshot is not None else {}),
        }

    def dumps(self, *, indent: int = 2) -> str:
        del indent
        from .workbook_format import dump_document
        return dump_document(self)

    def save(self, path: Union[str, Path]) -> None:
        from .outputs import write_outputs

        Path(path).write_text(self.dumps(), encoding="utf-8")
        write_outputs(Path(path), self.snapshot if self.save_outputs else None)


def _cell_sort_key(cell_id: str) -> tuple[bool, str, int, int]:
    sheet = split_cell_id(cell_id)[0]
    column, row = cell_coordinates(cell_id)
    return sheet != "", sheet, row, column


def cell_coordinates(cell_id: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", split_cell_id(cell_id)[1])
    assert match is not None
    column_text, row_text = match.groups()
    column = 0
    for character in column_text:
        column = column * 26 + ord(character) - ord("A") + 1
    return column, int(row_text)


def translate_cell_id(cell_id: str, anchor_id: str, target_id: str) -> str:
    column, row = cell_coordinates(cell_id)
    anchor_column, anchor_row = cell_coordinates(anchor_id)
    target_column, target_row = cell_coordinates(target_id)
    column, row = column + target_column - anchor_column, row + target_row - anchor_row
    if column < 1 or row < 1:
        raise ValueError("The selection cannot be moved outside the sheet")
    return qualify(split_cell_id(target_id)[0], f"{_column_name(column)}{row}")


def _column_name(column: int) -> str:
    name = ""
    while column > 0:
        column, remainder = divmod(column - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _rewrite_markdown_references(
    source: str,
    coordinates: Mapping[str, str],
    sheet: str = "",
    sheets: Optional[Mapping[str, str]] = None,
    to_sheet: Optional[str] = None,
    aliases: Optional[Mapping[str, str]] = None,
) -> str:
    destination = sheet if to_sheet is None else to_sheet
    source = MARKDOWN_INTERPOLATION.sub(
        lambda match: "{{"
        + _rewrite_python(match.group(1), coordinates, sheet, sheets, to_sheet, aliases)
        + "}}",
        source,
    )

    def link(match: re.Match[str]) -> str:
        # Links hold full ids; a bare coordinate is on the note's own sheet.
        cell = match.group("cell")
        target = cell if "!" in cell else qualify(sheet, cell)
        moved = coordinates.get(target, target)
        if moved == target and destination == sheet:
            return match.group(0)
        new_sheet, coordinate = split_cell_id(moved)
        return match.group("prefix") + (coordinate if new_sheet == destination else moved)

    source = MARKDOWN_CELL_LINK.sub(link, source)
    scope = ReferenceScope(aliases or {}, sheet, sheets or {DEFAULT_SHEET_NAME: ""})
    first = next((name for name, prefix in scope.sheets.items() if prefix == ""), DEFAULT_SHEET_NAME)
    labels = {target: split_cell_id(key)[1] for key, target in (aliases or {}).items()}
    def label_link(match: re.Match[str]) -> str:
        reference = match.group(2)
        namespace, dot, attribute = reference.partition(".")
        target = scope.qualified(namespace, attribute) if dot else scope.label(reference)
        if target is None:
            return match.group(0)
        moved = coordinates.get(target, target)
        if split_cell_id(moved)[0] == split_cell_id(target)[0] and destination == sheet:
            return match.group(0)
        label = labels.get(target)
        if label is None or reference.split(".")[-1] != label:
            return match.group(1) + relative_reference(destination, moved, first)
        target_sheet = split_cell_id(moved)[0]
        text = label if target_sheet == destination else f"{target_sheet or first}.{label}"
        return match.group(1) + text
    return re.sub(r"(#(?:sheet-input:|note-))([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)(?=[?)\s\"'#]|$)", label_link, source)


def _normalize_packages(packages: Iterable[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    seen: set[str] = set()
    for package in packages:
        if not isinstance(package, str):
            raise TypeError("Package requirements must be strings")
        requirement = package.strip()
        if not requirement or "\n" in requirement or "\r" in requirement:
            raise ValueError("Package requirements must be non-empty single lines")
        if requirement not in seen:
            normalized.append(requirement)
            seen.add(requirement)
    return tuple(normalized)


_BUILTIN_IMPORTS = frozenset(
    {
        "import asyncio",
        "import math",
        "import statistics",
        "import numpy as np",
        "from reaktiv import ReactiveModel, computed, effect, field, resource",
        "from reaktiv import ReactiveModel, computed, effect, field, resource, linked",
        "from reaktiv import ReactiveModel, computed, effect, field, resource, action",
        "from reaktiv import ReactiveModel, computed, effect, field, resource, action, linked",
        "from reaktiv_workbook import Artifact, artifact, cell, markdown, sheet",
        # Since timers; the line above is what older files contain.
        "from reaktiv_workbook import Artifact, artifact, at, cell, every, markdown, sheet",
        # Since HTML output and widget bindings.
        "from reaktiv_workbook import Artifact, artifact, at, cell, every, html, markdown, sheet",
        "from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet",
    }
)


# Names the writer may import from `reaktiv` in a file header.
HEADER_CORE_NAMES = frozenset({"ReactiveModel", "computed", "effect", "field", "resource", "linked", "action"})


def _is_builtin_import(statement: str) -> bool:
    """The file header's own imports, which are not workbook imports. Any
    `from reaktiv_workbook import …` line counts, so a file written by a newer or older
    version (with more or fewer names) never makes the runtime import names it lacks."""
    core = re.fullmatch(r"from reaktiv import ([\w, ]+)", statement)
    return (statement in _BUILTIN_IMPORTS
            # Format 2 imports only the core decorators a file uses.
            or (core is not None and {name.strip() for name in core[1].split(",")} <= HEADER_CORE_NAMES)
            # `reactive_sheet` is the package's name in files saved before the rename; they
            # still open (statically) and are saved with `reaktiv_workbook`.
            or statement.startswith(("from reaktiv_workbook import ", "from reactive_sheet import "))
            or statement in ("from reaktiv_workbook.composition import workbook", "from reactive_sheet.composition import workbook"))


def normalize_imports(imports: Iterable[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in imports:
        if not isinstance(value, str):
            raise TypeError("Global imports must be strings")
        try:
            parsed = ast.parse(value.strip())
        except SyntaxError as error:
            raise ValueError(f"Invalid global import: {error.msg}") from error
        if len(parsed.body) != 1 or not isinstance(
            parsed.body[0], (ast.Import, ast.ImportFrom)
        ):
            raise ValueError("Each global module entry must be one import statement")
        if (
            isinstance(parsed.body[0], ast.ImportFrom)
            and parsed.body[0].module == "__future__"
        ):
            raise ValueError("__future__ directives cannot be workbook global modules")
        node = parsed.body[0]
        statements = [ast.unparse(node)]
        if isinstance(node, ast.ImportFrom) and node.module == "reaktiv":
            commands = [name for name in node.names if name.name in {"action", "BoundAction", "ActionDescriptor"}]
            if commands:
                primitives = [name for name in node.names if name not in commands]
                statements = ([ast.unparse(ast.ImportFrom(module="reaktiv", names=primitives, level=0))] if primitives else [])
                statements.append(ast.unparse(ast.ImportFrom(module="reaktiv_workbook.action", names=commands, level=0)))
        for statement in statements:
            if statement not in seen and not _is_builtin_import(statement):
                normalized.append(statement)
                seen.add(statement)
    return tuple(normalized)


def normalize_code(code: Any) -> str:
    """Shared code must be valid Python; surrounding blank lines are dropped."""
    if not isinstance(code, str):
        raise TypeError("Shared code must be a string")
    normalized = textwrap.dedent(code).strip("\n").rstrip()
    if normalized:
        try:
            ast.parse(normalized)
        except SyntaxError as error:
            raise ValueError(f"Shared code line {error.lineno}: {error.msg}") from error
    return normalized


def _normalize_variables(variables: Mapping[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in variables.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid environment variable name: {key!r}")
        if not isinstance(value, str) or "\n" in value or "\r" in value:
            raise ValueError(
                f"Environment variable {key!r} must be a single-line string"
            )
        normalized[key] = value
    return normalized


def _normalize_sizes(
    sizes: Mapping[str, int], *, minimum: int, maximum: int
) -> dict[str, int]:
    normalized: dict[str, int] = {}
    for key, size in sizes.items():
        if not isinstance(key, str) or not key:
            raise TypeError("Layout size keys must be non-empty strings")
        if (
            not isinstance(size, int)
            or isinstance(size, bool)
            or not minimum <= size <= maximum
        ):
            raise ValueError(
                f"Layout size for {key!r} must be between {minimum} and {maximum}"
            )
        normalized[key] = size
    return normalized


def _rewrite_python(
    source: str,
    coordinates: Mapping[str, str],
    sheet: str = "",
    sheets: Optional[Mapping[str, str]] = None,
    to_sheet: Optional[str] = None,
    aliases: Optional[Mapping[str, str]] = None,
    locals: frozenset[str] = frozenset(),
) -> str:
    """Rewrite coordinate references of a cell on ``sheet`` after cells moved
    (``coordinates``: old id -> new id). Bare ``A1`` resolves on the cell's own sheet,
    ``Budget.A1`` across sheets. The result is written relative to ``to_sheet`` (the
    cell's new sheet when it moved to another sheet, else ``sheet``); a cell that changes
    sheets gets every reference re-expressed so it keeps pointing at the same cells."""
    sheets = dict(sheets or {DEFAULT_SHEET_NAME: ""})
    first = next((name for name, prefix in sheets.items() if prefix == ""), DEFAULT_SHEET_NAME)
    destination = sheet if to_sheet is None else to_sheet

    def replacement(target: str) -> Optional[str]:
        if target in coordinates:
            return relative_reference(destination, coordinates[target], first)
        if destination != sheet:
            return relative_reference(destination, target, first)
        return None

    scope = ReferenceScope(aliases or {}, sheet, sheets)
    labels = {target: split_cell_id(key)[1] for key, target in (aliases or {}).items()}
    tokens = list(iter_coordinate_references(source, scope))
    if not tokens:
        return source
    lines = source.splitlines(keepends=True)
    def token_text(start: tuple[int, int], end: tuple[int, int]) -> str:
        if start[0] == end[0]:
            return lines[start[0] - 1][start[1]:end[1]]
        return lines[start[0] - 1][start[1]:] + "".join(lines[start[0]:end[0] - 1]) + lines[end[0] - 1][:end[1]]
    references = {token_text(start, end): target for start, end, target in tokens if token_text(start, end).split(".")[0] not in locals}
    try:
        references = {key: value for key, value in references.items() if key.split(".")[0] not in bound_identifiers(source)}
    except SyntaxError:
        pass
    edits: list[tuple[tuple[int, int], tuple[int, int], str]] = []
    for start, end, target in tokens:
        text = token_text(start, end)
        if text not in references:
            continue
        moved = coordinates.get(target, target)
        label = labels.get(target)
        if label is not None and text.split(".")[-1].strip() == label:
            if split_cell_id(moved)[0] == split_cell_id(target)[0] and destination == sheet:
                continue
            target_sheet = split_cell_id(moved)[0]
            updated = label if target_sheet == destination else f"{target_sheet or first}.{label}"
            if updated != text:
                edits.append((start, end, updated))
        elif (updated := replacement(target)) is not None:
            edits.append((start, end, updated))
    return _replace_source_ranges(source, edits)



def _load_python_document(source: str) -> SheetDocument:
    from .workbook_format import canonical_actions, load_document
    tree = ast.parse(source)
    from .workbook_format import is_structured
    structured = is_structured(tree)
    document = load_document(source) if structured else canonical_actions(load_legacy_model_document(source))
    metadata = read_script_metadata(source)
    if metadata is None:
        return document
    # The PEP 723 block is the dependency source when present, so `uv add --script`
    # edits are picked up; the @sheet list is kept for older app versions.
    dependencies = metadata.get("dependencies", [])
    packages = tuple(
        dependency
        for dependency in dependencies
        if isinstance(dependency, str) and dependency not in (*SCRIPT_BASE_DEPENDENCIES, *LEGACY_BASE_DEPENDENCIES)
    )
    python = _python_from_requires(metadata.get("requires-python")) or document.python
    return replace(document, packages=packages, python=python)


# File names: new workbooks are saved as `name.workbook.py`; files from before the
# Reaktiv Workbook rename (`name.sheet.py`) keep opening and saving under their name.
WORKBOOK_SUFFIX = ".workbook.py"
WORKBOOK_SUFFIXES = (WORKBOOK_SUFFIX, ".sheet.py")


def is_workbook_filename(name: str) -> bool:
    """True for `*.workbook.py` and legacy `*.sheet.py` file names."""
    return name.lower().endswith(WORKBOOK_SUFFIXES)


def workbook_stem(name: str) -> str:
    """The file name without its workbook suffix (`budget.workbook.py` -> `budget`)."""
    for suffix in WORKBOOK_SUFFIXES:
        if name.lower().endswith(suffix):
            return name[: -len(suffix)]
    return name


# PEP 723 inline script metadata (https://peps.python.org/pep-0723/): the standard way
# to declare a script's dependencies, understood by uv, pipx, and editors. Written at
# the top of every workbook file so `uv run` knows what the worksheet needs.
SCRIPT_METADATA = re.compile(
    r"(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\s(?P<content>(^#(| .*)$\s)+)^# ///$"
)
# The script must declare both distributions: core primitives alone cannot import
# workbook metadata or commands. Filter these (and legacy core requirements) on read.
# The first public versions; format 2 (`@workbook_config`) needs reaktiv-workbook 0.1.0.
SCRIPT_BASE_DEPENDENCIES = ("reaktiv>=0.25.0", "reaktiv-workbook>=0.1.0")
# Declared first by files whose code imports numpy (`np.` in a cell, or an import); derived
# from the code on save, so it is never read as one of the workbook's own packages.
NUMPY_DEPENDENCY = "numpy"
# Base requirements older files declare; read as the workbook's own, never as user packages.
LEGACY_BASE_DEPENDENCIES = (NUMPY_DEPENDENCY, "reaktiv>=0.24", "reaktiv>=0.25.0a1", "reaktiv-workbook>=0.1.0a1", "reaktiv-workbook>=0.1.0a2")


def read_script_metadata(source: str) -> Optional[dict[str, Any]]:
    """Parse the PEP 723 `script` block, or None when the file has none."""
    import tomllib

    blocks = [match for match in SCRIPT_METADATA.finditer(source) if match.group("type") == "script"]
    if not blocks:
        return None
    if len(blocks) > 1:
        raise ValueError("Multiple PEP 723 script blocks found")
    content = "".join(
        line[2:] if line.startswith("# ") else line[1:]
        for line in blocks[0].group("content").splitlines(keepends=True)
    )
    value = tomllib.loads(content)
    return value if isinstance(value, dict) else None


def script_metadata_block(packages: Iterable[str], python: str = "", *, numpy: bool = False) -> str:
    """The PEP 723 block for a workbook; ``numpy`` when its code imports numpy."""
    requires = f"=={python}.*" if python else ">=3.12"
    lines = ["# /// script", f"# requires-python = {json.dumps(requires)}", "# dependencies = ["]
    for dependency in (*((NUMPY_DEPENDENCY,) if numpy else ()), *SCRIPT_BASE_DEPENDENCIES, *packages):
        lines.append(f"#   {json.dumps(dependency)},")
    lines += ["# ]", "# ///"]
    return "\n".join(lines)


def _python_from_requires(requires: Any) -> str:
    match = re.fullmatch(r"==\s*(3\.\d{1,2})(\.\*)?", requires.strip()) if isinstance(requires, str) else None
    return match.group(1) if match else ""


class _ModelReferenceToCell(ast.NodeTransformer):
    def __init__(self, positions: Mapping[str, str]) -> None:
        self.positions = positions

    def visit_Call(self, node: ast.Call) -> ast.AST:
        transformed = self.generic_visit(node)
        if not isinstance(transformed, ast.Call):
            return transformed
        node = transformed
        if (
            not node.args
            and not node.keywords
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "value"
            and isinstance(node.func.value, ast.Attribute)
            and isinstance(node.func.value.value, ast.Name)
            and node.func.value.value.id == "self"
            and node.func.value.attr in self.positions
        ):
            return ast.copy_location(
                ast.Name(id=self.positions[node.func.value.attr], ctx=ast.Load()), node
            )
        if (
            not node.args
            and not node.keywords
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "self"
            and node.func.attr in self.positions
        ):
            return ast.copy_location(
                ast.Name(id=self.positions[node.func.attr], ctx=ast.Load()), node
            )
        return node


class _CellReferenceToModel(ast.NodeTransformer):
    def __init__(self, names: Mapping[str, str], resources: frozenset[str]) -> None:
        self.names = names
        self.resources = resources

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        # `Budget.A1` (a cell on another sheet) is keyed "Budget.A1" in names.
        if isinstance(node.ctx, ast.Load) and isinstance(node.value, ast.Name):
            key = f"{node.value.id}.{node.attr}"
            if key in self.names:
                return self._member(key, node)
        return self.generic_visit(node)

    def _member(self, key: str, node: ast.AST) -> ast.AST:
        member: ast.expr = ast.Attribute(
            value=ast.Name(id="self", ctx=ast.Load()), attr=self.names[key], ctx=ast.Load()
        )
        if key.startswith("actions."):
            return ast.copy_location(member, node)
        if key in self.resources:
            member = ast.Attribute(value=member, attr="value", ctx=ast.Load())
        return ast.copy_location(ast.Call(func=member, args=[], keywords=[]), node)

    def visit_Name(self, node: ast.Name) -> ast.AST:
        if isinstance(node.ctx, ast.Load) and node.id in self.names:
            member: ast.expr = ast.Attribute(
                value=ast.Name(id="self", ctx=ast.Load()),
                attr=self.names[node.id],
                ctx=ast.Load(),
            )
            if node.id in self.resources:
                member = ast.Attribute(
                    value=member,
                    attr="value",
                    ctx=ast.Load(),
                )
            return ast.copy_location(
                ast.Call(func=member, args=[], keywords=[]),
                node,
            )
        return node


def load_legacy_model_document(source: str) -> SheetDocument:
    try:
        module = ast.parse(source)
    except SyntaxError as error:
        raise SyntaxError(f"Invalid ReactiveModel workbook: {error.msg}") from error
    model_class: Optional[ast.ClassDef] = None
    config: Mapping[str, Any] = {}
    for statement in module.body:
        if not isinstance(statement, ast.ClassDef):
            continue
        sheet_call = next(
            (
                decorator
                for decorator in statement.decorator_list
                if isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Name)
                and decorator.func.id == "sheet"
            ),
            None,
        )
        if sheet_call is not None:
            if len(sheet_call.args) != 1:
                raise ValueError("@sheet requires one literal configuration mapping")
            value = as_mapping(ast.literal_eval(sheet_call.args[0]))
            if value is None:
                raise TypeError("@sheet configuration must be a mapping")
            config = value
            model_class = statement
            break
    if model_class is None:
        raise ValueError("Workbook must define one @sheet ReactiveModel class")

    loaders: dict[str, Union[ast.FunctionDef, ast.AsyncFunctionDef]] = {}
    for statement in model_class.body:
        if not isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in statement.decorator_list:
            if (
                isinstance(decorator, ast.Attribute)
                and decorator.attr == "loader"
                and isinstance(decorator.value, ast.Name)
            ):
                loaders[decorator.value.id] = statement

    declarations: list[tuple[str, str, str, str, bool, str, str, Any, ast.AST]] = []
    positions: dict[str, str] = {}
    for statement in model_class.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            target = statement.targets[0]
            call = statement.value
            if (
                isinstance(target, ast.Name)
                and isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == "cell"
            ):
                position = _literal_cell_position(call)
                positions[target.id] = position
                declarations.append(
                    (
                        target.id,
                        logical_cell_label(call, target.id, position),
                        position,
                        "input",
                        True,
                        "auto",
                        _literal_keyword(call, "color", ""),
                        call,
                        statement,
                    )
                )
        elif isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
            call = _cell_decorator(statement)
            if call is None:
                continue
            if statement.decorator_list[0] is not call:
                raise ValueError("@cell must be the outermost member decorator")
            position = _literal_cell_position(call)
            kind = _composed_cell_kind(statement)
            enabled = _literal_keyword(call, "enabled", True)
            trigger = _literal_keyword(call, "trigger", "auto")
            color = _literal_keyword(call, "color", "")
            positions[statement.name] = position
            declaration: ast.AST = statement
            if kind == "resource":
                loader = loaders.get(statement.name)
                if loader is None:
                    raise ValueError(
                        f"Resource cell {statement.name} requires "
                        f"@{statement.name}.loader"
                    )
                declaration = loader
            declarations.append(
                (
                    statement.name,
                    logical_cell_label(call, statement.name, position),
                    position,
                    kind,
                    enabled,
                    trigger,
                    color,
                    call,
                    declaration,
                )
            )

    labels = {member: name for member, name, *_ in declarations if name.isidentifier()}
    action_members = {item.name: "actions." + item.name for item in model_class.body if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(isinstance(marker, ast.Name) and marker.id == "action" or isinstance(marker, ast.Call) and isinstance(marker.func, ast.Name) and marker.func.id == "action" for marker in item.decorator_list)}
    cells: list[CellDefinition] = []
    for (
        _member_name,
        name,
        position,
        kind,
        enabled,
        trigger,
        color,
        view,
        declaration,
    ) in declarations:
        cell_sheet = split_cell_id(position)[0]
        first_sheet = config.get("sheetName", DEFAULT_SHEET_NAME)
        widget_references = {
            member: (labels[member] if split_cell_id(target)[0] == cell_sheet else f"{split_cell_id(target)[0] or first_sheet}.{labels[member]}")
            if member in labels else relative_reference(cell_sheet, target, first_sheet)
            for member, target in positions.items()
        }
        widget_references.update(action_members)
        assert isinstance(view, ast.Call)
        equal = _literal_keyword(view, "equal", "")
        resource_mode = _literal_keyword(view, "resource_mode", "explicit")
        save_value = _literal_keyword(view, "save_value", True)
        params_source = None
        computation_source = None
        view = _view_keyword(view, source, widget_references)
        annotation = ""
        if kind == "input" and isinstance(declaration, ast.Assign):
            source_value = _input_cell_source(source, declaration)
        else:
            assert isinstance(declaration, (ast.FunctionDef, ast.AsyncFunctionDef))
            # `self.member()` reads come back as a local or sheet-qualified label; a cell
            # without one, or whose label a local of this cell shadows, as its coordinate
            # relative to this cell's sheet (A1 / Budget.A1).
            cell_sheet = split_cell_id(position)[0]
            first_sheet = config.get("sheetName", DEFAULT_SHEET_NAME)
            local_names = _bound_names(declaration)
            relative = {
                member: (labels[member] if split_cell_id(target)[0] == cell_sheet else f"{split_cell_id(target)[0] or first_sheet}.{labels[member]}")
                if member in labels and (labels[member] if split_cell_id(target)[0] == cell_sheet else (split_cell_id(target)[0] or first_sheet)) not in local_names
                else relative_reference(cell_sheet, target, first_sheet)
                for member, target in positions.items()
            }
            relative.update(action_members)
            source_value = _model_method_source(source, declaration, kind, relative, snapshots=kind == "resource" and resource_mode == "simple")
            if kind == "resource" and resource_mode != "simple":
                parameter_method = next(item for item in model_class.body if isinstance(item, ast.FunctionDef) and item.name == _member_name)
                parameter_bound = _bound_names(parameter_method)
                parameter_relative = {member: reference if reference.startswith("actions.") or reference.split(".")[0] not in parameter_bound else relative_reference(cell_sheet, positions[member], first_sheet) for member, reference in widget_references.items()}
                params_source = _model_method_source(source, parameter_method, "formula", parameter_relative)
            if kind in ("input", "formula", "linked") and declaration.returns is not None:
                annotation = ast.get_source_segment(source, declaration.returns) or ast.unparse(declaration.returns)
        override = None
        if kind == "linked":
            assert isinstance(declaration, (ast.FunctionDef, ast.AsyncFunctionDef))
            call = _cell_decorator(declaration)
            assert call is not None
            override = _literal_keyword(call, "override", None)
            marker = next((item for item in declaration.decorator_list if isinstance(item, ast.Call) and isinstance(item.func, ast.Name) and item.func.id == "linked"), None)
            callback = next((item.value for item in marker.keywords if item.arg == "computation"), None) if marker else None
            if callback is not None:
                if not isinstance(callback, ast.Name):
                    raise ValueError("Linked computation must name a model method")
                method = next((item for item in model_class.body if isinstance(item, ast.FunctionDef) and item.name == callback.id), None)
                if method is None or [arg.arg for arg in method.args.args] != ["self", "source", "previous"]:
                    raise ValueError("Linked computation method must accept self, source, previous")
                bound = _bound_names(method)
                callback_relative = {member: reference if reference.startswith("actions.") or reference.split(".")[0] not in bound else relative_reference(cell_sheet, positions[member], first_sheet) for member, reference in widget_references.items()}
                computation_source = _model_method_source(source, method, "formula", callback_relative)
                annotation = (ast.get_source_segment(source, method.returns) or ast.unparse(method.returns)) if method.returns is not None else ""
        cells.append(
            CellDefinition(
                position,
                kind,
                source_value,
                bool(enabled),
                str(trigger),
                name,
                str(color),
                view,
                annotation,
                override,
                equal,
                params_source,
                computation_source,
                save_value,
            )
        )

    env_statement = next(
        (
            statement
            for statement in module.body
            if isinstance(statement, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "env" for target in statement.targets)
        ),
        None,
    )
    code = _shared_code(source, env_statement, model_class)
    imports_end = env_statement.lineno if env_statement is not None else model_class.lineno
    imports = tuple(
        ast.unparse(statement)
        for statement in module.body
        if isinstance(statement, (ast.Import, ast.ImportFrom))
        and statement.lineno < imports_end
        and not (
            isinstance(statement, ast.ImportFrom) and statement.module == "__future__"
        )
        and not _is_builtin_import(ast.unparse(statement))
    )
    document = _document_from_config(config, tuple(cells), imports)
    document = replace(document, actions=parse_actions(source, model_class.body, positions, as_mapping(config.get("actionBindings", {})) or {}))
    if code:
        document = replace(document, code=code)
    return document


# Comment above the shared code in .sheet.py files (mirrored in sheet-file.ts).
SHARED_CODE_MARKER = "# Shared code: functions, classes, and constants available to every cell."
SNAPSHOT_VALUE_LIMIT = 20_000


def _shared_code(source: str, env_statement: Optional[ast.stmt], model_class: ast.ClassDef) -> str:
    """The module-level code between `env = {...}` and the sheet class, as written."""
    if env_statement is None or env_statement.end_lineno is None:
        return ""
    lines = source.splitlines()
    start = env_statement.end_lineno
    end = min([model_class.lineno, *(decorator.lineno for decorator in model_class.decorator_list)]) - 1
    region = [line for line in lines[start:end] if line.strip() != SHARED_CODE_MARKER]
    return "\n".join(region).strip("\n").rstrip()


def make_snapshot(
    cells: Iterable[Mapping[str, Any]],
    dependencies: Mapping[str, Iterable[str]],
    saved_at: Optional[str] = None,
    *,
    widget_dependencies: Optional[Mapping[str, Iterable[str]]] = None,
    source_dependencies: Optional[Mapping[str, Iterable[str]]] = None,
    dependency_states: Optional[Mapping[str, str]] = None,
) -> dict[str, Any]:
    """Saved outputs for reading notes without running the graph.

    Keeps what the app needs to render notes and the grid (display, tables, plots,
    image artifacts); drops large raw values. Mirrors `makeSnapshot` in sheet-file.ts.
    """
    from datetime import datetime, timezone

    kept: list[dict[str, Any]] = []
    for cell in cells:
        entry = {
            key: cell[key]
            for key in ("id", "display", "valueType", "error", "table", "richOutput", "widget", "widgetError", "linkedOverride", "color", "colorError", "colorDependencies")
            if cell.get(key) is not None
        }
        entry.setdefault("error", None)
        artifact = as_mapping(cell.get("artifact"))
        if artifact is not None and str(artifact.get("mimeType", "")).startswith("image/"):
            entry["artifact"] = dict(artifact)
        value = cell.get("value")
        if cell.get("valueType") != "markdown" and len(json.dumps(value, default=str)) <= SNAPSHOT_VALUE_LIMIT:
            entry["value"] = value
        kept.append(entry)
    return {
        "savedAt": saved_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cells": kept,
        "dependencies": {key: list(value) for key, value in dependencies.items()},
        **({"widgetDependencies": {key: list(value) for key, value in widget_dependencies.items()}} if widget_dependencies else {}),
        **({"sourceDependencies": {key: list(value) for key, value in source_dependencies.items()}} if source_dependencies else {}),
        **({"dependencyStates": dict(dependency_states)} if dependency_states else {}),
    }


def _bound_names(function: ast.AST) -> set[str]:
    """Names a method body binds itself (assignments, loop targets, arguments, imports, defs)."""
    names: set[str] = set()
    for node in ast.walk(function):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node is not function:
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((alias.asname or alias.name).split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
    return names


def _cell_decorator(
    function: Union[ast.FunctionDef, ast.AsyncFunctionDef],
) -> Optional[ast.Call]:
    return next(
        (
            decorator
            for decorator in function.decorator_list
            if isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Name)
            and decorator.func.id == "cell"
        ),
        None,
    )


def logical_cell_label(call: ast.Call, member_name: str, position: str) -> str:
    explicit = _literal_keyword(call, "label", None)
    if explicit is not None:
        if not isinstance(explicit, str):
            raise TypeError("Cell label must be a string")
        return explicit
    slug = position.lower().replace("!", "_")  # Budget!A1 -> budget_a1
    generated = {slug, f"cell_{slug}"}
    base = re.sub(r"_\d+$", "", member_name)  # de-duplicated names get _2, _3, ...
    return "" if member_name in generated or base in generated else member_name


def _composed_cell_kind(
    function: Union[ast.FunctionDef, ast.AsyncFunctionDef],
) -> str:
    decorators: set[str] = set()
    for decorator in function.decorator_list[1:]:
        if isinstance(decorator, ast.Name):
            decorators.add(decorator.id)
        elif isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name) and decorator.func.id == "linked":
            if decorator.args or any(item.arg != "computation" for item in decorator.keywords):
                raise ValueError("@linked accepts computation=method; use @cell(equal=...) for cell equality")
            decorators.add("linked")
    matches = decorators & {"input_cell", "computed", "linked", "effect", "resource", "markdown"}
    if len(matches) != 1:
        raise ValueError(
            f"Cell {function.name} must compose @cell over exactly one of "
            "@computed, @linked, @effect, @resource, or @markdown"
        )
    behavior = matches.pop()
    return {
        "input_cell": "input",
        "computed": "formula",
        "linked": "linked",
        "effect": "effect",
        "resource": "resource",
        "markdown": "markdown",
    }[behavior]


def _literal_cell_position(call: ast.Call) -> str:
    if not call.args:
        raise ValueError("cell() requires a position")
    position = ast.literal_eval(call.args[0])
    if not isinstance(position, str) or not CELL_ID.fullmatch(position):
        raise ValueError(f"Invalid cell position: {position!r}")
    return position


def _view_keyword(call: ast.Call, source: str, references: Mapping[str, str]) -> Any:
    node = next((item.value for item in call.keywords if item.arg == "view"), None)
    if node is None:
        return None

    def read(node: ast.AST, path: tuple[str, ...] = ()) -> Any:
        if isinstance(node, ast.Dict):
            result: dict[str, Any] = {}
            for key, value in zip(node.keys, node.values):
                if key is None:
                    raise ValueError("Display settings must use explicit dictionary keys")
                name = str(ast.literal_eval(key))
                result[name] = read(value, (*path, name))
            return result
        if isinstance(node, ast.Lambda):
            args = node.args
            if path != ("color",) and path not in {("widget", key) for key in WIDGET_SETTINGS}:
                raise ValueError("Widget lambdas are supported for configurable widget fields")
            if len(args.args) != 1 or args.args[0].arg != "self" or args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg or args.defaults:
                raise ValueError("Widget settings must use lambda self: expression")
            expression = ast.get_source_segment(source, node.body)
            assert expression is not None
            expression = _rewrite_model_references(expression, references)
            # AST ranges exclude the parentheses that allow multiline lambda bodies.
            try:
                ast.parse(expression, mode="eval")
            except SyntaxError:
                expression = f"({expression})"
                ast.parse(expression, mode="eval")
            return expression if path[-1] in {"min", "max", "step", "options"} else {"expr": expression}
        return ast.literal_eval(node)

    return read(node)


def _dump_view(view: Mapping[str, Any], references: Mapping[str, str], resources: frozenset[str]) -> str:
    def dump(value: Any, path: tuple[str, ...] = ()) -> str:
        expression = widget_expression(path[-1], value) if len(path) == 2 and path[0] == "widget" and path[-1] in WIDGET_SETTINGS else None
        if path == ('color',):
            expression = widget_expression('color', value)
        if expression is not None:
            expression = _source_to_model(expression, references, resources, returns_value=False)
            return f"lambda self: ({expression})"
        mapping = as_mapping(value)
        if mapping is not None:
            return "{" + ", ".join(f"{key!r}: {dump(item, (*path, key))}" for key, item in mapping.items()) + "}"
        return repr(value)
    return dump(view)


def _literal_keyword(call: ast.Call, name: str, default: Any) -> Any:
    keyword_node = next((item for item in call.keywords if item.arg == name), None)
    return default if keyword_node is None else ast.literal_eval(keyword_node.value)


def _leading_comments(source: str, statement: ast.stmt) -> str:
    """The comment block directly above a statement (no blank line in between)."""
    lines = source.splitlines()
    index = statement.lineno - 2
    comments: list[str] = []
    while index >= 0 and lines[index].strip().startswith("#"):
        comments.insert(0, lines[index].strip())
        index -= 1
    return "".join(f"{line}\n" for line in comments)


def _input_cell_source(source: str, declaration: ast.Assign) -> str:
    assert isinstance(declaration.value, ast.Call)
    if len(declaration.value.args) < 2:
        raise ValueError("Input cell() requires a reaktiv field(default)")
    field_call = declaration.value.args[1]
    if (
        not isinstance(field_call, ast.Call)
        or not isinstance(field_call.func, ast.Name)
        or field_call.func.id != "field"
        or len(field_call.args) != 1
    ):
        raise ValueError("Input cells must use cell(position, field(default))")
    expression = field_call.args[0]
    value = ast.get_source_segment(source, expression) or ast.unparse(expression)
    # Continuation lines carry the member's indentation inside the class; drop it.
    indent = " " * declaration.col_offset
    first, *rest = value.split("\n")
    value = "\n".join([first, *(line.removeprefix(indent) for line in rest)])
    return _leading_comments(source, declaration) + value


def _model_method_source(
    source: str,
    function: Union[ast.FunctionDef, ast.AsyncFunctionDef],
    kind: str,
    positions: Mapping[str, str],
    *, snapshots: bool = False,
) -> str:
    transformer = _ModelReferenceToCell(positions)
    if kind == "markdown":
        if len(function.body) != 1 or not isinstance(function.body[0], ast.Return):
            raise ValueError(f"Markdown cell {function.name} must return one string")
        expression = function.body[0].value
        if not isinstance(expression, ast.Constant) or not isinstance(
            expression.value, str
        ):
            raise ValueError(f"Markdown cell {function.name} must return a string")
        result = inspect.cleandoc(expression.value)
        for name, position in positions.items():
            pattern = rf"\bself\.{re.escape(name)}\b" if position.startswith("actions.") else rf"\bself\.{re.escape(name)}(?:\.value)?\(\)"
            result = re.sub(pattern, position, result)
        return result

    text = _method_source_text(source, function, kind, positions, snapshots=snapshots)
    if text is not None:
        return text
    body = [
        ast.fix_missing_locations(transformer.visit(item)) for item in function.body
    ]
    if kind == "resource" and body and _is_params_boilerplate(body[0]):
        body = body[1:]
    if kind == "resource" and body and _is_cancellation_boilerplate(body[0]):
        body = body[1:]
    if len(body) == 1 and isinstance(body[0], ast.Return) and kind in ("input", "formula", "linked"):
        original_return = function.body[0]
        transformed_return = body[0]
        if not isinstance(original_return, ast.Return):
            raise ValueError(f"Formula cell {function.name} must return a value")
        assert isinstance(transformed_return, ast.Return)
        if original_return.value is None:
            return "None"
        expression_source = ast.get_source_segment(source, original_return.value)
        if expression_source is not None and "\n" in expression_source:
            return ast.unparse(transformed_return.value or ast.Constant(None))
        return _rewrite_model_references(
            expression_source or ast.unparse(original_return.value), positions
        )
    return ast.unparse(
        ast.fix_missing_locations(ast.Module(body=body, type_ignores=[]))
    )


def _method_source_text(
    source: str,
    function: Union[ast.FunctionDef, ast.AsyncFunctionDef],
    kind: str,
    positions: Mapping[str, str],
    *, snapshots: bool = False,
) -> Optional[str]:
    """A method body as the user wrote it: the original text (comments and formatting
    kept) with ``self.member()`` reads turned back into cell references. A body that is
    one ``return`` becomes its expression; longer bodies keep their ``return`` statements.
    None when the text cannot be used, so the caller falls back to rebuilding the source
    from the AST."""
    body = list(function.body)
    if body and isinstance(body[0], ast.Assign) and len(body[0].targets) == 1 and isinstance(body[0].targets[0], ast.Name) and body[0].targets[0].id == 'cells' and isinstance(body[0].value, ast.Call) and isinstance(body[0].value.func, ast.Name) and body[0].value.func.id == 'cell_refs':
        body = body[1:]
    if kind == "resource" and body and _is_params_boilerplate(body[0]):
        body = body[1:]
    if kind == "resource" and body and _is_cancellation_boilerplate(body[0]):
        body = body[1:]
    if kind == "resource" and body and _is_params_boilerplate(body[0]):
        body = body[1:]
    if not body:
        return None
    if (
        kind in ("input", "formula", "linked")
        and len(body) >= 2
        and isinstance(body[-1], ast.Return)
        and isinstance(body[-1].value, ast.Name)
        and isinstance(body[-2], (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        and body[-2].name == body[-1].value.id
    ):
        body = body[:-1]  # `return tax` after `def tax` is written for function cells
    lines = source.splitlines()
    start = body[0].lineno - 1
    while start - 1 >= function.lineno and lines[start - 1].strip().startswith("#"):
        start -= 1
    if len(body) == 1 and isinstance(body[0], ast.Pass) and lines[body[0].lineno - 1].strip() == "pass  # reaktiv: empty cell":
        return textwrap.dedent("\n".join(lines[start:body[0].lineno - 1])).strip("\n")
    segment = lines[start : body[-1].end_lineno]
    last = body[-1]
    if isinstance(last, ast.Return) and len(body) == 1 and kind in ("input", "formula", "linked", "resource"):
        index = last.lineno - 1 - start
        line = segment[index]
        column = len(line.encode()[: last.col_offset].decode())  # col_offset is in bytes
        if line[column : column + 6] != "return":
            return None
        rest = line[column + 6 :]
        rest = rest[1:] if rest.startswith(" ") else rest
        segment[index] = line[:column] + (rest if rest.strip() else "None")
    text = textwrap.dedent("\n".join(segment)).strip("\n")
    try:
        text = _rewrite_model_references(text, positions, snapshots=snapshots)
        ast.parse(text)
    except (SyntaxError, tokenize.TokenError, IndentationError):
        return None
    return text


def _is_params_boilerplate(statement: ast.AST) -> bool:
    return (
        isinstance(statement, ast.Assign)
        and len(statement.targets) == 1
        and isinstance(statement.targets[0], ast.Name)
        and statement.targets[0].id == "params"
        and isinstance(statement.value, ast.Attribute)
        and isinstance(statement.value.value, ast.Name)
        and statement.value.value.id == "resource_params"
        and statement.value.attr == "params"
    )


def _is_cancellation_boilerplate(statement: ast.AST) -> bool:
    return (
        isinstance(statement, ast.Assign)
        and len(statement.targets) == 1
        and isinstance(statement.targets[0], ast.Name)
        and statement.targets[0].id == "cancellation"
    )


def _document_from_config(
    config: Mapping[str, Any],
    cells: tuple[CellDefinition, ...],
    source_imports: tuple[str, ...] = (),
) -> SheetDocument:
    grid = as_mapping(config.get("grid", {}))
    environment = as_mapping(config.get("environment", {}))
    layout = as_mapping(config.get("layout", {}))
    if grid is None or environment is None:
        raise TypeError("Sheet grid and environment must be mappings")
    if layout is None:
        raise TypeError("Sheet layout must be a mapping")
    configured_imports = as_sequence(environment.get("imports", []))
    packages = as_sequence(environment.get("packages", []))
    variables = as_mapping(environment.get("variables", {}))
    sheets = as_sequence(config.get("sheets", []))
    column_widths = as_mapping(layout.get("columnWidths", {}))
    row_heights = as_mapping(layout.get("rowHeights", {}))
    if configured_imports is None or packages is None:
        raise TypeError("Sheet environment imports and packages must be arrays")
    if variables is None:
        raise TypeError("Sheet environment variables must be a mapping")
    if sheets is None:
        raise TypeError("Sheet sheets must be an array")
    if column_widths is None or row_heights is None:
        raise TypeError("Sheet layout sizes must be mappings")
    return SheetDocument(
        name=config.get("name", "Untitled"),
        save_outputs=config.get("saveOutputs", True),
        columns=grid.get("columns", 10),
        rows=grid.get("rows", 16),
        cells=cells,
        packages=tuple(packages),
        imports=tuple(configured_imports) + source_imports,
        variables=dict(variables),
        column_widths=dict(column_widths),
        row_heights=dict(row_heights),
        zoom=layout.get("zoom", 1.0),
        note_zoom=layout.get("noteZoom", 1.0),
        note_order=tuple(layout.get("noteOrder", ())),
        note_parents=layout.get("noteParents", {}),
        kernel=environment.get("kernel", "pyodide"),
        python=environment.get("python", ""),
        sheet_name=config.get("sheetName", DEFAULT_SHEET_NAME),
        sheets=tuple(SheetTab.from_dict(sheet) for sheet in sheets),
    )


def _sheets_config(document: "SheetDocument") -> dict[str, Any]:
    """Sheet settings for files and dicts; single-sheet defaults are omitted."""
    config: dict[str, Any] = {}
    if document.sheet_name != DEFAULT_SHEET_NAME:
        config["sheetName"] = document.sheet_name
    if document.sheets:
        config["sheets"] = [sheet.to_dict() for sheet in document.sheets]
    return config


KERNEL_KINDS = frozenset({"pyodide", "local"})


def _kernel_config(document: "SheetDocument") -> dict[str, str]:
    """Kernel settings for the file; defaults are omitted to keep files unchanged."""
    config: dict[str, str] = {}
    if document.kernel != "pyodide":
        config["kernel"] = document.kernel
    if document.python:
        config["python"] = document.python
    return config


def _cell_names(cells: Iterable[CellDefinition], reserved: Iterable[str] = ()) -> dict[str, str]:
    names: dict[str, str] = {}
    definitions = tuple(cells)
    used: set[str] = {definition.name for definition in definitions if definition.name} | set(reserved)
    assigned: set[str] = set(reserved)
    for definition in definitions:
        if definition.name and definition.name not in assigned:
            names[definition.id] = definition.name
            assigned.add(definition.name)
            continue
        slug = definition.id.lower().replace("!", "_")
        candidate = definition.name or slug
        if (
            not candidate.isidentifier()
            or keyword.iskeyword(candidate)
            or candidate in used
        ):
            candidate = f"cell_{slug}"
        suffix = 2
        unique = candidate
        while unique in used:
            unique = f"{candidate}_{suffix}"
            suffix += 1
        names[definition.id] = unique
        used.add(unique)
    return names


def _class_name(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name)
    candidate = "".join(word[:1].upper() + word[1:] for word in words) + "Sheet"
    if not candidate or not candidate.isidentifier() or keyword.iskeyword(candidate):
        return "WorkbookSheet"
    if candidate[0].isdigit():
        return f"Workbook{candidate}"
    return candidate


def _dump_model_cell(
    definition: CellDefinition,
    names: Mapping[str, str],
    resources: frozenset[str],
    loader_name: str,
    first_sheet: str = DEFAULT_SHEET_NAME,
    labels: Optional[Mapping[str, str]] = None,
) -> str:
    name = names[definition.id]
    # What each reference text means inside this cell: bare coordinates on its own
    # sheet, local labels, and `Sheet.A1` / `Sheet.label` across sheets.
    sheet = split_cell_id(definition.id)[0]
    references: dict[str, str] = {}
    resource_references_set: set[str] = set()
    for cell_id, member in names.items():
        cell_sheet, coordinate = split_cell_id(cell_id)
        keys = [f"{cell_sheet or first_sheet}.{coordinate}"]
        label = (labels or {}).get(cell_id)
        if label:
            keys.append(f"{cell_sheet or first_sheet}.{label}")
        if cell_sheet == sheet:
            keys.append(coordinate)
            if label:
                keys.append(label)
        for key in keys:
            references[key] = member
            if cell_id in resources:
                resource_references_set.add(key)
    resource_references = frozenset(resource_references_set)
    if definition.kind == "input" and _literal_input(definition.source):
        options = []
        if not definition.save_value:
            options.append("save_value=False")
        if definition.name:
            options.append(f'label="{definition.name}"')
        if definition.color:
            options.append(f'color="{definition.color}"')
        if definition.view:
            options.append(f"view={_dump_view(definition.view, references, resource_references)}")
        if definition.equal:
            options.append(f"equal={definition.equal!r}")
        suffix = "" if not options else ", " + ", ".join(options)
        comments, expression = _input_parts(definition.source)
        return f'{comments}{name} = cell("{definition.id}", field({expression}){suffix})'

    options: list[str] = []
    if not definition.save_value:
        options.append("save_value=False")
    if definition.kind == "effect":
        options.extend(
            [
                f"enabled={definition.enabled}",
                f'trigger="{definition.trigger}"',
            ]
        )
    if definition.color:
        options.append(f'color="{definition.color}"')
    if definition.name:
        options.append(f'label="{definition.name}"')
    if definition.view:
        options.append(f"view={_dump_view(definition.view, references, resource_references)}")
    if definition.kind == "linked" and definition.override is not None:
        options.append(f"override={definition.override!r}")
    if definition.equal:
        options.append(f"equal={definition.equal!r}")
    if definition.kind == "resource":
        options.append(f'resource_mode="{"simple" if definition.params is None else "explicit"}"')
    suffix = "" if not options else ", " + ", ".join(options)
    decorator = f'@cell("{definition.id}"{suffix})'

    if definition.kind == "markdown":
        markdown = _markdown_to_model(
            definition.source, references, resource_references
        )
        encoded = markdown.replace("\\", "\\\\").replace('"""', '\\"""')
        body = f'return """{encoded}"""'
        return (
            f"{decorator}\n@markdown\ndef {name}(self):\n"
            f"{textwrap.indent(body, '    ')}"
        )

    if definition.kind == "resource":
        input_ids = [key for key in _cell_references(definition.source, references) if not key.startswith("actions.")]
        input_reads = [
            f"self.{references[cell_id]}"
            + (".value()" if cell_id in resource_references else "()")
            for cell_id in input_ids
        ]
        from .source_layout import py_string
        params_body = "return {" + ", ".join(f"{py_string(references[cell_id])}: {read}" for cell_id, read in zip(input_ids, input_reads)) + "}"
        if definition.params is not None:
            params_body = _source_to_model(definition.params, references, resource_references, returns_value=True)
        body = _source_to_model(
            definition.source,
            {key: member for key, member in references.items() if definition.params is None or key not in {"params", "resource_params", "cancellation"}},
            resource_references,
            returns_value=True,
        )
        if definition.params is None:
            from .source_layout import py_string
            captured = {references[cell_id]: f"resource_params.params[{py_string(references[cell_id])}]" for cell_id in input_ids}
            body = _quote_params_in_fstrings(_rewrite_model_references(body, captured))
        else:
            body = "params = resource_params.params\n" + body
        try:
            uses_cancellation = any(
                token.type == tokenize.NAME and token.string == "cancellation"
                for token in tokenize.generate_tokens(
                    io.StringIO(definition.source).readline
                )
            )
        except (IndentationError, tokenize.TokenError):
            uses_cancellation = False
        if uses_cancellation:
            body = "cancellation = resource_params.cancellation\n" + body
        return (
            f"{decorator}\n@resource\ndef {name}(self):\n"
            f"{textwrap.indent(params_body, '    ')}\n\n"
            f"@{name}.loader\n"
            f"async def {loader_name}(self, resource_params):\n"
            f"{textwrap.indent(body, '    ')}"
        )

    if definition.kind == "linked" and definition.computation is not None:
        computation_body = _source_to_model(
            definition.computation,
            {key: member for key, member in references.items() if key not in {"source", "previous"}},
            resource_references, returns_value=True, allow_final_expression=True,
        )
        if re.search(r'\bcells\s*\.', definition.computation):
            computation_body = f'cells = cell_refs(self, {json.dumps(sheet or first_sheet)})\n' + computation_body
        source_body = _source_to_model(definition.source, references, resource_references, returns_value=True, allow_final_expression=True)
        if re.search(r'\bcells\s*\.', definition.source):
            source_body = f'cells = cell_refs(self, {json.dumps(sheet or first_sheet)})\n' + source_body
        returns = f" -> {definition.annotation}" if definition.annotation else ""
        return (
            f"def {loader_name}(self, source, previous){returns}:\n{textwrap.indent(computation_body, '    ')}\n\n"
            f"{decorator}\n@linked(computation={loader_name})\ndef {name}(self):\n{textwrap.indent(source_body, '    ')}"
        )

    behavior = "input_cell" if definition.kind == "input" else "effect" if definition.kind == "effect" else "linked" if definition.kind == "linked" else "computed"
    body = _source_to_model(
        definition.source,
        references,
        resource_references,
        returns_value=definition.kind in ("input", "formula", "linked"),
        allow_final_expression=definition.kind in ("input", "formula", "linked"),
    )
    if re.search(r'\bcells\s*\.', definition.source):
        body = f'cells = cell_refs(self, {json.dumps(sheet or first_sheet)})\n' + body
    returns = f" -> {definition.annotation}" if definition.annotation else ""
    return (
        f"{decorator}\n@{behavior}\ndef {name}(self){returns}:\n{textwrap.indent(body, '    ')}"
    )


def input_source_with_value(source: str, value_source: str) -> str:
    """Replace an input literal while preserving its comments."""
    comments, _ = _input_parts(source)
    if not comments:
        leading: list[str] = []
        for line in source.splitlines():
            if not line.lstrip().startswith("#"):
                break
            leading.append(line.strip())
        comments = "".join(line + "\n" for line in leading)
    result = comments + value_source
    if known_literal(value_source):
        # Preserve the compact analysis shape without retaining the input value.
        remember_literal(result, kind=literal_type(value_source))
    return result


def _literal_input(source: str) -> bool:
    if "\n" in source.strip() and _split_line_comment(source.strip().splitlines()[-1])[1] and not source.strip().splitlines()[-1].lstrip().startswith("#"):
        return False  # Keep a final inline comment in a method, outside field(...).
    try:
        ast.literal_eval(source.strip())
        return True
    except (ValueError, SyntaxError):
        return False


def _input_parts(source: str) -> tuple[str, str]:
    """(comment lines, field expression) for an input cell. Comment lines before or after a
    literal value, and a comment at the end of a one-line value, are written as comments above
    the member, so ``1200`` + ``# rent`` stays the number 1200 with its comment and the
    comment never ends up inside ``field(…)`` (mirrors ``inputParts`` in sheet-file.ts)."""
    lines = source.strip().splitlines()
    start = 0
    while start < len(lines) and lines[start].lstrip().startswith("#"):
        start += 1
    end = len(lines)
    while end > start and lines[end - 1].lstrip().startswith("#"):
        end -= 1
    value = "\n".join(lines[start:end]).strip()
    comments = [line.strip() for line in lines[:start] + lines[end:]]
    if value and "\n" not in value:
        value, line_comment = _split_line_comment(value)
        if line_comment:
            comments.append(line_comment)
    if comments and value:
        try:
            ast.literal_eval(value)
        except (ValueError, SyntaxError):
            pass
        else:
            return "".join(f"{line}\n" for line in comments), _single_line_strings(value)
    return "", _format_input_expression(source)


def _split_line_comment(line: str) -> tuple[str, str]:
    """``("999", "# rent")`` for ``999  # rent`` (a ``#`` inside a string is not a comment)."""
    try:
        for token in tokenize.generate_tokens(io.StringIO(line).readline):
            if token.type == tokenize.COMMENT:
                return line[: token.start[1]].rstrip(), token.string
    except (tokenize.TokenError, SyntaxError):
        pass
    return line, ""


def _format_input_expression(source: str) -> str:
    try:
        ast.literal_eval(source.strip())
    except (ValueError, SyntaxError):
        return json.dumps(source, ensure_ascii=False)
    expression = source.strip()
    # A literal whose last line ends in a comment would comment out the closing parenthesis
    # of field(…): keep such a value as text rather than write a file that cannot load.
    if _split_line_comment(expression.splitlines()[-1])[1]:
        return json.dumps(source, ensure_ascii=False)
    return _single_line_strings(expression)


def _single_line_strings(expression: str) -> str:
    """Write multi-line string literals (``\"\"\"…\"\"\"``) as one-line literals: the class body is
    indented when written, and indentation inside a string would change its value. Other
    line breaks (a list over several lines) are kept. Mirrors ``singleLineStrings``."""
    if "\n" not in expression:
        return expression
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(expression).readline))
    except (tokenize.TokenError, SyntaxError):
        return expression
    lines = expression.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    result = expression
    for token in reversed(tokens):
        if token.type == tokenize.STRING and "\n" in token.string:
            start = offsets[token.start[0] - 1] + token.start[1]
            end = offsets[token.end[0] - 1] + token.end[1]
            result = result[:start] + repr(ast.literal_eval(token.string)) + result[end:]
    return result


def _source_to_model(
    source: str,
    names: Mapping[str, str],
    resources: frozenset[str],
    *,
    returns_value: bool,
    allow_final_expression: bool = False,
) -> str:
    text = _source_to_model_text(
        source,
        names,
        resources,
        returns_value=returns_value,
        allow_final_expression=allow_final_expression,
    )
    if text is not None:
        return text
    try:
        ast.parse(source.strip(), mode="eval")
    except SyntaxError:
        module = ast.parse(source.strip(), mode="exec")
        body = module.body
        if returns_value and body and isinstance(body[-1], ast.Expr):
            body[-1] = ast.Return(value=body[-1].value)
        scoped_names, scoped_resources = _without_bound_references(
            names, resources, module
        )
        transformed = _CellReferenceToModel(scoped_names, scoped_resources).visit(
            ast.Module(body=body, type_ignores=[])
        )
        return ast.unparse(ast.fix_missing_locations(transformed))
    if "\n" in source.strip():
        parsed = ast.parse(source.strip(), mode="eval")
        transformed = _CellReferenceToModel(names, resources).visit(parsed)
        expression = ast.unparse(ast.fix_missing_locations(transformed).body)
    else:
        expression = _rewrite_cell_references(source.strip(), names, resources)
    return f"return {expression}" if returns_value else expression


def _source_to_model_text(
    source: str,
    names: Mapping[str, str],
    resources: frozenset[str],
    *,
    returns_value: bool,
    allow_final_expression: bool,
) -> Optional[str]:
    """Cell source as a method body, edited as text so comments and formatting survive
    (the TypeScript writer works the same way): references become ``self.member()``
    reads and the cell's final expression is returned (``return`` statements stay).
    None when the source does not parse; the caller then reports the error its way."""
    text = source.strip("\n").rstrip()
    text = textwrap.dedent(text)
    try:
        module = ast.parse(text)
    except SyntaxError:
        return None
    if not module.body:
        return (text + "\n" if text else "") + "pass  # reaktiv: empty cell"
    lines = text.split("\n")
    final = module.body[-1]
    if (allow_final_expression and len(module.body) >= 2 and isinstance(final, ast.Return)
            and isinstance(final.value, ast.Name)
            and isinstance(module.body[-2], (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            and module.body[-2].name == final.value.id and module.body[-2].end_lineno is not None):
        # `def x … return x` is a function cell: write it as the writer does for `def x`.
        lines = lines[:module.body[-2].end_lineno]
        final = module.body[-2]
    if returns_value:
        line = lines[final.lineno - 1]
        start = len(line.encode()[: final.col_offset].decode())
        if isinstance(final, ast.Expr):
            lines[final.lineno - 1] = f"{line[:start]}return {line[start:]}"
        elif allow_final_expression and isinstance(
            final, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            lines.extend(["", f"return {final.name}"])  # a function cell holds its definition
    scoped_names, scoped_resources = _without_bound_references(names, resources, module)
    parameters = {node.arg for node in ast.walk(module) if isinstance(node, ast.arg)}
    scoped_names = {key: value for key, value in scoped_names.items() if key not in parameters}
    try:
        return _rewrite_cell_references("\n".join(lines), scoped_names, scoped_resources)
    except (tokenize.TokenError, IndentationError):
        return None


def _rewrite_cell_references(
    source: str, names: Mapping[str, str], resources: frozenset[str]
) -> str:
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    replacements: list[tuple[tuple[int, int], tuple[int, int], str]] = []
    index = 0

    def read(key: str) -> str:
        if key.startswith("actions."):
            return "self." + key.split(".",1)[1]
        return f"self.{names[key]}" + (".value()" if key in resources else "()")

    while index < len(tokens):
        token = tokens[index]
        after_dot = index > 0 and tokens[index - 1].string == "."
        if token.type == tokenize.NAME and not after_dot:
            if index + 2 < len(tokens) and tokens[index + 1].string == ".":
                key = f"{token.string}.{tokens[index + 2].string}"
                if key in names:  # `Budget.A1`
                    replacements.append((token.start, tokens[index + 2].end, read(key)))
                    index += 3
                    continue
            keyword_argument = index + 1 < len(tokens) and tokens[index + 1].string == "="
            if token.string in names and not keyword_argument:
                replacements.append((token.start, token.end, read(token.string)))
        index += 1
    return _replace_source_ranges(source, replacements)


def _without_bound_references(
    names: Mapping[str, str], resources: frozenset[str], tree: ast.AST
) -> tuple[dict[str, str], frozenset[str]]:
    bound = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    }
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update(
                alias.asname or alias.name.split(".")[0] for alias in node.names
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
    return (
        {
            reference: member
            for reference, member in names.items()
            if reference.split(".")[0] not in bound
        },
        frozenset(reference for reference in resources if reference.split(".")[0] not in bound),
    )


def _quote_params_in_fstrings(source: str) -> str:
    """`resource_params.params["x"]` inside a double-quoted f-string uses single quotes,
    as ruff writes it (and as Python before 3.12 requires)."""
    fstring_start = getattr(tokenize, "FSTRING_START", None)
    if fstring_start is None or "resource_params.params[" not in source:
        return source
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    ranges: list[tuple[int, int]] = []
    stack: list[tuple[int, str]] = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        position = offsets[token.start[0] - 1] + token.start[1]
        if token.type == fstring_start:
            stack.append((position, token.string.lstrip("rRbBfF")[:1]))
        elif token.type == getattr(tokenize, "FSTRING_END", -1) and stack:
            start, quote = stack.pop()
            if quote == '"':
                ranges.append((start, offsets[token.end[0] - 1] + token.end[1]))
    if not ranges:
        return source
    def requote(match: re.Match[str]) -> str:
        inside = any(start <= match.start() < end for start, end in ranges)
        return f"resource_params.params['{match[1]}']" if inside else match[0]
    return re.sub(r'resource_params\.params\["(\w+)"\]', requote, source)


def _rewrite_model_references(source: str, positions: Mapping[str, str], *, snapshots: bool = False) -> str:
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    replacements: list[tuple[tuple[int, int], tuple[int, int], str]] = []
    index = 0
    while index + 2 < len(tokens):
        first, dot, member = tokens[index:index+3]
        if first.string == 'self' and dot.string == '.' and member.string in positions and positions[member.string].startswith('actions.'):
            replacements.append((first.start, member.end, positions[member.string]))
        index += 1
    index = 0
    while index + 5 < len(tokens):
        candidate = tokens[index:index + 6]
        if snapshots and [token.string for token in candidate[:4]] == ["resource_params", ".", "params", "["] and candidate[4].type == tokenize.STRING and candidate[5].string == "]":
            key = ast.literal_eval(candidate[4].string)
            if key in positions:
                replacements.append((candidate[0].start, candidate[5].end, positions[key]))
        index += 1
    index = 0
    while index + 6 < len(tokens):
        candidate = tokens[index : index + 7]
        if (
            candidate[0].type == tokenize.NAME
            and candidate[0].string == "self"
            and candidate[1].string == "."
            and candidate[2].type == tokenize.NAME
            and candidate[2].string in positions
            and not positions[candidate[2].string].startswith('actions.')
            and [token.string for token in candidate[3:]] == [".", "value", "(", ")"]
        ):
            replacements.append(
                (candidate[0].start, candidate[6].end, positions[candidate[2].string])
            )
            index += 6
        index += 1
    index = 0
    while index + 4 < len(tokens):
        candidate = tokens[index : index + 5]
        if (
            candidate[0].type == tokenize.NAME
            and candidate[0].string == "self"
            and candidate[1].string == "."
            and candidate[2].type == tokenize.NAME
            and candidate[2].string in positions
            and not positions[candidate[2].string].startswith('actions.')
            and candidate[3].string == "("
            and candidate[4].string == ")"
        ):
            replacement = (
                candidate[0].start,
                candidate[4].end,
                positions[candidate[2].string],
            )
            if replacement not in replacements:
                replacements.append(replacement)
            index += 4
        index += 1
    return _replace_source_ranges(source, replacements)


def _replace_source_ranges(
    source: str,
    replacements: Iterable[tuple[tuple[int, int], tuple[int, int], str]],
) -> str:
    lines = source.splitlines(keepends=True)
    starts: list[int] = []
    offset = 0
    for line in lines:
        starts.append(offset)
        offset += len(line)
    if not lines or not source.endswith(("\n", "\r")):
        starts.append(offset)

    def absolute(position: tuple[int, int]) -> int:
        line, column = position
        return starts[line - 1] + column

    result = source
    ranges = sorted(
        ((absolute(start), absolute(end), value) for start, end, value in replacements),
        reverse=True,
    )
    for start, end, value in ranges:
        result = result[:start] + value + result[end:]
    return result


def _markdown_to_model(
    source: str, names: Mapping[str, str], resources: frozenset[str]
) -> str:
    def replace(match: re.Match[str]) -> str:
        expression = match.group(1).strip()
        try:
            parsed = ast.parse(expression, mode="eval")
            transformed = _CellReferenceToModel(names, resources).visit(parsed)
            return (
                "{{ " + ast.unparse(ast.fix_missing_locations(transformed).body) + " }}"
            )
        except SyntaxError:
            return match.group(0)

    return MARKDOWN_INTERPOLATION.sub(replace, source)


def _cell_references(
    source: str, allowed: Optional[Mapping[str, str]] = None
) -> list[str]:
    try:
        parsed = ast.parse(source.strip(), mode="exec")
    except SyntaxError:
        return []
    scoped = allowed
    if allowed is not None:
        scoped = _without_bound_references(allowed, frozenset(), parsed)[0]
    candidates = [
        node.id
        for node in ast.walk(parsed)
        if isinstance(node, ast.Name)
        and isinstance(node.ctx, ast.Load)
        and (
            node.id in scoped
            if scoped is not None
            else CELL_ID.fullmatch(node.id) is not None
        )
    ]
    if scoped is not None:  # `Budget.A1` references to other sheets
        candidates += [
            f"{node.value.id}.{node.attr}"
            for node in ast.walk(parsed)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and f"{node.value.id}.{node.attr}" in scoped
        ]
    if allowed is None:
        return sorted(set(candidates), key=_cell_sort_key)
    result: list[str] = []
    members: set[str] = set()
    for reference in candidates:
        member = allowed[reference]
        if member not in members:
            result.append(reference)
            members.add(member)
    return result


def dump_legacy_python_document(document: SheetDocument) -> str:
    config = {
        "name": document.name,
        **({"saveOutputs": False} if not document.save_outputs else {}),
        **({"actionBindings": {item.name:item.bindings for item in document.actions if item.bindings}} if any(item.bindings for item in document.actions) else {}),
        "grid": {"columns": document.columns, "rows": document.rows},
        "environment": {
            "packages": list(document.packages),
            "variables": dict(document.variables),
            **_kernel_config(document),
        },
        "layout": {
            "columnWidths": document.column_widths,
            "rowHeights": document.row_heights,
            "zoom": document.zoom,
            "noteZoom": document.note_zoom,
            **({"noteOrder": list(document.note_order)} if document.note_order else {}),
            **({"noteParents": dict(document.note_parents)} if document.note_parents else {}),
        },
        **_sheets_config(document),
    }
    names = {**_cell_names(document.cells, {method.name for method in document.actions}), **{"actions." + item.name:item.name for item in document.actions if item.exposed}}
    labels = {cell.id: cell.name for cell in document.cells if cell.name}
    resources = frozenset(
        definition.id for definition in document.cells if definition.kind == "resource"
    )
    used_member_names = set(names.values()) | {method.name for method in document.actions}
    loader_names: dict[str, str] = {}
    for resource_id in sorted(resources | {cell.id for cell in document.cells if cell.computation is not None}):
        candidate = f"_{names[resource_id]}_{'loader' if resource_id in resources else 'computation'}"
        while candidate in used_member_names:
            candidate = "_" + candidate
        loader_names[resource_id] = candidate
        used_member_names.add(candidate)
    blocks = [
        script_metadata_block(document.packages, document.python),
        '"""Executable ReactiveModel workbook for Reaktiv Workbook."""',
        "",
        "import asyncio",
        "import math",
        "import statistics",
        "import numpy as np",
        *document.imports,
        "",
        "from reaktiv import ReactiveModel, computed, effect, field, resource" + (", linked" if any(cell.kind == "linked" for cell in document.cells) else ""),
        "from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet" + (", action" if document.actions else "") + (", input_cell" if any(cell.kind == "input" and not _literal_input(cell.source) for cell in document.cells) else "") + (", cell_refs" if any(re.search(r'\bcells\s*\.', cell.source) or re.search(r'\bcells\s*\.', cell.computation or '') for cell in document.cells) else ""),
        "",
        "env = " + json.dumps(document.variables, ensure_ascii=False),
        "",
        *([SHARED_CODE_MARKER, document.code, "", ""] if document.code else []),
        "@sheet(" + (repr(config) if "actionBindings" in config or "saveOutputs" in config else json.dumps(config, ensure_ascii=False, separators=(",", ":"))) + ")",
        f"class {_class_name(document.name)}(ReactiveModel):",
    ]
    if not document.cells:
        blocks.append("    pass")
    for definition in document.cells:
        blocks.extend(
            [
                "",
                textwrap.indent(
                    _dump_model_cell(
                        definition,
                        names,
                        resources,
                        loader_names.get(definition.id, ""),
                        document.sheet_name,
                        labels,
                    ),
                    "    ",
                ),
            ]
        )
    for method in document.actions:
        blocks.extend(["", *(["    @action" + ("(label=" + repr(method.label) + ")" if method.label else "")] if method.exposed else []), textwrap.indent(rewrite_members(method, names), "    ")])
    blocks.extend(
        [
            "",
            "",
            "if __name__ == '__main__':",
            "    from reaktiv_workbook.cli import main",
            "    raise SystemExit(main([__file__]))",
        ]
    )
    return "\n".join(blocks).rstrip() + "\n"


def cell_member_names(cells: Iterable[CellDefinition], reserved: Iterable[str] = ()) -> dict[str, str]:
    """Return the Python member names used when serializing cells."""
    return _cell_names(cells, reserved)
