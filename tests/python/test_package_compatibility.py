"""Files saved under the earlier `reactive_sheet` name still open and save with the new name."""

import importlib
from pathlib import Path

import pytest

import reaktiv_workbook
from reaktiv_workbook.model import CellDefinition, SheetDocument


FIXTURES = Path(__file__).parents[1] / "fixtures/workbooks"


def test_files_saved_before_the_rename_open_and_save_with_the_new_name():
    """`reactive_sheet` was the package's earlier name: such files are read statically
    (the package itself is gone) and saved with `reaktiv_workbook` imports."""
    path = FIXTURES / "legacy-pre-rename/coordinates.app.sheet.py"
    assert "from reactive_sheet import" in path.read_text()
    loaded = SheetDocument.load(path)
    assert loaded.cells == SheetDocument.loads(written).cells if (written := loaded.dumps()) else False
    assert not any("reactive_sheet" in line for line in loaded.imports)
    written = loaded.dumps()
    assert "from reaktiv_workbook import" in written and "reactive_sheet" not in written
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("reactive_sheet")


@pytest.mark.asyncio
async def test_legacy_core_action_header_opens_and_resaves_without_core_actions():
    from reaktiv_workbook import ActionDefinition, ReactiveWorkbook

    document = SheetDocument(
        name="Legacy actions",
        cells=[CellDefinition(id="A1", kind="input", source="1", name="count")],
        actions=[
            ActionDefinition(
                "increment",
                "def increment(self):\n    self.count.set(self.count() + 1)",
                references={"count": "A1"},
            )
        ],
    )
    canonical = document.dumps()
    legacy = (
        canonical.replace(
            "from reaktiv import ReactiveModel, computed, effect, field, resource",
            "from reaktiv import ReactiveModel, computed, effect, field, resource, action",
        )
        .replace("sheet, action", "sheet")
        .replace("reaktiv_workbook", "reactive_sheet")
    )
    loaded = SheetDocument.loads(legacy)
    workbook = ReactiveWorkbook()
    try:
        await workbook.load_document_async(loaded)
        await workbook.run_action_async("increment")
        assert workbook._last_values["A1"] == 2
        assert (
            "from reaktiv import ReactiveModel, computed, effect, field, resource, action"
            not in loaded.dumps()
        )
        assert "from reaktiv_workbook import" in loaded.dumps()
    finally:
        workbook.close()


def test_handwritten_legacy_core_action_imports_preserve_aliases():
    from reaktiv_workbook.model import normalize_imports

    imports = normalize_imports(
        ["from reaktiv import Signal, action as command, BoundAction"]
    )
    assert imports == (
        "from reaktiv import Signal",
        "from reaktiv_workbook.action import action as command, BoundAction",
    )
    namespace = {}
    for statement in imports:
        exec(statement, namespace)
    assert namespace["command"] is reaktiv_workbook.action


def test_legacy_script_requirements_are_read_without_becoming_user_packages():
    source = SheetDocument(name="Legacy requirements").dumps()
    source = source.replace('"reaktiv>=0.25.0"', '"reaktiv>=0.24"').replace('#   "reaktiv-workbook>=0.1.0",\n', '')
    loaded = SheetDocument.loads(source)
    assert loaded.packages == ()
    assert '"reaktiv-workbook>=0.1.0"' in loaded.dumps()


def test_files_declaring_the_previous_workbook_minimum_upgrade_it_without_a_user_package():
    source = SheetDocument(name="Old minimum").dumps().replace('"reaktiv-workbook>=0.1.0"', '"reaktiv-workbook>=0.1.0a1"')
    loaded = SheetDocument.loads(source)
    assert loaded.packages == ()
    assert '"reaktiv-workbook>=0.1.0"' in loaded.dumps() and '0.1.0a1' not in loaded.dumps()
