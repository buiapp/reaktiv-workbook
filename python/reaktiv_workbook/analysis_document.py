"""Small, non-executed language-service documents; never modify live input data."""
from __future__ import annotations

import ast
from dataclasses import replace
from .model import SheetDocument, CellDefinition
from .source_analysis import literal_type, remember_literal

LIMIT = 4096
ANY = '_ReaktivSheetAnalysisData'
SHAPES = {
    'list': f'list[{ANY}]()', 'dict': f'dict[{ANY}, {ANY}]()',
    'tuple': f'tuple[{ANY}, ...]()', 'set': f'set[{ANY}]()',
    'str': "''", 'bytes': "b''", 'int': '0', 'float': '0.0',
    'complex': '0j', 'bool': 'False', 'NoneType': 'None',
}


def analysis_document(document: SheetDocument) -> SheetDocument:
    cells: list[CellDefinition] = []
    compacted = False
    for cell in document.cells:
        if cell.kind == 'input' and len(cell.source) > LIMIT:
            shape = literal_type(cell.source)
            if shape is None:
                try:
                    value = ast.literal_eval(cell.source)
                except (SyntaxError, ValueError, TypeError, RecursionError):
                    cells.append(cell)
                    continue
                remember_literal(cell.source, value)
                shape = type(value).__name__
            if shape in SHAPES:
                cell = replace(cell, source=SHAPES[shape])
                compacted = True
        cells.append(cell)
    if not compacted:
        return document
    imports = (*document.imports, f'from typing import Any as {ANY}')
    return replace(document, cells=tuple(cells), imports=imports, snapshot=None)
