from dataclasses import replace
import pytest
from reaktiv_workbook import (
    ActionDefinition,
    CellDefinition,
    ReactiveWorkbook,
    SheetDocument,
)
from reaktiv_workbook.model import move_cell_group, move_cells, verify_written_document


def command_document():
    return SheetDocument(
        cells=(
            CellDefinition("A1", "input", "1", name="count"),
            CellDefinition("A2", "input", "3", name="batch"),
            CellDefinition(
                "B1",
                "input",
                "0",
                name="add_one",
                view={
                    "widget": {
                        "type": "button",
                        "action": "add",
                        "actionArguments": {"amount": {"value": 1}},
                    }
                },
            ),
            CellDefinition(
                "B2",
                "input",
                "0",
                name="add_batch",
                view={
                    "widget": {
                        "type": "button",
                        "action": "add",
                        "actionArguments": {"amount": {"cell": "A2"}},
                    }
                },
            ),
            CellDefinition(
                "B3",
                "input",
                "0",
                name="add_default",
                view={
                    "widget": {
                        "type": "button",
                        "action": "add",
                        "actionArguments": {"amount": {"default": True}},
                    }
                },
            ),
        ),
        actions=(
            ActionDefinition(
                "add",
                "def add(self, amount: int = 2):\n    self.count.set(self.count() + amount)\n    return self.count()",
                references={"count": "A1"},
                bindings={"amount": {"value": 50}},
            ),
        ),
    )


def value(snapshot, cell_id):
    return next(cell for cell in snapshot.cells if cell["id"] == cell_id)


@pytest.mark.asyncio
async def test_buttons_are_configuration_and_invoke_with_distinct_arguments():
    w = ReactiveWorkbook()
    try:
        doc = command_document()
        assert verify_written_document(doc.dumps(), doc.to_dict()) == []
        assert SheetDocument.loads(doc.dumps()) == __import__("reaktiv_workbook.workbook_format", fromlist=["canonical_actions"]).canonical_actions(doc)
        snapshot = await w.load_document_async(doc)
        assert value(snapshot, "A1")["value"] == 1
        assert snapshot.actions[0]["status"] == "idle"
        for button_id, expected in [("B1", 2), ("B2", 5), ("B3", 7)]:
            widget = value(snapshot, button_id)["widget"]
            assert widget["buttonMode"] == "action"
            snapshot = await w.run_action_async(
                widget["action"], widget["actionArguments"]
            )
            assert value(snapshot, "A1")["value"] == expected
            assert value(snapshot, button_id)["value"] == 0
        assert not any(cell.id.startswith("B") for cell in snapshot.cell_changes)
        # Cell arguments are resolved on each invocation, not saved as snapshots.
        w.apply(
            [
                replace(cell, source="5") if cell.id == "A2" else cell
                for cell in w.document.cells
            ]
        )
        snapshot = await w.run_action_async("add", {"amount": {"cell": "A2"}})
        assert value(snapshot, "A1")["value"] == 12
    finally:
        w.close()


def test_move_and_swap_remap_bindings_but_keep_literal_data():
    doc = command_document()
    cells = (
        *doc.cells,
        CellDefinition(
            "C1",
            "input",
            "0",
            view={
                "widget": {
                    "type": "button",
                    "action": "add",
                    "actionArguments": {"amount": {"value": "A2"}},
                }
            },
        ),
    )
    moved = move_cells(cells, "A2", "A3")
    assert next(cell for cell in moved if cell.id == "B2").view["widget"][
        "actionArguments"
    ]["amount"] == {"cell": "A3"}
    assert next(cell for cell in moved if cell.id == "C1").view["widget"][
        "actionArguments"
    ]["amount"] == {"value": "A2"}
    swapped = move_cells(cells, "A2", "A1")
    assert next(cell for cell in swapped if cell.id == "B2").view["widget"][
        "actionArguments"
    ]["amount"] == {"cell": "A1"}
    cross_sheet = move_cell_group(cells, ["A2"], "A2", "Other!A4", ["Sheet1", "Other"])
    assert next(cell for cell in cross_sheet if cell.id == "B2").view["widget"][
        "actionArguments"
    ]["amount"] == {"cell": "Other!A4"}


@pytest.mark.asyncio
async def test_unknown_actions_and_parameters_are_widget_errors_and_recover():
    w = ReactiveWorkbook()
    try:
        doc = command_document()
        for widget in [
            {"type": "button", "action": "missing"},
            {
                "type": "button",
                "action": "add",
                "actionArguments": {"unknown": {"value": 1}},
            },
        ]:
            cells = tuple(
                replace(cell, view={"widget": widget}) if cell.id == "B1" else cell
                for cell in doc.cells
            )
            snapshot = await w.load_document_async(replace(doc, cells=cells))
            assert value(snapshot, "B1")["widgetError"]
            assert value(snapshot, "A1")["value"] == 1
        snapshot = await w.load_document_async(doc)
        assert "widgetError" not in value(snapshot, "B1")
        with pytest.raises(ValueError, match="default binding"):
            await w.run_action_async("add", {"amount": {"default": False}})
    finally:
        w.close()


@pytest.mark.parametrize(
    "widget",
    [
        {"type": "button", "action": "add()"},
        {"type": "text", "action": "add"},
        {"type": "button", "action": "add", "actionArguments": {"amount": {"cell": 3}}},
        {
            "type": "button",
            "action": "add",
            "actionArguments": {"amount": {"value": 1, "cell": "A1"}},
        },
    ],
)
def test_invalid_button_bindings_are_rejected_without_execution(widget):
    with pytest.raises((ValueError, TypeError)):
        CellDefinition("A1", "input", "0", view={"widget": widget})


@pytest.mark.asyncio
async def test_run_cancel_button_setting_survives_serialization_and_runtime():
    doc = command_document()
    doc = replace(doc, cells=tuple(replace(cell, view={"widget": {"type": "button", "action": "add", "cancelWhileRunning": True}}) if cell.id == "B1" else cell for cell in doc.cells))
    loaded = SheetDocument.loads(doc.dumps())
    assert verify_written_document(doc.dumps(), doc.to_dict()) == []
    button = next(cell for cell in loaded.cells if cell.id == "B1")
    assert button.view is not None
    assert button.view["widget"]["cancelWhileRunning"] is True
    workbook = ReactiveWorkbook()
    try:
        snapshot = await workbook.load_document_async(loaded)
        assert value(snapshot, "B1")["widget"]["cancelWhileRunning"] is True
        assert value(snapshot, "A1")["value"] == 1
    finally:
        workbook.close()


def test_run_cancel_setting_requires_boolean_and_action_button():
    from reaktiv_workbook.widget_config import normalize_widget
    for widget in ({"type": "button", "action": "add", "cancelWhileRunning": "yes"}, {"type": "checkbox", "cancelWhileRunning": True}):
        with pytest.raises(ValueError, match="cancelWhileRunning"):
            normalize_widget(widget)
