"""Workbooks open as they were typed and saved.

tests/fixtures/workbooks/cases.json holds workbooks as the user types them. The app's Python-backed serialization boundary
turns each into ``<name>.app.sheet.py`` (frontend/src/app/sheet-file.workbooks.spec.ts keeps those
files current); the same Python implementation is also exercised directly. Loading either file must give
back every cell as typed (``loads`` lists the few that load differently), with the same
values, and the app's save check must accept the app's file.
"""

import asyncio
from dataclasses import replace
import json
from pathlib import Path

import pytest

from reaktiv_workbook import ReactiveWorkbook
from reaktiv_workbook.model import FORMAT_NAME, FORMAT_VERSION, SheetDocument, verify_written_document

FIXTURES = Path(__file__).parents[1] / "fixtures" / "workbooks"
EXAMPLES = Path(__file__).parents[2] / "examples"
CASES = json.loads((FIXTURES / "cases.json").read_text())["cases"]


def typed_document(case):
    """The workbook as the app holds it before saving."""
    return SheetDocument.from_dict(
        {
            "format": FORMAT_NAME,
            "version": FORMAT_VERSION,
            "name": case["name"],
            "grid": {"columns": 10, "rows": 16},
            "environment": {"packages": [], "imports": case.get("imports", []), "code": case.get("code", "")},
            "cells": case["cells"],
            "layout": case.get("layout", {}),
            **({"sheetName": case["sheetName"]} if "sheetName" in case else {}),
            "sheets": case.get("sheets", []),
            "actions": case.get("actions", []),
        }
    )


def cell_view(document):
    return {cell.id: (cell.kind, cell.name, cell.enabled, cell.annotation, cell.source) for cell in document.cells}


def results(document):
    workbook = ReactiveWorkbook()
    try:
        snapshot = asyncio.run(workbook.load_document_async(document))
        return {cell["id"]: (cell.get("display"), cell.get("error")) for cell in snapshot.cells}
    finally:
        workbook.close()


def written_files(case):
    typed = typed_document(case)
    return {"app": (FIXTURES / f"{case['name']}.app.sheet.py").read_text(), "python": typed.dumps()}


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
@pytest.mark.parametrize("writer", ["app", "python"])
def test_saved_workbooks_open_with_every_cell_as_typed(case, writer):
    typed = typed_document(case)
    expected = cell_view(typed)
    for cell_id, source in case.get("loads", {}).items():
        kind, name, enabled, annotation, _ = expected[cell_id]
        expected[cell_id] = (kind, name, enabled, annotation, source)

    loaded = SheetDocument.loads(written_files(case)[writer])

    assert cell_view(loaded) == expected
    assert {cell.id: cell.override for cell in loaded.cells} == {cell.id: cell.override for cell in typed.cells}
    assert {cell.id: cell.view for cell in loaded.cells} == {cell.id: cell.view for cell in typed.cells}
    assert {cell.id: cell.params for cell in loaded.cells} == {cell.id: cell.params for cell in typed.cells}
    assert {cell.id: cell.save_value for cell in loaded.cells} == {cell.id: cell.save_value for cell in typed.cells}
    assert loaded.note_parents == typed.note_parents and loaded.note_order == typed.note_order
    assert loaded.imports == typed.imports and loaded.code == typed.code
    assert (loaded.sheet_name, loaded.sheets) == (typed.sheet_name, typed.sheets)
    # Saving again and opening again changes nothing.
    assert SheetDocument.loads(loaded.dumps()) == loaded


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_saved_workbooks_calculate_the_same_values(case):
    typed = typed_document(case)
    before = results(typed)
    assert not [cell_id for cell_id, (_, error) in before.items() if error], before
    for writer, text in written_files(case).items():
        assert results(SheetDocument.loads(text)) == before, writer


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_save_check_accepts_what_the_app_writes(case):
    app_file = written_files(case)["app"]
    assert verify_written_document(app_file, typed_document(case).to_dict()) == []


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_app_and_this_package_write_the_same_workbook(case):
    files = written_files(case)
    assert SheetDocument.loads(files["app"]) == SheetDocument.loads(files["python"])


@pytest.mark.parametrize("path", sorted(EXAMPLES.rglob("*.workbook.py")), ids=lambda path: path.name)
def test_examples_survive_saving_and_opening_again(path):
    document = replace(SheetDocument.load(path), snapshot=None)  # Source round trips independently of its output sidecar.
    reopened = SheetDocument.loads(document.dumps())
    assert reopened == document
    assert SheetDocument.loads(reopened.dumps()) == reopened


def test_documents_from_the_app_are_checked_before_use():
    base = {"format": FORMAT_NAME, "version": FORMAT_VERSION, "cells": []}
    with pytest.raises(TypeError, match="sheets must be an array"):
        SheetDocument.from_dict({**base, "sheets": "Budget"})
    with pytest.raises(TypeError, match="sheet must be an object"):
        SheetDocument.from_dict({**base, "sheets": ["Budget"]})
    with pytest.raises(TypeError, match="layout sizes"):
        SheetDocument.from_dict({**base, "layout": {"columnWidths": [1]}})


def test_the_kernel_refuses_malformed_requests():
    from reaktiv_workbook.runtime import RuntimeServer

    server = RuntimeServer()
    try:
        with pytest.raises(TypeError, match="sheets must be an array of sheet names"):
            server.dispatch("/v1/move-cells", {"cells": [], "sourceId": "A1", "targetId": "B1", "sheets": "Main"})
        with pytest.raises(TypeError, match="stopped must be an array of cell ids"):
            server.dispatch("/v1/apply", {"cells": [], "stopped": "A1"})
        with pytest.raises(TypeError, match="imports must be an array of strings"):
            server.dispatch("/v1/apply", {"cells": [], "imports": [1]})
    finally:
        server.close()
