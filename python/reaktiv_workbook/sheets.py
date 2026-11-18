"""Multiple sheets in one workbook.

Cell ids: cells on the first sheet keep plain coordinates (``A1``) so existing files stay
valid; cells on other sheets are qualified (``Budget!A1``). In Python sources:

- a cell label (``rent``) refers to the referencing cell's own sheet;
- a bare coordinate (``A1``) refers to the referencing cell's own sheet;
- ``Budget.rent`` or ``Budget.A1`` refers to a cell on another sheet (the first sheet by its name too).

All sheets share one reactive graph, so references across sheets are ordinary
dependencies.
"""

from __future__ import annotations

import keyword
import re
import tokenize
from dataclasses import dataclass, field
from typing import Callable, Iterator, Mapping, Optional

from .source_analysis import reference_windows
from .narrowing import as_mapping

DEFAULT_SHEET_NAME = "Sheet1"
SHEET_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
COORDINATE = re.compile(r"[A-Z]+[1-9][0-9]*")


def split_cell_id(cell_id: str) -> tuple[str, str]:
    """``"Budget!A1"`` → ``("Budget", "A1")``; first-sheet ids have an empty sheet."""
    sheet, separator, coordinate = cell_id.rpartition("!")
    return (sheet, coordinate) if separator else ("", cell_id)


def qualify(sheet: str, coordinate: str) -> str:
    return f"{sheet}!{coordinate}" if sheet else coordinate


def valid_sheet_name(name: str) -> bool:
    return SHEET_NAME.fullmatch(name) is not None and not keyword.iskeyword(name) and name != 'cells'


def relative_reference(from_sheet: str, target_id: str, first_sheet_name: str) -> str:
    """How a cell on ``from_sheet`` writes a reference to ``target_id``."""
    sheet, coordinate = split_cell_id(target_id)
    if sheet == from_sheet:
        return coordinate
    return f"{sheet or first_sheet_name}.{coordinate}"


def sheet_prefixes(first_sheet_name: str, extra_sheets: tuple[str, ...]) -> dict[str, str]:
    """Sheet name → id prefix ('' for the first sheet)."""
    prefixes = {name: name for name in extra_sheets}
    prefixes[first_sheet_name] = ""
    return prefixes


@dataclass(frozen=True)
class ReferenceScope:
    """What a name means inside one cell: labels, its own sheet, and the sheet names."""

    aliases: Mapping[str, str] = field(default_factory=dict[str, str])
    sheet: str = ""
    sheets: Mapping[str, str] = field(default_factory=dict[str, str])

    def coordinate(self, name: str) -> Optional[str]:
        """Cell id for a bare coordinate token, resolved on this cell's sheet."""
        return qualify(self.sheet, name) if COORDINATE.fullmatch(name) else None

    def label(self, name: str) -> Optional[str]:
        return self.aliases.get(qualify(self.sheet, name))

    def qualified(self, sheet_name: str, attribute: str) -> Optional[str]:
        """Cell id for ``Sheet.A1`` / ``Sheet.label``, or None when it is not a sheet reference."""
        if sheet_name in self.sheets:
            prefix = self.sheets[sheet_name]
            if COORDINATE.fullmatch(attribute):
                return qualify(prefix, attribute)
            return self.aliases.get(qualify(prefix, attribute))
        return None


def as_scope(value: object) -> ReferenceScope:
    if isinstance(value, ReferenceScope):
        return value
    aliases = as_mapping(value)
    return ReferenceScope(aliases={name: str(cell_id) for name, cell_id in aliases.items()} if aliases is not None else {})


def iter_coordinate_references(
    source: str, scope: ReferenceScope
) -> Iterator[tuple[tuple[int, int], tuple[int, int], str]]:
    """(start, end, cell id) for every coordinate reference token in Python source:
    bare ``A1`` (own sheet) and ``Sheet.A1``; ``obj.A1`` attributes are skipped."""
    for token, following in reference_windows(source):
        if token.string == 'cells' and len(following) >= 2 and following[0].string == '.' and following[1].type == tokenize.NAME:
            name = following[1]
            if len(following) >= 4 and following[2].string == '.' and following[3].type == tokenize.NAME:
                target = scope.qualified(name.string, following[3].string)
                if target is not None:
                    yield name.start, following[3].end, target
                    continue
            target = scope.coordinate(name.string) or scope.label(name.string)
            if target is not None:
                yield name.start, name.end, target
                continue
        if len(following) >= 2 and following[0].string == '.' and following[1].type == tokenize.NAME:
            target = scope.qualified(token.string, following[1].string)
            if target is not None:
                yield token.start, following[1].end, target
                continue
        target = scope.coordinate(token.string) or scope.label(token.string)
        if target is not None and not (following and following[0].string == '='):
            yield token.start, token.end, target


def rewrite_coordinate_references(
    source: str,
    scope: ReferenceScope,
    replacement: Callable[[str], Optional[str]],
) -> str:
    """Replace coordinate references for which ``replacement(cell_id)`` returns text."""
    edits: list[tuple[tuple[int, int], tuple[int, int], str]] = []
    for start, end, target in iter_coordinate_references(source, scope):
        text = replacement(target)
        if text is not None:
            edits.append((start, end, text))
    if not edits:
        return source
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))

    def absolute(position: tuple[int, int]) -> int:
        return offsets[position[0] - 1] + position[1]

    result = source
    for start, end, text in sorted(edits, reverse=True):
        result = result[: absolute(start)] + text + result[absolute(end) :]
    return result
