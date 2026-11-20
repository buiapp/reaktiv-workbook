import base64
import asyncio
import io
import json
import re
from dataclasses import replace
from pathlib import Path

import pytest

from reaktiv import ReactiveModel, ResourceStatus, computed, effect, field, resource
from reaktiv_workbook import (
    CellDefinition,
    ReactiveWorkbook,
    SheetDocument,
    artifact,
    cell,
    markdown,
    move_cell_group,
    move_cells,
    sheet,
)
from reaktiv_workbook.cli import main
from reaktiv_workbook import widgets
from reaktiv_workbook.model import split_cell_id
from reaktiv_workbook.browser import inspect_document
from reaktiv_workbook.runtime import RuntimeServer


def cells(*items):
    return [CellDefinition(*item) for item in items]


def result(snapshot, cell_id):
    return next(cell for cell in snapshot.cells if cell["id"] == cell_id)


def effect_result(snapshot, cell_id):
    return next(item for item in snapshot.effects if item["id"] == cell_id)


def test_sheet_decorators_extend_reactive_model_without_core_changes():
    events = []

    @sheet({"name": "Decorated model"})
    class Model(ReactiveModel):
        amount = cell("A1", field(2))

        @cell("B1")
        @computed
        def doubled(self):
            return self.amount() * 2

        @cell("C1")
        @markdown
        def summary(self):
            return """# Result

            {{ self.doubled() }}"""

        @cell("D1")
        @effect
        def record(self):
            events.append(self.doubled())

    model = Model()

    assert model.doubled() == 4
    assert model.summary() == "# Result\n\n4"
    assert events == [4]
    model.amount.set(3)
    assert model.doubled() == 6
    assert events == [4, 6]
    assert getattr(Model, "__reaktiv_workbook__")["name"] == "Decorated model"
    model.dispose()


def test_composable_cell_contract_rejects_plain_methods_and_manual_effects():
    with pytest.raises(TypeError, match="outermost"):

        class InvalidModel(ReactiveModel):
            @cell("A1")
            def plain(self):
                return 1

    # Manual effects were removed: an old file says what to do instead of running them.
    with pytest.raises(ValueError, match="move the code of effect B1 into an action"):

        @sheet({"name": "Manual effect"})
        class ManualModel(ReactiveModel):
            amount = cell("A1", field(2))

            @cell("B1", trigger="manual")
            @effect
            def record(self):
                return self.amount()

    # trigger="auto", which older files write on every effect, is accepted.
    events = []

    @sheet({"name": "Automatic effect"})
    class AutoModel(ReactiveModel):
        amount = cell("A1", field(2))

        @cell("B1", trigger="auto")
        @effect
        def record(self):
            events.append(self.amount())

    model = AutoModel()
    model.record
    assert events == [2]
    model.dispose()


@pytest.mark.asyncio
async def test_sheet_resource_decorator_uses_named_reactive_inputs():
    @sheet({"name": "Resource model"})
    class Model(ReactiveModel):
        amount = cell("A1", field(2))

        @cell("B1")
        @resource
        def loaded(self):
            return (self.amount(),)

        @loaded.loader
        async def _load(self, resource_params):
            await asyncio.sleep(0)
            return self.amount() * 3

    model = Model()
    resource_instance = model.loaded
    for _ in range(10):
        if resource_instance.status() == ResourceStatus.RESOLVED:
            break
        await asyncio.sleep(0)

    assert resource_instance.value() == 6
    model.amount.set(4)
    for _ in range(10):
        await asyncio.sleep(0)
        if (
            resource_instance.status() == ResourceStatus.RESOLVED
            and resource_instance.value() == 12
        ):
            break
    assert resource_instance.value() == 12
    model.dispose()


def test_formula_replacement_is_fine_grained_and_reconnects_dependents():
    workbook = ReactiveWorkbook()
    model = cells(
        ("A1", "input", "2"),
        ("B1", "input", "5"),
        ("A2", "formula", "A1 * 2"),
        ("A3", "effect", "print(A2)"),
        ("B2", "markdown", "Value: {{ A2 }}"),
    )
    first = workbook.apply(model)
    slot = workbook._slots["A2"]
    unchanged_input = workbook._nodes["B1"]
    unchanged_effect = workbook._effects["A3"]

    model[2] = CellDefinition("A2", "formula", "B1 * 3")
    second = workbook.apply(model)

    assert first.rebuilt is True
    assert second.rebuilt is False
    assert second.changed == ("A2",)
    assert result(second, "A2")["value"] == 15
    assert result(second, "B2")["value"] == "Value: 15"
    assert effect_result(second, "A3")["output"] == "15"
    assert effect_result(second, "A3")["triggerCount"] == 2
    assert second.dependencies["A2"] == ["B1"]
    assert workbook._slots["A2"] is slot
    assert workbook._nodes["B1"] is unchanged_input
    assert workbook._effects["A3"] is unchanged_effect


def test_input_value_change_keeps_nodes_and_only_propagates_to_dependents():
    workbook = ReactiveWorkbook()
    model = [
        CellDefinition("A1", "input", "2", name="amount"),
        CellDefinition("B1", "formula", "amount * 3", name="total"),
        CellDefinition("C1", "input", "99", name="unrelated"),
    ]
    first = workbook.apply(model)
    amount_node = workbook._nodes["A1"]
    total_node = workbook._nodes["B1"]
    unrelated_node = workbook._nodes["C1"]

    model[0] = CellDefinition("A1", "input", "4", name="amount")
    second = workbook.apply(model)

    assert first.dependencies["B1"] == ["A1"]
    assert second.changed == ("A1",)
    assert result(second, "B1")["value"] == 12
    assert workbook._nodes["A1"] is amount_node
    assert workbook._nodes["B1"] is total_node
    assert workbook._nodes["C1"] is unrelated_node


def test_html_output_from_html_and_repr_html_but_tables_stay_tables():
    pd = pytest.importorskip("pandas")

    class Badge:
        def _repr_html_(self):
            return "<span class='badge'>3 open</span>"

    workbook = ReactiveWorkbook({"badge": Badge(), "frame_data": pd.DataFrame({"a": [1]})})
    snapshot = workbook.apply(
        cells(
            ("A1", "formula", "html(f\"<b>{2 + 3}</b> tasks\")"),
            ("A2", "formula", "badge"),
            ("A3", "formula", "frame_data"),
            ("B1", "markdown", "Board {{ A1 }} and {{ A2 }}"),
        )
    )
    board = result(snapshot, "A1")
    assert board["display"] == "HTML"
    assert board["richOutput"] == {"mimeType": "text/html", "dataBase64": base64.b64encode(b"<b>5</b> tasks").decode()}
    assert base64.b64decode(result(snapshot, "A2")["richOutput"]["dataBase64"]) == b"<span class='badge'>3 open</span>"
    assert "richOutput" not in result(snapshot, "A3") or result(snapshot, "A3")["richOutput"] is None
    assert result(snapshot, "A3")["table"]["kind"] == "DataFrame"
    assert result(snapshot, "B1")["value"] == "Board ![HTML](#cell-A1) and ![HTML](#cell-A2)"
    # Self-contained notes (CLI --note, --export) carry the HTML itself.
    assert workbook.render_note("B1") == "Board <b>5</b> tasks and <span class='badge'>3 open</span>"
    workbook.close()


def test_rich_image_results_render_without_becoming_download_artifacts():
    class Plot:
        def _repr_mimebundle_(self):
            return {"image/png": "iVBORw0KGgo="}, {"image/png": {"width": 320}}

    workbook = ReactiveWorkbook({"plot": Plot()})
    snapshot = workbook.apply(
        cells(
            ("A1", "formula", "plot"),
            ("B1", "markdown", "# Plot\n\n{{ A1 }}"),
        )
    )

    plot = result(snapshot, "A1")
    assert plot["valueType"] == "rich-output"
    assert plot["display"] == "Plot"
    assert plot["richOutput"] == {
        "mimeType": "image/png",
        "dataBase64": "iVBORw0KGgo=",
    }
    assert "artifact" not in plot
    assert result(snapshot, "B1")["value"] == "# Plot\n\n![Plot](#cell-A1)"
    assert "data:image/png;base64,iVBORw0KGgo=" in workbook.render_note("B1")
    workbook.close()


def test_matplotlib_figure_protocol_is_adapted_without_importing_matplotlib():
    class Figure:
        __module__ = "matplotlib.figure"

        def savefig(self, output, **_options):
            output.write(b"generated-png")

    workbook = ReactiveWorkbook({"figure": Figure()})
    snapshot = workbook.apply(cells(("A1", "formula", "figure")))

    plot = result(snapshot, "A1")
    assert plot["valueType"] == "rich-output"
    assert plot["richOutput"] == {
        "mimeType": "image/png",
        "dataBase64": "Z2VuZXJhdGVkLXBuZw==",
    }
    workbook.close()


def test_moving_a_labeled_cell_only_reconnects_label_dependents():
    workbook = ReactiveWorkbook()
    model = [
        CellDefinition("A1", "input", "10", name="revenue"),
        CellDefinition("B1", "formula", "revenue * 2", name="forecast"),
        CellDefinition("C1", "input", "7", name="unrelated"),
    ]
    workbook.apply(model)
    unrelated_node = workbook._nodes["C1"]

    moved = move_cells(model, "A1", "D4")
    snapshot = workbook.apply(moved)

    assert snapshot.changed == ("A1", "B1", "D4")
    assert snapshot.dependencies["B1"] == ["D4"]
    assert result(snapshot, "B1")["value"] == 20
    assert workbook._nodes["C1"] is unrelated_node


def test_artifact_cell_serializes_files_and_renders_images_in_markdown():
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(
        cells(
            ("A1", "formula", "artifact(b'png-bytes', 'forecast.png', 'image/png')"),
            ("B1", "markdown", "# Forecast\n\n{{ A1 }}"),
        )
    )

    artifact_result = result(snapshot, "A1")
    assert artifact_result["display"] == "forecast.png"
    assert artifact_result["valueType"] == "artifact"
    assert artifact_result["value"] == {
        "filename": "forecast.png",
        "mimeType": "image/png",
        "size": 9,
        "sha256": artifact_result["artifact"]["sha256"],
    }
    assert artifact_result["artifact"]["dataBase64"] == "cG5nLWJ5dGVz"
    assert result(snapshot, "B1")["value"] == "# Forecast\n\n![forecast.png](#cell-A1)"
    assert (
        "![forecast.png](data:image/png;base64,cG5nLWJ5dGVz)"
        in workbook.render_note("B1")
    )
    assert snapshot.dependencies["B1"] == ["A1"]

    @sheet({"name": "Artifact model"})
    class Model(ReactiveModel):
        @cell("A1")
        @computed
        def image(self):
            return artifact(b"png-bytes", "forecast.png", "image/png")

        @cell("B1")
        @markdown
        def note(self):
            return "{{ self.image() }}"

    model = Model()
    assert model.note() == "![forecast.png](data:image/png;base64,cG5nLWJ5dGVz)"
    model.dispose()


def test_artifact_accepts_a_library_neutral_bytes_buffer():
    output = io.BytesIO()
    output.write(b"rendered")
    value = artifact(output, "chart.png", "image/png")

    assert value.data == b"rendered"
    assert value.filename == "chart.png"
    assert value.media_type == "image/png"
    assert artifact("report", "report.txt").media_type == "text/plain"


def test_equal_formula_replacement_does_not_trigger_downstream_effect():
    workbook = ReactiveWorkbook()
    model = cells(
        ("A1", "input", "2"),
        ("A2", "formula", "A1 * 2"),
        ("A3", "effect", "print(A2)"),
    )
    workbook.apply(model)
    model[1] = CellDefinition("A2", "formula", "A1 + A1")

    snapshot = workbook.apply(model)

    assert result(snapshot, "A2")["value"] == 4
    assert effect_result(snapshot, "A3")["triggerCount"] == 1


def test_multiline_formula_and_effect_rerun_support_workflow_steps():
    workbook = ReactiveWorkbook()
    model = [
        CellDefinition("A1", "input", "3"),
        CellDefinition(
            "A2",
            "formula",
            "intermediate = A1 * 4\nprint('formula ready')\nreturn intermediate + 1",
        ),
        CellDefinition("A3", "effect", "print(f'published:{A2}')"),
    ]

    initial = workbook.apply(model)
    executed = workbook.run_effect("A3")

    assert result(initial, "A2")["value"] == 13
    assert effect_result(initial, "A3")["output"] == "published:13"
    assert effect_result(executed, "A3")["triggerCount"] == effect_result(initial, "A3")["triggerCount"] + 1
    assert effect_result(executed, "A3")["output"] == "published:13"
    assert effect_result(executed, "A3")["status"] == "succeeded"
    assert effect_result(executed, "A3")["durationMs"] is not None
    assert [entry["message"] for entry in executed.logs] == [
        "formula ready",
        "published:13",
        "published:13",
    ]
    assert workbook.clear_logs().logs == ()


def test_multiline_formula_uses_its_final_expression_as_output():
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(
        [
            CellDefinition("A1", "input", "3", name="amount"),
            CellDefinition(
                "A2",
                "formula",
                "intermediate = amount * 4\nprint('formula ready')\nintermediate + 1",
                name="total",
            ),
        ]
    )

    assert result(snapshot, "A2")["value"] == 13
    assert result(snapshot, "A2")["durationMs"] is not None
    assert result(snapshot, "A1")["durationMs"] is not None
    assert snapshot.dependencies["A2"] == ["A1"]
    assert [entry["message"] for entry in snapshot.logs] == ["formula ready"]
    workbook.close()


@pytest.mark.asyncio
async def test_resource_cell_awaits_and_reloads_from_reactive_dependencies():
    workbook = ReactiveWorkbook()
    model = [
        CellDefinition("A1", "input", "2"),
        CellDefinition(
            "B1",
            "resource",
            "await asyncio.sleep(0.001)\nprint(f'loaded:{A1}')\nreturn A1 * 4",
        ),
        CellDefinition("C1", "formula", "B1 + 1"),
    ]

    first = await workbook.apply_async(model)
    resource = workbook._resources["B1"]
    model[0] = CellDefinition("A1", "input", "3")
    second = await workbook.apply_async(model)

    assert result(first, "B1")["value"] == 8
    assert result(first, "B1")["resourceStatus"] == "resolved"
    assert result(first, "C1")["value"] == 9
    assert result(second, "B1")["value"] == 12
    assert result(second, "C1")["value"] == 13
    assert workbook._resources["B1"] is resource
    assert [entry["message"] for entry in second.logs] == ["loaded:2", "loaded:3"]


@pytest.mark.asyncio
async def test_environment_variables_invalidate_formulas_and_resources_in_place():
    workbook = ReactiveWorkbook()
    model = [
        CellDefinition("A1", "formula", "int(env['FACTOR']) * 2"),
        CellDefinition(
            "B1", "resource", "await asyncio.sleep(0)\nreturn env['LABEL']"
        ),
    ]

    first = await workbook.apply_async(
        model, variables={"FACTOR": "3", "LABEL": "first"}
    )
    formula = workbook._nodes["A1"]
    resource = workbook._resources["B1"]
    second = await workbook.apply_async(
        model, variables={"FACTOR": "4", "LABEL": "second"}
    )

    assert result(first, "A1")["value"] == 6
    assert result(second, "A1")["value"] == 8
    assert result(second, "B1")["value"] == "second"
    assert workbook._nodes["A1"] is formula
    assert workbook._resources["B1"] is resource


@pytest.mark.asyncio
async def test_cells_return_anywhere_and_their_last_expression_is_the_value(tmp_path):
    model = named_cells(
        ("A1", "input", "[1, 2, 3]", "data"),
        ("A2", "formula", "if not data:\n    return None\ntotal = sum(data)\nreturn total * 2", "early"),
        ("A3", "formula", "total = sum(data)\ntotal + 1", "last"),
        ("A4", "formula", "return 7", "single"),
        ("A5", "formula", "x = 5", "nothing"),
        ("A6", "effect", "if not data:\n    return\nprint('total', sum(data))"),
        ("A7", "resource", "await asyncio.sleep(0)\nif not data:\n    return []\n[v * 10 for v in data]", "loaded"),
        ("B1", "formula", "1 / 0\nreturn 1", "broken"),
    )
    workbook = ReactiveWorkbook()
    snapshot = await workbook.apply_async(model)
    values = {cell["id"]: cell["value"] for cell in snapshot.cells}
    assert values["A2"] == 12 and values["A3"] == 7 and values["A4"] == 7
    assert values["A5"] is None and values["A7"] == [10, 20, 30]
    assert any(log["message"] == "total 6" for log in snapshot.logs)
    # The wrapper function is not part of the traceback.
    traceback = result(snapshot, "B1")["errorDetail"]["traceback"]
    assert "__formula__" not in traceback and traceback.count("Cell B1") == 1

    snapshot = await workbook.apply_async([CellDefinition("A1", "input", "[]", name="data"), *model[1:]])
    values = {cell["id"]: cell["value"] for cell in snapshot.cells}
    assert values["A2"] is None and values["A7"] == []
    workbook.close()

    # The file keeps `return` statements; a single `return` loads as its expression.
    path = tmp_path / "returns.sheet.py"
    SheetDocument(cells=tuple(model)).save(path)
    loaded = {cell.id: cell.source for cell in SheetDocument.load(path).cells}
    assert loaded["A2"] == "if not data:\n    return None\ntotal = sum(data)\nreturn total * 2"
    assert loaded["A3"] == "total = sum(data)\nreturn total + 1"
    assert loaded["A4"] == "7"
    assert loaded["A6"] == "if not data:\n    return\nprint('total', sum(data))"


def test_removed_dependency_recovers_when_cell_is_added_again():
    workbook = ReactiveWorkbook()
    model = cells(("A1", "input", "3"), ("A2", "formula", "A1 + 1"))
    workbook.apply(model)

    missing = workbook.apply(model[1:])
    restored = workbook.apply(model)

    assert "KeyError" in result(missing, "A2")["error"]
    assert result(restored, "A2")["value"] == 4


def test_removed_cells_release_their_values():
    import gc
    import weakref

    class Big:
        pass

    made = []

    def make():
        value = Big()
        made.append(weakref.ref(value))
        return value

    workbook = ReactiveWorkbook({"make": make})
    workbook.apply(cells(("A1", "formula", "make()"), ("A2", "formula", "1")))
    workbook.apply(cells(("A2", "formula", "1")))
    gc.collect()
    assert made[0]() is None

    # Also when another cell still refers to the removed one.
    workbook.apply(cells(("A1", "formula", "make()"), ("A2", "formula", "A1")))
    workbook.apply(cells(("A2", "formula", "A1")))
    gc.collect()
    assert made[1]() is None


def test_move_rewrites_python_names_but_not_labels_comments_or_markdown_prose():
    model = [
        CellDefinition("A1", "input", "10"),
        CellDefinition("B1", "formula", "A1 * 2"),
        CellDefinition("C1", "effect", 'print(f"value:{A1}", "A1")  # A1'),
        CellDefinition(
            "D1",
            "markdown",
            "A1 prose; value {{ A1 + B1 }}\n"
            "[Input](#sheet-input:A1?type=number)\n"
            "[Details](#cell-A1)",
        ),
        CellDefinition("E1", "resource", "await asyncio.sleep(0)\nreturn A1"),
        # Links to another note follow the moved note (by id) and stay as they are (by label).
        CellDefinition("F1", "markdown", "[Back](#note-A1) [Intro](#note-intro)"),
    ]

    moved = {cell.id: cell for cell in move_cells(model, "A1", "A2")}

    assert moved["B1"].source == "A2 * 2"
    assert moved["C1"].source == 'print(f"value:{A2}", "A1")  # A1'
    assert moved["D1"].source == (
        "A1 prose; value {{ A2 + B1 }}\n"
        "[Input](#sheet-input:A2?type=number)\n"
        "[Details](#cell-A2)"
    )
    assert moved["E1"].source == "await asyncio.sleep(0)\nreturn A2"
    assert moved["F1"].source == "[Back](#note-A2) [Intro](#note-intro)"


def test_swap_rewrites_references_simultaneously():
    model = [
        CellDefinition("A1", "input", "10"),
        CellDefinition("B1", "formula", "A1 * 2"),
        CellDefinition("C1", "formula", "A1+B1"),
    ]

    moved = {cell.id: cell for cell in move_cells(model, "A1", "B1")}

    assert moved["A1"].source == "B1 * 2"
    assert moved["C1"].source == "B1+A1"


def test_model_names_stay_semantic_when_a_cell_moves():
    document = SheetDocument(
        name="Named model",
        columns=6,
        rows=8,
        cells=(
            CellDefinition("A1", "input", "10", name="revenue"),
            CellDefinition("B1", "formula", "A1 * 2", name="forecast"),
        ),
    )

    moved = SheetDocument(
        name=document.name,
        columns=document.columns,
        rows=document.rows,
        cells=move_cells(document.cells, "A1", "D4"),
    )
    source = moved.dumps()

    assert 'revenue = cell("D4", field(10), label="revenue")' in source
    assert "return self.revenue() * 2" in source
    # References load as the label the file reads (`self.revenue()`), not the new coordinate.
    loaded = SheetDocument.loads(source)
    assert [cell.source for cell in loaded.cells] == ["revenue * 2", "10"]
    assert loaded == replace(moved, cells=tuple(
        replace(cell, source="revenue * 2") if cell.id == "B1" else cell for cell in moved.cells
    ))


def test_python_document_round_trip_and_removed_json_format(tmp_path):
    document = SheetDocument(
        name="Forecast",
        columns=12,
        rows=30,
        cells=tuple(
            cells(
                ("A1", "input", "125000"),
                ("A2", "formula", "A1 * .2"),
                (
                    "A3",
                    "formula",
                    "subtotal = A2 * 2\nreturn subtotal + 1",
                ),
            )
        ),
        packages=("pandas==2.3.2", "httpx>=0.28"),
        imports=("import pandas as pd", "from datetime import date"),
        variables={"REGION": "eu", "EMPTY": ""},
        column_widths={"A": 180},
        row_heights={"1": 72},
        zoom=1.25,
        note_zoom=1.3,
    )
    path = tmp_path / "forecast.sheet.py"

    document.save(path)

    assert SheetDocument.load(path) == document
    assert "class ForecastWorkbook(Workbook):" in path.read_text()
    assert '@cell("A2")' in path.read_text()
    assert "subtotal = self.a2() * 2" in path.read_text()
    assert "import pandas as pd\nfrom datetime import date" in path.read_text()
    with pytest.raises(ValueError, match="ReactiveModel"):
        SheetDocument.loads(json.dumps(document.to_dict()))
    with pytest.raises(ValueError, match="ReactiveModel"):
        SheetDocument.loads("# %% [input A1]\ndef A1():\n    return 1")
    with pytest.raises(ValueError, match="must compose"):
        SheetDocument.loads(
            '@sheet({"name":"Old","grid":{"columns":1,"rows":1}})\n'
            "class OldSheet(ReactiveModel):\n"
            '    @cell("A1")\n'
            "    def value(self):\n"
            "        return 1\n"
        )


def test_references_load_as_labels_unless_a_local_shadows_them():
    document = SheetDocument(
        name="Labels",
        cells=(
            CellDefinition("A1", "input", "2", name="rate"),
            CellDefinition("A2", "formula", "A1 * 3", name="tripled"),
            CellDefinition("A3", "formula", "rate = 5\nreturn rate + A1"),
            CellDefinition("A4", "formula", "[A1 * x for x in range(3)]"),
        ),
    )
    loaded = {cell.id: cell.source for cell in SheetDocument.loads(document.dumps()).cells}
    assert loaded["A2"] == "rate * 3"
    assert loaded["A3"] == "rate = 5\nreturn rate + A1"  # the local `rate` wins over the label
    assert loaded["A4"] == "[rate * x for x in range(3)]"


def test_cell_color_round_trips_through_python_decorators():
    document = SheetDocument(
        name="Highlighted",
        cells=(
            CellDefinition("A1", "input", "2", name="amount", color="#CDE7AE"),
            CellDefinition("A2", "formula", "amount * 2", name="total", color="#d8c9ef"),
        ),
        note_zoom=1.2,
    )

    source = document.dumps()
    restored = SheetDocument.loads(source)

    assert 'cell("A1", field(2), label="amount", color="#cde7ae")' in source
    assert '@cell("A2", color="#d8c9ef", label="total")' in source
    assert restored == document


def test_unlabeled_cells_round_trip_and_old_coordinate_members_become_unlabeled():
    document = SheetDocument(
        name="Coordinates",
        cells=(
            CellDefinition("A1", "input", "2"),
            CellDefinition("B1", "formula", "A1 * 3"),
        ),
    )

    source = document.dumps()
    restored = SheetDocument.loads(source)

    assert 'a1 = cell("A1", field(2))' in source
    assert "label=" not in source
    assert restored == document
    assert all(cell.name == "" for cell in restored.cells)


def test_group_move_rewrites_coordinate_references_atomically():
    model = [
        CellDefinition("A1", "input", "10"),
        CellDefinition("B1", "formula", "A1 * 2"),
        CellDefinition("D1", "formula", "A1 + B1"),
    ]

    moved = {cell.id: cell for cell in move_cell_group(model, ["A1", "B1"], "A1", "A2")}

    assert moved["B2"].source == "A2 * 2"
    assert moved["D1"].source == "A2 + B2"
    with pytest.raises(ValueError, match="overwrite"):
        move_cell_group(model, ["A1", "B1"], "A1", "C1")


def test_global_imports_are_shared_and_replacing_them_recomputes_cells():
    workbook = ReactiveWorkbook()
    model = cells(("A1", "formula", "operation(1.2)"))

    first = workbook.apply(model, imports=("from math import floor as operation",))
    second = workbook.apply(model, imports=("from math import ceil as operation",))

    assert result(first, "A1")["value"] == 1
    assert result(second, "A1")["value"] == 2
    assert second.changed == ("A1",)
    assert workbook.document.imports == ("from math import ceil as operation",)


def test_cli_evaluates_overrides_and_can_save(tmp_path, capsys):
    source = tmp_path / "source.sheet.py"
    saved = tmp_path / "saved.sheet.py"
    SheetDocument(
        name="CLI model",
        cells=tuple(cells(("A1", "input", "2"), ("A2", "formula", "A1 * 4"))),
    ).save(source)

    assert main([str(source), "--set", "A1=3", "--save", str(saved)]) == 0

    assert "A2\t12" in capsys.readouterr().out
    assert (
        next(cell for cell in SheetDocument.load(saved).cells if cell.id == "A1").source
        == "3"
    )


def test_cli_prints_document_requirements(tmp_path, capsys):
    source = tmp_path / "workflow.sheet.py"
    SheetDocument(name="Workflow", packages=("httpx>=0.28", "pydantic==2.11.9")).save(
        source
    )

    assert main([str(source), "--requirements"]) == 0
    assert capsys.readouterr().out.splitlines() == ["httpx>=0.28", "pydantic==2.11.9"]


def test_large_values_are_sent_without_their_raw_data():
    """A big array would make every snapshot huge (a 361 MB response for a dict of measurement
    arrays): its raw value is left out, its display stays."""
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(
        named_cells(
            ("A1", "formula", "import numpy as np\nreturn {'l1': np.zeros(2_000_000), 'l2': np.ones(3)}", "big"),
            ("A2", "formula", "import numpy as np\nreturn np.arange(5)", "small"),
            ("A3", "formula", "[[0] * 200] * 200", "nested"),
            ("A4", "formula", "len(big['l1'])", "uses_big"),
        )
    )
    big = result(snapshot, "A1")
    assert big["value"] is None and big["display"] and big["valueType"] == "dict"
    assert result(snapshot, "A2")["value"] == [0, 1, 2, 3, 4]
    assert result(snapshot, "A3")["value"] is None  # 40 000 items in nested lists
    assert result(snapshot, "A4")["value"] == 2_000_000  # the graph still has the data
    assert len(json.dumps(snapshot.to_dict())) < 100_000


@pytest.mark.asyncio
async def test_progress_reports_each_cell_starting_and_ending():
    events = []
    workbook = ReactiveWorkbook()
    workbook.progress = lambda event, cell_id: events.append((event, cell_id))
    await workbook.apply_async(
        named_cells(
            ("A1", "input", "2", "x"),
            ("A2", "formula", "x * 10", "tens"),
            ("A3", "formula", "tens + 1", "total"),
            ("A4", "effect", "print(total)"),
            ("A5", "resource", "await asyncio.sleep(0)\nreturn x", "loaded"),
            ("A6", "markdown", "Total {{ total }}"),
        )
    )
    # Initializers and computed cells each report their execution.
    for cell_id in ("A1", "A2", "A3", "A4", "A5", "A6"):
        assert events.count(("start", cell_id)) == 1 and events.count(("end", cell_id)) == 1
    # A cell that reads another waits for it: the inner one starts and ends inside it.
    outer, inner = events.index(("start", "A3")), events.index(("start", "A2"))
    assert outer < inner < events.index(("end", "A2")) < events.index(("end", "A3"))

    # An edit reports only what recomputes.
    events.clear()
    await workbook.apply_async(
        named_cells(
            ("A1", "input", "2", "x"),
            ("A2", "formula", "x * 10", "tens"),
            ("A3", "formula", "tens + 2", "total"),
            ("A4", "effect", "print(total)"),
            ("A5", "resource", "await asyncio.sleep(0)\nreturn x", "loaded"),
            ("A6", "markdown", "Total {{ total }}"),
        )
    )
    assert {cell_id for _, cell_id in events} == {"A3", "A4", "A6"}
    workbook.close()


def test_http_kernel_answers_progress_with_numbered_events():
    server = RuntimeServer()
    start = server.dispatch("/v1/progress", {})
    assert start["events"] == []
    server.dispatch("/v1/apply", {"cells": [CellDefinition("A1", "formula", "1 + 1").to_dict()]})
    progress = server.dispatch("/v1/progress", {"after": start["seq"]})
    assert [(item["event"], item["cellId"]) for item in progress["events"]] == [("start", "A1"), ("end", "A1")]
    assert server.dispatch("/v1/progress", {"after": progress["seq"]})["events"] == []
    # A restarted kernel keeps reporting.
    server.dispatch("/v1/restart", {})
    server.dispatch("/v1/apply", {"cells": [CellDefinition("A1", "formula", "2 + 2").to_dict()]})
    assert server.dispatch("/v1/progress", {"after": progress["seq"]})["events"][-1]["event"] == "end"
    server.close()


def test_remote_runtime_dispatches_the_same_workbook_api():
    server = RuntimeServer()
    model = [
        CellDefinition("A1", "input", "4").to_dict(),
        CellDefinition("A2", "formula", "A1 * 5").to_dict(),
        CellDefinition(
            "B1", "resource", "await asyncio.sleep(0)\nreturn A2 + 1"
        ).to_dict(),
        CellDefinition("C1", "formula", "env['REGION']").to_dict(),
        CellDefinition("D1", "formula", "floor(A1 / 3)").to_dict(),
    ]

    snapshot = server.dispatch(
        "/v1/apply",
        {
            "cells": model,
            "variables": {"REGION": "eu"},
            "imports": ["from math import floor"],
        },
    )
    moved = server.dispatch(
        "/v1/move-cells",
        {"cells": model, "sourceId": "A1", "targetId": "B1"},
    )
    formatted_source = """@sheet(
    {
        "name": "Formatted",
        "grid": {"columns": 2, "rows": 2},
    }
)
class FormattedSheet(ReactiveModel):
    amount = cell(
        "A1",
        field(2),
    )
"""
    inspected = server.dispatch(
        "/v1/inspect-document",
        {"source": formatted_source},
    )

    assert next(cell for cell in snapshot["cells"] if cell["id"] == "A2")["value"] == 20
    assert next(cell for cell in snapshot["cells"] if cell["id"] == "B1")["value"] == 21
    assert (
        next(cell for cell in snapshot["cells"] if cell["id"] == "C1")["value"] == "eu"
    )
    assert next(cell for cell in snapshot["cells"] if cell["id"] == "D1")["value"] == 1
    assert next(cell for cell in moved if cell["id"] == "A2")["source"] == "B1 * 5"
    assert inspected["name"] == "Formatted"
    assert inspected["cells"][0]["source"] == "2"
    assert json.loads(inspect_document(formatted_source)) == inspected
    assert server.dispatch("/v1/restart", {}) == {"status": "restarted"}
    assert (
        server.dispatch(
            "/v1/apply", {"cells": model, "imports": ["from math import floor"]}
        )["rebuilt"]
        is True
    )
    server.close()


def test_example_documents_are_valid_and_dashboard_runs():
    examples = Path(__file__).parents[2] / "examples"
    documents = {
        path.name: SheetDocument.load(path)
        for pattern in ("*.workbook.py", "features/*.workbook.py")
        for path in examples.glob(pattern)
    }

    assert set(documents) == {
        "welcome.workbook.py",
        "budget.workbook.py",
        "signal-lab.workbook.py",
        "model-fit.workbook.py",
        "async-resource.workbook.py",
        "model-actions.workbook.py",
        "reactive-widget-controls.workbook.py",
        "financial-model.workbook.py",
        "plot-artifacts.workbook.py",
        "sales-performance-dashboard.workbook.py",
        "personal-life-dashboard.workbook.py",
        "plotly-dashboard.workbook.py",
        "anywidget-demo.workbook.py",
        "scheduled-pipeline.workbook.py",
        "trip-planner-app.workbook.py",
        "wave-laboratory.workbook.py",
        "vectors.workbook.py",
        "binary-search.workbook.py",
        "calorie-coach.workbook.py",
        "project-planner.workbook.py",
    }
    assert all(
        SheetDocument.loads(document.dumps()) == document
        for document in documents.values()
    )
    commands = ReactiveWorkbook()
    command_snapshot = asyncio.run(commands.load_document_async(documents["model-actions.workbook.py"]))
    assert result(command_snapshot, "A1")["value"] == 1
    assert len(command_snapshot.actions) == 3
    command_snapshot = asyncio.run(commands.run_action_async("add_items"))
    assert result(command_snapshot, "A1")["value"] == 4
    assert result(command_snapshot, "B1")["value"] == 50.0
    commands.close()
    dashboard = documents["sales-performance-dashboard.workbook.py"]
    report = next(cell for cell in dashboard.cells if cell.id == "E1")
    assert "\n| KPI | Current view |\n| --- | ---: |\n| Net sales |" in report.source
    assert (
        "\n| Channel | Share of net sales |\n| --- | ---: |\n| Direct |"
        in report.source
    )
    workbook = ReactiveWorkbook()
    snapshot = asyncio.run(workbook.load_document_async(dashboard))
    assert result(snapshot, "B2")["value"]["net_sales"] == "$1,555,000"
    assert result(snapshot, "B3")["value"]["status"] == "On track"
    workbook.close()

    coach = documents["calorie-coach.workbook.py"]
    assert coach.sheet_names == ("Profile", "Energy", "Plan", "Nutrition", "CheckIn")
    workbook = ReactiveWorkbook()
    snapshot = asyncio.run(workbook.load_document_async(coach))
    workbook.close()
    assert not [cell["id"] for cell in snapshot.cells if cell["error"]]
    values = {cell.name: result(snapshot, cell.id)["value"] for cell in coach.cells if cell.name}
    assert values["bmr"] == 1512  # Mifflin-St Jeor: woman, 34 years, 170 cm, 78 kg
    assert values["tdee"] == 1914
    assert values["target_calories"] == 1480  # -0.5 % of body weight a week
    assert (values["protein_g"], values["fat_g"], values["carbs_g"]) == (140, 49, 120)
    assert values["weeks_to_goal"] == 24
    assert values["checkin_advice"].startswith("On track")
    names = {cell.id: cell.name for cell in coach.cells}
    notes = [names[cell_id] for cell_id in coach.note_order]
    assert notes == ["overview", "energy_note", "plan_note", "nutrition_note", "checkin_note", "playbook_note"]

    planner = documents["project-planner.workbook.py"]
    assert planner.sheet_names == ("Board", "Priorities", "Planning", "Goals", "Review")
    workbook = ReactiveWorkbook()
    snapshot = asyncio.run(workbook.load_document_async(planner))
    workbook.close()
    assert not [cell["id"] for cell in snapshot.cells if cell["error"]]
    values = {cell.name: result(snapshot, cell.id)["value"] for cell in planner.cells if cell.name}
    assert len(values["all_tasks"]) == 27  # the sample task list, "today" fixed at 2026-10-05
    assert values["wip_breaches"] == ["Doing has 4 cards (limit 3)"]
    assert values["avg_throughput"] == 2.5 and values["littles_law_days"] == 14
    assert values["load_percent"] == 119
    assert values["decision_verdict"].startswith("Close call: Offer from a large company (71)")
    assert values["objective_progress"]["Get fitter this quarter"] == 69

    life = documents["personal-life-dashboard.workbook.py"]
    notes = [cell for cell in life.cells if cell.kind == "markdown"]
    assert [note.id for note in notes] == ["E1", "E2", "E3", "E4", "E5"]
    workbook = ReactiveWorkbook()
    snapshot = asyncio.run(workbook.load_document_async(life))
    assert result(snapshot, "B2")["value"]["saved"] == "$2,559"
    assert result(snapshot, "B2")["value"]["status"] == "✅ On track"
    assert result(snapshot, "B4")["value"]["progress"] == "62%"
    workbook.close()


FAKE_PLOT = """class Plot:
    def _repr_png_(self):
        renders.append(1)
        return b"png-bytes"

Plot()"""


def test_formulas_run_as_ordinary_python():
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(
        [
            CellDefinition("A1", "input", "[3, 1, 2]", name="values"),
            CellDefinition(
                "A2",
                "formula",
                "\n".join(
                    [
                        "factor = 10",
                        "scaled = [value * factor for value in values]",
                        "by_size = sorted(scaled, key=lambda value: value // factor)",
                        "first = next(value for value in reversed(by_size) if value > factor)",
                        "def double(value):",
                        "    return value * factor * 2",
                        "{'sorted': by_size, 'first': first, 'double': double(1),",
                        " 'total': sum(value for value in scaled if value > factor),",
                        " 'lookup': {key: key * factor for key in set(values)}}",
                    ]
                ),
            ),
            CellDefinition(
                "A3", "effect", "limit = 2\nprint([v for v in values if v >= limit])"
            ),
        ]
    )

    assert result(snapshot, "A2")["error"] is None
    assert result(snapshot, "A2")["value"] == {
        "sorted": [10, 20, 30],
        "first": 30,
        "double": 20,
        "total": 50,
        "lookup": {"1": 10, "2": 20, "3": 30},
    }
    assert effect_result(snapshot, "A3")["output"] == "[3, 2]"
    workbook.close()


def test_notes_link_plots_and_figures_encode_once():
    renders = []
    workbook = ReactiveWorkbook(globals={"renders": renders})
    model = [
        CellDefinition("A1", "input", "1"),
        CellDefinition("B1", "formula", FAKE_PLOT, name="chart"),
        CellDefinition("C1", "markdown", "# Report {{ A1 }}\n\n{{ chart }}"),
        CellDefinition("C2", "markdown", "Again {{ B1 }}"),
    ]
    first = workbook.apply(model)
    model[0] = CellDefinition("A1", "input", "2")
    second = workbook.apply(model)

    assert result(second, "C1")["display"] == "# Report 2\n\n![Plot](#cell-B1)"
    assert result(second, "C2")["display"] == "Again ![Plot](#cell-B1)"
    assert result(first, "B1")["richOutput"]["mimeType"] == "image/png"
    assert len(renders) == 1  # unchanged plot is not re-encoded per note or snapshot
    assert workbook.render_note("C1") == (
        "# Report 2\n\n![Plot](data:image/png;base64,cG5nLWJ5dGVz)"
    )
    workbook.close()


def test_cli_validates_notes_exports_and_named_overrides(tmp_path, capsys):
    source = tmp_path / "notes.sheet.py"
    SheetDocument(
        name="Notes",
        cells=(
            CellDefinition("A1", "input", "2", name="count"),
            CellDefinition("A2", "formula", "count * 4", name="total"),
            CellDefinition("B1", "formula", "Artifact(b'img', 'dot.png', 'image/png')"),
            CellDefinition(
                "C1", "markdown", "Total {{ total }}\n\n{{ B1 }}", name="summary"
            ),
            CellDefinition("D1", "markdown", "[Summary](#note-summary) [again](#note-C1)"),
        ),
    ).save(source)

    assert main([str(source), "--set", "count=5", "--cell", "total"]) == 0
    assert capsys.readouterr().out == "A2\t20\n"

    assert main([str(source), "--note", "summary"]) == 0
    assert (
        capsys.readouterr().out == "Total 8\n\n![dot.png](data:image/png;base64,aW1n)\n"
    )

    export = tmp_path / "export"
    assert main([str(source), "--export", str(export), "--cell", "C1"]) == 0
    assert (export / "B1-dot.png").read_bytes() == b"img"
    assert (export / "C1-summary.md").read_text() == "Total 8\n\n![dot.png](B1-dot.png)"
    # Links between notes point at the exported note files.
    assert main([str(source), "--export", str(export), "--cell", "D1"]) == 0
    assert (export / "D1-D1.md").read_text() == "[Summary](C1-summary.md) [again](C1-summary.md)"

    SheetDocument(
        name="Broken", cells=(CellDefinition("A1", "formula", "1 / 0"),)
    ).save(source)
    assert main([str(source), "--check"]) == 1
    assert "ZeroDivisionError" in capsys.readouterr().err


def test_tabular_values_render_as_tables_in_snapshots_and_notes():
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame({"month": ["Jan", "Feb"], "sales": [92000.5, None]})
    workbook = ReactiveWorkbook({"frame_data": frame})
    snapshot = workbook.apply(
        [
            CellDefinition("A1", "formula", "frame_data", name="frame"),
            CellDefinition("A2", "input", "[{'task': 'Pay rent', 'done': True}]", name="tasks"),
            CellDefinition("A3", "formula", "frame.set_index('month')['sales']"),
            CellDefinition("B1", "markdown", "Tasks: {{ tasks }}\n\n{{ frame }}\n\n{{ frame.head(1) }}"),
        ]
    )

    table = result(snapshot, "A1")["table"]
    assert result(snapshot, "A1")["display"] == "DataFrame · 2 rows × 2 columns"
    assert table["columns"] == ["month", "sales"] and table["index"] is None
    assert table["rows"] == [["Jan", 92000.5], ["Feb", None]]
    series = result(snapshot, "A3")["table"]
    assert series["kind"] == "Series" and series["index"] == ["Jan", "Feb"]
    assert series["indexName"] == "month"
    records = result(snapshot, "A2")
    assert records["table"]["kind"] == "records" and records["table"]["columns"] == ["task", "done"]
    assert records["display"].startswith("[{'task'")  # lists stay readable inline
    note = result(snapshot, "B1")["display"]
    assert note.startswith("Tasks: [{'task': 'Pay rent', 'done': True}]")
    assert "| month | sales |\n| :-- | --: |\n| Jan | 92,000.5 |\n| Feb |  |" in note
    assert note.endswith("| month | sales |\n| :-- | --: |\n| Jan | 92,000.5 |")
    workbook.close()


def test_cell_views_and_output_snapshots_round_trip_through_sheet_files(tmp_path, capsys):
    source = tmp_path / "dash.sheet.py"
    SheetDocument(
        name="Dash",
        cells=(
            CellDefinition(
                "A1", "input", "0.2", name="rate",
                view={"display": "rendered", "widget": {"type": "range", "min": 0, "max": 1}},
            ),
            CellDefinition("B1", "formula", "rate * 100", name="percent", view={"span": [2, 3], "display": "value"}),
            CellDefinition("C5", "markdown", "Rate is {{ percent }}%"),
        ),
    ).save(source)
    document = SheetDocument.load(source)
    assert document.cells[0].view == {"display": "rendered", "widget": {"type": "range", "min": 0, "max": 1}}
    assert document.cells[1].view == {"span": [2, 3]}  # defaults dropped
    assert document.snapshot is None
    with pytest.raises(ValueError):
        CellDefinition("A2", "input", "1", view={"span": [0, 1]})

    saved = tmp_path / "saved.sheet.py"
    assert main([str(source), "--save", str(saved)]) == 0
    capsys.readouterr()
    text = saved.read_text()
    assert "__snapshot__ = " not in text
    assert saved.with_name(saved.name + ".snapshot.json").is_file()
    reloaded = SheetDocument.load(saved)
    assert reloaded.cells == document.cells
    snapshot_cells = {cell["id"]: cell for cell in reloaded.snapshot["cells"]}
    assert snapshot_cells["C5"]["display"] == "Rate is 20%"
    assert "value" not in snapshot_cells["C5"]  # notes keep only their display
    assert reloaded.snapshot["dependencies"]["B1"] == ["A1"]
    assert SheetDocument.loads(reloaded.dumps()) == replace(reloaded, snapshot=None)

    assert main([str(source), "--save", str(saved), "--no-snapshot"]) == 0
    assert SheetDocument.load(saved).snapshot is None


def test_presentation_changes_do_not_recompute_cells():
    renders = []
    workbook = ReactiveWorkbook(globals={"renders": renders})
    model = [CellDefinition("A1", "formula", "renders.append(1) or len(renders)")]
    workbook.apply(model)
    workbook.apply([CellDefinition("A1", "formula", model[0].source, color="#cde7ae", view={"display": "rendered", "span": [2, 2]})])
    assert len(renders) == 1
    workbook.close()


def test_kernel_server_requires_its_token_and_reports_its_port():
    import http.client
    import subprocess
    import sys

    process = subprocess.Popen(
        [sys.executable, "-m", "reaktiv_workbook.server", "--port", "0", "--token", "s3cret", "--exit-on-stdin-eof"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        line = process.stdout.readline()
        assert line.startswith("REAKTIV_KERNEL_READY ")
        port = json.loads(line.removeprefix("REAKTIV_KERNEL_READY "))["port"]

        def request(method, path, body=None, token=None):
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read() or b"{}")

        assert request("POST", "/v1/usage", {})[0] == 401
        status, usage = request("POST", "/v1/usage", {}, token="s3cret")
        assert status == 200 and usage["memoryBytes"] > 0 and usage["memoryKind"] == "resident"
        assert request("GET", "/health")[0] == 401
        assert request("POST", "/v1/apply", {"cells": []}, token="wrong")[0] == 401
        status, snapshot = request(
            "POST", "/v1/apply", {"cells": [{"id": "A1", "kind": "formula", "source": "6 * 7"}]}, token="s3cret"
        )
        assert status == 200 and snapshot["cells"][0]["value"] == 42
        assert request("POST", "/v1/console", {"source": "A1", "sheet": ""})[0] == 401
        status, console = request("POST", "/v1/console", {"source": "A1 + 1", "sheet": ""}, token="s3cret")
        assert status == 200 and console["display"] == "43"
        status, memory = request("POST", "/v1/cell-memory", {}, token="s3cret")
        assert status == 200 and memory["A1"]["bytes"] > 0
    finally:
        process.stdin.close()  # the parent "exits": the kernel must stop on its own
        assert process.wait(timeout=10) == 0


def test_documents_record_their_kernel_and_python_version(tmp_path):
    source = tmp_path / "local.sheet.py"
    SheetDocument(name="Local", kernel="local", python="3.13", packages=("polars",)).save(source)
    text = source.read_text()
    assert '"kernel": "local"' in text and '"python": "3.13"' in text
    document = SheetDocument.load(source)
    assert (document.kernel, document.python) == ("local", "3.13")
    assert document.to_dict()["environment"]["kernel"] == "local"
    plain = tmp_path / "plain.sheet.py"
    SheetDocument(name="Plain").save(plain)
    assert "kernel" not in plain.read_text()  # defaults stay out of files
    with pytest.raises(ValueError):
        SheetDocument(name="Bad", kernel="docker")


def test_sheet_files_declare_dependencies_as_pep723_script_metadata(tmp_path):
    from reaktiv_workbook.model import read_script_metadata

    source = tmp_path / "deps.sheet.py"
    SheetDocument(name="Deps", packages=("polars>=1", "httpx"), python="3.13").save(source)
    text = source.read_text()
    assert text.startswith('# /// script\n# requires-python = "==3.13.*"\n# dependencies = [\n')
    metadata = read_script_metadata(text)
    # numpy only when the code imports it (it is not a dependency of reaktiv-workbook).
    assert metadata["dependencies"] == ["reaktiv>=0.25.0", "reaktiv-workbook>=0.1.0", "polars>=1", "httpx"]
    document = SheetDocument.load(source)
    assert document.packages == ("polars>=1", "httpx") and document.python == "3.13"

    # `uv add --script` edits the block; the app picks the change up.
    edited = text.replace('#   "polars>=1",\n', '#   "polars>=1",\n#   "duckdb",\n')
    source.write_text(edited)
    assert SheetDocument.load(source).packages == ("polars>=1", "duckdb", "httpx")


def test_sheets_reference_each_other_by_coordinate_and_label(tmp_path):
    from reaktiv_workbook.model import SheetTab

    workbook = ReactiveWorkbook()
    cells = [
        CellDefinition("A1", "input", "100", name="income"),
        CellDefinition("A2", "formula", "Budget.A1 + Budget.B1"),  # other sheet by coordinate
        CellDefinition("Budget!A1", "input", "30"),
        CellDefinition("Budget!B1", "formula", "A1 * 2"),  # bare coordinate = own sheet
        CellDefinition("Budget!C1", "formula", "Main.income - Main.A2", name="left"),  # label + first sheet by name
        CellDefinition("Notes!A1", "markdown", "Left: {{ Budget.left }} of {{ Main.A1 }}", name="summary"),
        CellDefinition("Notes!A2", "markdown", "# Report\n\n{{ summary }}"),  # note embeds note
    ]
    snapshot = workbook.apply(cells, sheets=["Main", "Budget", "Notes"])
    assert result(snapshot, "A2")["value"] == 90
    assert result(snapshot, "Budget!B1")["value"] == 60
    assert result(snapshot, "Budget!C1")["value"] == 10
    assert result(snapshot, "Notes!A1")["display"] == "Left: 10 of 100"
    assert result(snapshot, "Notes!A2")["display"] == "# Report\n\nLeft: 10 of 100"
    assert snapshot.dependencies["A2"] == ["Budget!A1", "Budget!B1"]

    cells[2] = CellDefinition("Budget!A1", "input", "40")  # change flows across sheets
    snapshot = workbook.apply(cells, sheets=["Main", "Budget", "Notes"])
    assert result(snapshot, "Budget!C1")["value"] == -20
    workbook.close()

    source = tmp_path / "multi.sheet.py"
    document = SheetDocument(
        name="Multi",
        sheet_name="Main",
        sheets=(SheetTab("Budget", columns=4, rows=4), SheetTab("Notes")),
        cells=tuple(cells),
    )
    document.save(source)
    text = source.read_text()
    assert '@cell("B1")' in text and 'Main = worksheet(MainWorksheet' in text
    reloaded = SheetDocument.load(source)
    source_of = {cell.id: cell.source for cell in reloaded.cells}
    # Loaded sources read labelled cells by label, the others by coordinate relative to
    # each cell's sheet.
    assert source_of["A2"] == "Budget.A1 + Budget.B1"
    assert source_of["Budget!B1"] == "A1 * 2"
    assert source_of["Budget!C1"] == "Main.income - Main.A2"
    assert source_of["Notes!A1"] == "Left: {{ Budget.left }} of {{ Main.income }}"
    assert source_of["Notes!A2"] == "# Report\n\n{{ summary }}"
    assert SheetDocument.loads(reloaded.dumps()) == replace(reloaded, snapshot=None)
    snapshot = asyncio.run(ReactiveWorkbook().load_document_async(reloaded))
    assert result(snapshot, "Notes!A1")["display"] == "Left: -20 of 100"

    with pytest.raises(ValueError, match="unknown sheet"):
        SheetDocument(name="Bad", cells=(CellDefinition("Ghost!A1", "input", "1"),))
    with pytest.raises(ValueError, match="clashes with a sheet name"):
        SheetDocument(name="Bad", sheets=(SheetTab("rent"),), cells=(CellDefinition("A1", "input", "1", name="rent"),))


def test_moving_cells_rewrites_references_across_sheets():
    cells = [
        CellDefinition("A1", "formula", "Budget.A1 * 2"),
        CellDefinition("Budget!A1", "input", "5"),
        CellDefinition("Budget!B1", "formula", "A1 + 1"),
        CellDefinition("Budget!B2", "markdown", "Value {{ A1 }} [see](#cell-A1)"),
    ]
    moved = {cell.id: cell for cell in move_cells(cells, "Budget!A1", "Budget!C3", ["Main", "Budget"])}
    assert moved["A1"].source == "Budget.C3 * 2"
    assert moved["Budget!B1"].source == "C3 + 1"
    assert moved["Budget!B2"].source == "Value {{ C3 }} [see](#cell-C3)"
    assert "Budget!C3" in moved and "Budget!A1" not in moved


def test_live_workbook_document_keeps_sheets():
    workbook = ReactiveWorkbook()
    workbook.apply(
        [CellDefinition("A1", "input", "1"), CellDefinition("Budget!C20", "formula", "Main.A1 + 1")],
        sheets=["Main", "Budget"],
    )
    document = workbook.document
    assert document.sheet_names == ("Main", "Budget")
    assert (document.sheets[0].columns, document.sheets[0].rows) == (10, 20)  # grows to fit
    assert SheetDocument.loads(document.dumps()) == document
    workbook.close()


def test_cutting_cells_to_another_sheet_keeps_every_reference_working():
    from reaktiv_workbook.model import move_cell_group

    cells = [
        CellDefinition("A1", "input", "10"),
        CellDefinition("A2", "input", "3"),
        CellDefinition("B1", "formula", "A1 * A2"),  # moved; A2 stays behind
        CellDefinition("C1", "formula", "B1 + 1"),  # stays; follows B1 to Budget
        CellDefinition("Budget!A1", "formula", "Main.B1 * 2"),
        CellDefinition("D1", "markdown", "Result {{ B1 }} [open](#cell-B1)"),
    ]
    sheets = ["Main", "Budget"]
    moved = {cell.id: cell for cell in move_cell_group(cells, ["A1", "B1"], "A1", "Budget!C5", sheets)}
    assert "A1" not in moved and "B1" not in moved
    assert moved["Budget!D5"].source == "C5 * Main.A2"  # own refs re-expressed from Budget
    assert moved["C1"].source == "Budget.D5 + 1"
    assert moved["Budget!A1"].source == "D5 * 2"
    assert moved["D1"].source == "Result {{ Budget.D5 }} [open](#cell-Budget!D5)"

    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(list(moved.values()), sheets=sheets)
    assert result(snapshot, "Budget!D5")["value"] == 30
    assert result(snapshot, "C1")["value"] == 31
    assert result(snapshot, "Budget!A1")["value"] == 60
    workbook.close()

    with pytest.raises(ValueError, match="overwrite"):
        move_cell_group(cells, ["A1"], "A1", "Budget!A1", sheets)
    with pytest.raises(ValueError, match="one sheet at a time"):
        move_cell_group(cells, ["A1", "Budget!A1"], "A1", "Budget!C5", sheets)


def test_comments_on_input_cells_survive_the_file():
    document = SheetDocument(
        name="Comments",
        columns=3,
        rows=3,
        cells=tuple(
            cells(
                ("A1", "input", "# monthly rent\n# in EUR\n1200"),
                ("A2", "formula", "# yearly\nA1 * 12"),
                ("A3", "input", '"# Heading\\nplain text"'),
            )
        ),
    )
    source = document.dumps()
    assert '    # monthly rent\n    # in EUR\n    a1 = cell("A1", field(1200))' in source
    loaded = SheetDocument.loads(source)
    assert [cell.source for cell in loaded.cells] == [
        "# monthly rent\n# in EUR\n1200",
        "# yearly\nA1 * 12",
        '"# Heading\\nplain text"',
    ]
    workbook = ReactiveWorkbook()
    values = {item["id"]: item["value"] for item in workbook.apply(loaded.cells).cells}
    assert values == {"A1": 1200, "A2": 14400, "A3": "# Heading\nplain text"}


def test_cli_export_copies_the_images_notes_use(tmp_path):
    """Images live next to the workbook in assets/; exported notes keep them."""
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "0123456789abcdef.webp").write_bytes(b"RIFF....WEBP")
    (tmp_path / "assets" / "fedcba9876543210.png").write_bytes(b"unused")
    workbook = tmp_path / "notes.sheet.py"
    SheetDocument(
        name="Notes",
        cells=(CellDefinition("A1", "markdown", "# Plan\n\n![Plan](assets/0123456789abcdef.webp)", name="plan"),),
    ).save(workbook)
    export = tmp_path / "export"
    assert main([str(workbook), "--export", str(export)]) == 0
    assert (export / "A1-plan.md").read_text().endswith("![Plan](assets/0123456789abcdef.webp)")
    assert (export / "assets" / "0123456789abcdef.webp").read_bytes() == b"RIFF....WEBP"
    assert not (export / "assets" / "fedcba9876543210.png").exists()


def test_comments_after_an_input_value_never_break_the_file():
    """`999` + `# note` once became `field(999\n# note)`: the comment swallowed the `)`."""
    document = SheetDocument(
        name="Trailing",
        cells=tuple(
            cells(
                ("A1", "input", "999\n# minus the parking space"),
                ("A2", "input", "1200  # monthly, in EUR"),
                ("A3", "input", "# rent\n[1, 2]\n# per month"),
                ("A4", "input", '"#1 priority"'),
                ("A5", "input", "[1,\n 2]  # two"),
            )
        ),
    )
    loaded = {cell.id: cell.source for cell in SheetDocument.loads(document.dumps()).cells}
    assert loaded["A1"] == "# minus the parking space\n999"
    assert loaded["A2"] == "# monthly, in EUR\n1200"
    assert loaded["A3"] == "# rent\n# per month\n[1, 2]"
    assert loaded["A4"] == '"#1 priority"'  # a # inside a string is not a comment (text loads as text)
    assert loaded["A5"] == "[1,\n 2]  # two"  # Kept as initialization code, not text.
    values = {item["id"]: item["value"] for item in ReactiveWorkbook().apply(SheetDocument.loads(document.dumps()).cells).cells}
    assert values["A1"] == 999 and values["A2"] == 1200 and values["A3"] == [1, 2]


def test_cell_can_opt_out_of_markdown_rendering():
    cell = CellDefinition("A1", "input", '"# not a heading"', view={"markdown": False})
    assert cell.view == {"markdown": False}
    document = SheetDocument(name="M", columns=2, rows=2, cells=(cell,))
    assert SheetDocument.loads(document.dumps()).cells[0].view == {"markdown": False}
    with pytest.raises(TypeError):
        CellDefinition("A1", "input", "1", view={"markdown": "no"})


def test_manual_note_order_round_trips_and_is_omitted_by_default():
    notes = cells(("A1", "markdown", "# First"), ("A2", "markdown", "# Second"))
    plain = SheetDocument(name="N", columns=2, rows=3, cells=tuple(notes))
    assert "noteOrder" not in plain.dumps()
    ordered = SheetDocument(
        name="N", columns=2, rows=3, cells=tuple(notes), note_order=("A2", "A1", "A2")
    )
    assert ordered.note_order == ("A2", "A1")
    assert SheetDocument.loads(ordered.dumps()).note_order == ("A2", "A1")


def test_markdown_cell_can_be_a_cell_note():
    note = CellDefinition("A1", "markdown", "## Label", view={"page": False})
    assert note.view == {"page": False}
    assert CellDefinition("A1", "markdown", "x", view={"page": True}).view is None
    document = SheetDocument(name="C", columns=2, rows=2, cells=(note,))
    assert SheetDocument.loads(document.dumps()).cells[0].view == {"page": False}


def test_shared_code_defines_functions_for_every_cell_and_survives_the_file():
    code = (
        "import datetime as dt\n\n"
        "VAT = 0.19  # German VAT\n\n\n"
        "def gross(net):\n"
        "    \"\"\"Price including VAT.\"\"\"\n"
        "    return round(net * (1 + VAT), 2)\n\n\n"
        "class Money:\n"
        "    def __init__(self, amount):\n"
        "        self.amount = amount\n"
    )
    document = SheetDocument(
        name="Shared",
        columns=3,
        rows=3,
        cells=tuple(cells(("A1", "input", "100"), ("A2", "formula", "gross(A1)"), ("A3", "formula", "Money(A2).amount + np.sqrt(4)"))),
        code=code,
    )
    source = document.dumps()
    assert "\ndef gross(net):\n" in source  # plain module-level Python
    loaded = SheetDocument.loads(source)
    assert loaded.code == code.rstrip()
    assert loaded.imports == ()
    workbook = ReactiveWorkbook()
    values = {item["id"]: item["value"] for item in workbook.load_document(loaded).cells}
    assert values == {"A1": 100, "A2": 119.0, "A3": 121.0}

    # Changing shared code recomputes the cells that use it.
    changed = workbook.apply(loaded.cells, code=code.replace("0.19", "0.07"))
    assert {item["id"]: item["value"] for item in changed.cells}["A2"] == 107.0

    with pytest.raises(RuntimeError, match=r"Shared code \(line 1\): ZeroDivisionError"):
        workbook.apply(loaded.cells, code="x = 1 / 0")
    with pytest.raises(ValueError, match="Shared code line 1"):
        SheetDocument(name="Bad", code="def (:")


def test_formula_cell_can_define_a_function_by_its_final_def():
    workbook = ReactiveWorkbook()
    result = workbook.apply(
        cells(
            ("A1", "input", "0.2"),
            ("A2", "formula", "def tax(amount):\n    return amount * A1"),
            ("A3", "formula", "A2(1000)"),
        )
    )
    values = {item["id"]: item for item in result.cells}
    assert values["A3"]["value"] == 200.0
    assert values["A2"]["display"] == "ƒ tax(amount)"


def test_function_cells_round_trip_through_the_file():
    document = SheetDocument(
        name="Fn",
        columns=2,
        rows=3,
        cells=(
            CellDefinition("A1", "input", "0.2"),
            CellDefinition(
                "A2", "formula", "# tax on an amount\ndef tax(amount):\n    return amount * A1", name="tax"
            ),
            CellDefinition("A3", "formula", "tax(1000)"),
        ),
    )
    source = document.dumps()
    assert "            return amount * self.a1()\n\n        return tax\n" in source
    loaded = SheetDocument.loads(source)
    assert loaded.cells[1].source == "# tax on an amount\ndef tax(amount):\n    return amount * A1"
    values = {item["id"]: item["value"] for item in ReactiveWorkbook().load_document(loaded).cells}
    assert values["A3"] == 200.0


def test_anywidget_view_changes_stay_in_the_widget():
    """A widget's own state (not bound to an input cell) changes in the widget only: the
    instance is kept and the view gets the new state, but no cell depends on it."""
    pytest.importorskip("anywidget")
    code = (
        "import anywidget\nimport traitlets\n\n\n"
        "class Counter(anywidget.AnyWidget):\n"
        "    _esm = 'export default { render({ model, el }) { el.textContent = model.get(\"value\"); } }'\n"
        "    value = traitlets.Int(0).tag(sync=True)\n"
    )
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(cells(("A1", "formula", "Counter(value=2)")), code=code)
    payload = result(snapshot, "A1")["richOutput"]
    assert payload["mimeType"] == "application/vnd.anywidget+json"
    spec = json.loads(base64.b64decode(payload["dataBase64"]))
    assert spec["state"] == {"value": 2} and "render" in spec["esm"]

    widget = workbook._ensure_slot("A1")()
    updated = workbook.update_widget("A1", {"value": 5})
    assert workbook._ensure_slot("A1")() is widget  # same instance, state kept
    assert json.loads(base64.b64decode(result(updated, "A1")["richOutput"]["dataBase64"]))["state"] == {"value": 5}


# --- Clock cells: every(...) / at(...) ---------------


class FakeClock:
    def __init__(self, start):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, **delta):
        from datetime import timedelta

        self.now += timedelta(**delta)


def clock_workbook(start=None):
    from datetime import datetime

    workbook = ReactiveWorkbook()
    workbook._clock = FakeClock(start or datetime(2026, 10, 2, 9, 0, 0))  # a Friday
    return workbook, workbook._clock


def named_cells(*items):
    """(id, kind, source[, name]) tuples."""
    return [CellDefinition(*item[:3], name=item[3] if len(item) > 3 else "") for item in items]


def timer(snapshot, cell_id):
    return next(item for item in snapshot.timers if item["cellId"] == cell_id)


def test_interval_clock_ticks_and_reruns_dependents():
    workbook, clock = clock_workbook()
    snapshot = workbook.apply(
        named_cells(
            ("A1", "formula", "every(minutes=5)", "clock"),
            ("A2", "formula", "f'{clock:%H:%M}'"),
            ("A3", "input", "1"),
        )
    )
    assert result(snapshot, "A1")["display"] == "2026-10-02 09:00:00"
    assert result(snapshot, "A1")["value"] == "2026-10-02T09:00:00"
    assert snapshot.to_dict()["timers"] == [
        {
            "cellId": "A1",
            "label": "every 5 min",
            "lastAt": "2026-10-02T09:00:00",
            "nextAt": "2026-10-02T09:05:00",
            "nextInSeconds": 300.0,
        }
    ]

    clock.advance(minutes=5, seconds=2)
    snapshot = workbook.tick_timer("A1")
    assert result(snapshot, "A2")["display"] == "09:05"
    assert timer(snapshot, "A1")["nextAt"] == "2026-10-02T09:10:02"
    assert snapshot.changed == ("A1",)

    # Ticking something that is not a clock is ignored (a stale timer in the host).
    assert workbook.tick_timer("A3").changed == ()


def test_schedule_clock_picks_the_next_time_and_day():
    workbook, clock = clock_workbook()
    snapshot = workbook.apply(
        named_cells(("A1", "formula", 'at("08:00", "17:30", days="mon-fri")'))
    )
    assert timer(snapshot, "A1")["label"] == "at 08:00, 17:30 on mon, tue, wed, thu, fri"
    assert timer(snapshot, "A1")["nextAt"] == "2026-10-02T17:30:00"

    clock.advance(hours=8, minutes=30)
    snapshot = workbook.tick_timer("A1")
    assert result(snapshot, "A1")["display"] == "2026-10-02 17:30:00"
    # Friday evening: the next weekday slot is Monday morning.
    assert timer(snapshot, "A1")["nextAt"] == "2026-10-05T08:00:00"


def test_schedule_day_ranges_wrap_and_reject_bad_input():
    from datetime import datetime, time as clock_time
    from reaktiv_workbook.timers import TimerSpec, _parse_days, at, every

    assert _parse_days("fri-mon") == frozenset({4, 5, 6, 0})
    assert _parse_days("weekends") == frozenset({5, 6})
    assert _parse_days(["Sat", "sunday"]) == frozenset({5, 6})
    spec = TimerSpec("x", times=(clock_time(9),), days=frozenset({6}))
    assert spec.next_after(datetime(2026, 10, 4, 9, 0)) == datetime(2026, 10, 11, 9, 0)
    with pytest.raises(ValueError, match="at least 1 second"):
        every(0.5)
    with pytest.raises(ValueError, match="HH:MM"):
        at("8 o'clock")
    with pytest.raises(ValueError, match="Unknown day"):
        at("08:00", days="someday")
    # Outside a workbook the functions just return the current time.
    assert isinstance(every(minutes=1), datetime)


def test_clock_can_be_switched_off_and_its_interval_changed():
    workbook, clock = clock_workbook()
    definitions = [
        ("A1", "input", "True", "enabled"),
        ("A2", "input", "10", "seconds"),
        ("A3", "formula", "every(seconds) if enabled else None", "clock"),
    ]
    snapshot = workbook.apply(named_cells(*definitions))
    assert timer(snapshot, "A3")["nextInSeconds"] == 10.0

    definitions[1] = ("A2", "input", "30", "seconds")
    snapshot = workbook.apply(named_cells(*definitions))
    assert timer(snapshot, "A3")["label"] == "every 30 s"
    assert timer(snapshot, "A3")["nextInSeconds"] == 30.0

    definitions[0] = ("A1", "input", "False", "enabled")
    snapshot = workbook.apply(named_cells(*definitions))
    assert snapshot.timers == ()
    assert result(snapshot, "A3")["display"] == ""

    # enabled=False pauses a clock: it keeps its time and stops ticking.
    paused = [
        ("A1", "input", "True", "enabled"),
        ("A3", "formula", "every(10, enabled=enabled)", "clock"),
    ]
    snapshot = workbook.apply(named_cells(*paused))
    assert timer(snapshot, "A3")["label"] == "every 10 s"
    clock.advance(seconds=10)
    workbook.tick_timer("A3")
    paused[0] = ("A1", "input", "False", "enabled")
    snapshot = workbook.apply(named_cells(*paused))
    assert snapshot.timers == ()
    assert result(snapshot, "A3")["display"] == "2026-10-02 09:00:10"

    # Removing the cell forgets the timer too.
    definitions[0] = ("A1", "input", "True", "enabled")
    assert workbook.apply(named_cells(*definitions)).timers != ()
    assert workbook.apply(named_cells(*definitions[:2])).timers == ()


def test_clock_keeps_its_schedule_when_other_inputs_change():
    workbook, clock = clock_workbook()
    definitions = [
        ("A1", "input", "1", "factor"),
        ("A2", "formula", "every(60)\nfactor * 2"),
    ]
    workbook.apply(named_cells(*definitions))
    clock.advance(seconds=45)
    definitions[0] = ("A1", "input", "2", "factor")
    snapshot = workbook.apply(named_cells(*definitions))
    assert result(snapshot, "A2")["value"] == 4
    assert timer(snapshot, "A2")["nextInSeconds"] == 15.0


def test_effect_with_its_own_timer_runs_on_every_tick():
    workbook, clock = clock_workbook()
    snapshot = workbook.apply(
        named_cells(("A1", "effect", "now = every(30)\nprint(f'beat {now:%H:%M:%S}')"))
    )
    assert effect_result(snapshot, "A1")["output"] == "beat 09:00:00"
    clock.advance(seconds=30)
    snapshot = workbook.tick_timer("A1")
    assert effect_result(snapshot, "A1")["output"] == "beat 09:00:30"
    assert effect_result(snapshot, "A1")["triggerCount"] == 2
    assert timer(snapshot, "A1")["nextAt"] == "2026-10-02T09:01:00"


@pytest.mark.asyncio
async def test_resources_reload_on_ticks_by_reference_or_with_their_own_timer():
    workbook, clock = clock_workbook()
    loads = []
    workbook._user_globals["loads"] = loads
    snapshot = await workbook.apply_async(
        named_cells(
            ("A1", "formula", "every(minutes=1)", "clock"),
            ("A2", "resource", "loads.append('by-reference')\nreturn f'{clock:%H:%M}'"),
            ("A3", "resource", "now = every(minutes=10)\nloads.append('own')\nreturn f'{now:%H:%M}'"),
        )
    )
    assert loads.count("by-reference") == 1 and loads.count("own") == 1
    assert [item["cellId"] for item in snapshot.timers] == ["A1", "A3"]

    clock.advance(minutes=1)
    snapshot = await workbook.tick_timer_async("A1")
    assert result(snapshot, "A2")["display"] == "09:01"
    assert loads.count("by-reference") == 2 and loads.count("own") == 1

    clock.advance(minutes=9)
    snapshot = await workbook.tick_timer_async("A3")
    assert result(snapshot, "A3")["display"] == "09:10"
    assert loads.count("own") == 2
    assert timer(snapshot, "A3")["nextAt"] == "2026-10-02T09:20:00"
    workbook.close()


@pytest.mark.asyncio
async def test_concurrent_resources_keep_their_own_output_and_restore_stdout(capsys):
    workbook = ReactiveWorkbook()
    snapshot = await workbook.apply_async(
        named_cells(
            ("A1", "resource", "print('first starts')\nawait asyncio.sleep(0.02)\nprint('first ends')\nreturn 1"),
            ("A2", "resource", "print('second starts')\nawait asyncio.sleep(0.01)\nprint('second ends')\nreturn 2"),
        )
    )
    logs = {entry["cellId"]: entry["message"] for entry in snapshot.logs}
    assert logs == {"A1": "first starts\nfirst ends", "A2": "second starts\nsecond ends"}
    print("still visible")
    assert capsys.readouterr().out == "still visible\n"
    workbook.close()


def test_scheduled_pipeline_example_ticks_through_server_and_cli(capsys):
    example = Path(__file__).parents[2] / "examples" / "scheduled-pipeline.workbook.py"
    document = SheetDocument.load(example)
    server = RuntimeServer()
    try:
        first = server.dispatch(
            "/v1/apply",
            {
                "cells": [cell.to_dict() for cell in document.cells],
                "sheets": list(document.sheet_names),
                "code": document.code,
            },
        )
        assert {item["cellId"]: item["label"] for item in first["timers"]} == {
            "B1": "every 5 s",
            "C1": "at 08:00, 12:00, 17:30 on mon, tue, wed, thu, fri",
            "C3": "every 10 min",
            "C4": "every 1 min",
        }
        assert not [cell for cell in first["cells"] if cell["error"]]
        ticked = server.dispatch("/v1/tick-timer", {"cellId": "B1"})
        assert ticked["changed"] == ["B1"]
        values = {cell["id"]: cell for cell in ticked["cells"]}
        assert values["B7"]["value"] in {"ok", "HIGH"}
        assert len(values["B3"]["value"]) in {1, 2}  # a tick within the same second adds nothing
    finally:
        server.close()

    status = main(
        [str(example), "--set", "refresh_seconds=1", "--watch", "1", "--cell", "clock", "--check"]
    )
    captured = capsys.readouterr()
    assert status == 0
    assert "tick\tB1\t" in captured.out
    assert "watch\tnext B1 (every 1 s)" in captured.err


# --- Logs: errors with tracebacks, warnings, origins ---------------------------------


def error_logs(snapshot):
    return [entry for entry in snapshot.logs if entry["level"] == "error"]


def test_errors_are_logged_once_with_line_and_traceback_and_name_their_origin():
    workbook = ReactiveWorkbook()
    definitions = [
        ("A1", "input", "0", "count"),
        ("A2", "formula", "100 / count", "ratio"),
        ("A3", "formula", "ratio + 1", "downstream"),
        ("A4", "formula", "x = 1\ny = [1, 2][5]\nx + y", "block"),
        ("A5", "formula", "share(10)", "shared"),
        ("A6", "effect", "print(downstream)"),
        ("A7", "markdown", "Ratio {{ ratio }}"),
    ]
    code = "def share(n):\n    return helper(n)\n\n\ndef helper(n):\n    return n / 0"
    snapshot = workbook.apply(named_cells(*definitions), code=code)
    workbook.snapshot()
    snapshot = workbook.snapshot()  # failed cells are re-read: no duplicate log entries

    assert [(entry["cellId"], entry["message"], entry["line"]) for entry in error_logs(snapshot)] == [
        ("A2", "ZeroDivisionError: division by zero", 1),
        ("A4", "IndexError: list index out of range", 2),
        ("A5", "ZeroDivisionError: division by zero", 1),
    ]
    assert error_logs(snapshot)[2]["traceback"].splitlines() == [
        "Traceback (most recent call last):",
        "  Cell A5, line 1",
        "    share(10)",
        "  Shared code, line 2, in share",
        "    return helper(n)",
        "  Shared code, line 6, in helper",
        "    return n / 0",
        "ZeroDivisionError: division by zero",
    ]
    assert result(snapshot, "A4")["errorDetail"]["line"] == 2
    assert result(snapshot, "A4")["errorDetail"]["source"] == "y = [1, 2][5]"
    # Cells that only read a failed cell point at it instead of repeating the traceback.
    for cell_id in ("A3", "A6", "A7"):
        assert result(snapshot, cell_id)["errorDetail"] == {"origin": "A2"}

    # Fixing the input clears the errors; breaking it again logs the failure again.
    definitions[0] = ("A1", "input", "4", "count")
    fixed = workbook.apply(named_cells(*definitions), code=code)
    assert result(fixed, "A3")["value"] == 26
    assert "errorDetail" not in result(fixed, "A3")
    definitions[0] = ("A1", "input", "0", "count")
    broken = workbook.apply(named_cells(*definitions), code=code)
    assert [entry["cellId"] for entry in error_logs(broken)].count("A2") == 2


def test_syntax_errors_warnings_and_output_before_an_error_are_logged():
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(
        named_cells(
            ("A1", "formula", "total = 1\ndef broken(:\n    pass"),
            ("A2", "formula", "import sys\nprint('careful', file=sys.stderr)\nprint('hello')\n1"),
            ("A3", "formula", "print('before')\n1 / 0"),
            ("A4", "effect", "print('effect out')\nraise RuntimeError('boom')"),
            ("A5", "markdown", "Total {{ missing_name }}"),
        )
    )
    workbook.snapshot()
    snapshot = workbook.snapshot()
    logs = [(entry["cellId"], entry["level"], entry["message"]) for entry in snapshot.logs]
    assert logs == [
        ("A1", "error", "SyntaxError: invalid syntax (line 2)"),
        ("A4", "info", "effect out"),
        ("A4", "error", "RuntimeError: boom"),
        ("A2", "info", "hello"),
        ("A2", "warning", "careful"),
        ("A3", "info", "before"),
        ("A3", "error", "ZeroDivisionError: division by zero"),
        ("A5", "error", "NameError: name 'missing_name' is not defined"),
    ]
    assert result(snapshot, "A1")["error"] == "SyntaxError: invalid syntax (line 2)"
    assert result(snapshot, "A1")["errorDetail"]["traceback"].splitlines() == [
        "Traceback (most recent call last):",
        "  Cell A1, line 2",
        "    def broken(:",
        "               ^",
        "SyntaxError: invalid syntax (line 2)",
    ]
    assert result(snapshot, "A4")["errorDetail"]["line"] == 2
    assert "Cell A5 {{ missing_name }}, line 1" in result(snapshot, "A5")["errorDetail"]["traceback"]

    # Python prints warnings as "<file>:<line>: ..."; the internal cell file name is hidden.
    from reaktiv_workbook.execution_errors import CELL_LOCATION, cell_location

    assert (
        CELL_LOCATION.sub(cell_location, "<cell Budget!A7>:2: UserWarning: careful")
        == "Line 2: UserWarning: careful"
    )
    # Clearing really clears: cells that keep failing the same way are not logged again
    # (their current errors stay visible on the cells).
    assert workbook.clear_logs().logs == ()


@pytest.mark.asyncio
async def test_resource_errors_are_logged_with_their_line_and_pending_reads_are_not():
    workbook = ReactiveWorkbook()
    snapshot = await workbook.apply_async(
        named_cells(
            ("A1", "resource", "await asyncio.sleep(0.01)\nprint('loading')\nreturn {}['missing']", "data"),
            ("A2", "formula", "data + 1"),
        )
    )
    assert [(entry["cellId"], entry["level"], entry["message"]) for entry in snapshot.logs] == [
        ("A1", "info", "loading"),
        ("A1", "error", "KeyError: 'missing'"),
    ]
    assert result(snapshot, "A1")["errorDetail"]["line"] == 3
    assert result(snapshot, "A2")["errorDetail"] == {"origin": "A1"}
    workbook.close()


def test_cli_check_prints_where_a_cell_failed_and_what_caused_follow_up_errors(capsys, tmp_path):
    path = tmp_path / "broken.sheet.py"
    SheetDocument(
        cells=tuple(named_cells(("A1", "formula", "x = 0\n1 / x", "ratio"), ("A2", "formula", "ratio + 1")))
    ).save(path)
    assert main([str(path), "--check"]) == 1
    assert capsys.readouterr().err.splitlines() == [
        "error\tA1\tZeroDivisionError: division by zero",
        "    Cell A1, line 2",
        "      return 1 / x",
        "error\tA2\tZeroDivisionError: division by zero",
        "  caused by A1",
    ]


def test_app_widgets_round_trip_and_the_trip_planner_reacts_to_them():
    from reaktiv_workbook.model import WIDGET_TYPES, normalize_view

    assert {"textarea", "date", "list", "multiselect", "button"} <= WIDGET_TYPES
    assert normalize_view({"widget": {"type": "multiselect", "options": ["a", "b"]}}) == {
        "widget": {"type": "multiselect", "options": ["a", "b"]}
    }
    with pytest.raises(ValueError, match="widget type"):
        normalize_view({"widget": {"type": "slider"}}, "A1")

    example = Path(__file__).parents[2] / "examples" / "trip-planner-app.workbook.py"
    document = SheetDocument.load(example)
    widgets = {cell.name: cell.view["widget"]["type"] for cell in document.cells if cell.view and "widget" in cell.view}
    assert widgets == {
        "packing": "list",
        "activities": "multiselect",
        "departure": "date",
        "booking_notes": "textarea",
        "pick_for_me": "button",
    }
    cells = {cell.id: cell for cell in document.cells}

    def run(**inputs):
        updated = [
            CellDefinition(cell.id, cell.kind, inputs.get(cell.name, cell.source), name=cell.name)
            for cell in cells.values()
        ]
        workbook = ReactiveWorkbook()
        snapshot = asyncio.run(
            workbook.apply_async(
                updated, code=document.code, imports=document.imports, sheets=document.sheet_names
            )
        )
        workbook.close()
        return snapshot

    first = run()
    assert result(first, "C1")["value"] == ["Hiking boots", "Water bottle", "Student ID"]
    assert result(first, "C4")["value"] == "press the button"
    # What the widgets write: a list literal, the ticked options, and a click count.
    after = run(packing='["Towel"]', activities='["Swimming"]', pick_for_me="3")
    assert result(after, "C1")["value"] == ["Swimsuit"]
    assert result(after, "C4")["value"] == "Swimsuit"
    assert not [cell for cell in after.cells if cell["error"]]


def test_course_workbooks_run_and_link_their_chapters():
    """The multi-chapter workbooks in examples/education evaluate, and each chapter links to
    the previous and next one."""
    root = Path(__file__).parents[2]
    education = sorted((root / "examples" / "education").glob("*.workbook.py"))
    assert len(education) >= 9

    for path in education:
        document = SheetDocument.load(path)
        assert SheetDocument.loads(document.dumps()) == document
        workbook = ReactiveWorkbook()
        snapshot = asyncio.run(workbook.load_document_async(document))
        workbook.close()
        assert not [cell["id"] for cell in snapshot.cells if cell["error"]], path.name
        # A course is several note pages over one model, in the order of its chapters.
        pages = {cell.id: cell.name for cell in document.cells if cell.kind == "markdown"}
        chapters = [pages[cell_id] for cell_id in document.note_order]
        assert len(chapters) >= 3
        # Chapters link to the previous and next chapter (#note-<label>).
        for index, cell_id in enumerate(document.note_order):
            source = next(cell.source for cell in document.cells if cell.id == cell_id)
            links = re.findall(r"\]\(#note-(\w+)\)", source)
            assert links == chapters[max(0, index - 1):index] + chapters[index + 1:index + 2], cell_id

    physics = SheetDocument.load(root / "examples" / "education" / "motion.workbook.py")
    snapshot = asyncio.run(ReactiveWorkbook().load_document_async(physics))
    values = {cell.name: result(snapshot, cell.id)["value"] for cell in physics.cells if cell.kind == "formula"}
    assert values["distance"] == 40.77  # 20 m/s at 45 degrees on Earth
    assert values["fall_time"] == 2.02  # 20 m
    assert values["travelled"] == 150  # 5 m/s, 2 m/s², 10 s


def test_header_imports_from_other_versions_are_never_executed():
    """A file written by another version lists other names in its header import; the
    runtime must not try to import them (they may not exist here)."""
    source = SheetDocument(cells=(CellDefinition("A1", "input", "1"),)).dumps()
    import re

    header = re.search(r"^from reaktiv_workbook import .*$", source, re.M).group(0)
    future = source.replace(header, "from reaktiv_workbook import cell, markdown, sheet, name_from_the_future")
    assert SheetDocument.loads(future).imports == ()
    workbook = ReactiveWorkbook()
    workbook.apply([CellDefinition("A1", "input", "1")], imports=["from reaktiv_workbook import nothing_here"])
    assert workbook.document.imports == ()


def test_example_tiles_never_cover_other_cells():
    """A dashboard tile (view.span) must not lie over another cell: the app would clamp it
    (clampSpan in dashboard.ts) and the layout would look broken."""
    def position(cell_id):
        sheet, coordinate = split_cell_id(cell_id)
        letters = re.match(r"[A-Z]+", coordinate).group(0)
        column = 0
        for letter in letters:
            column = column * 26 + ord(letter) - 64
        return sheet, column, int(coordinate[len(letters):])

    examples = Path(__file__).parents[2] / "examples"
    covered = []
    for path in sorted(examples.rglob("*.workbook.py")):
        document = SheetDocument.load(path)
        for tile in document.cells:
            span = (tile.view or {}).get("span")
            if not span:
                continue
            sheet, column, row = position(tile.id)
            for other in document.cells:
                other_sheet, other_column, other_row = position(other.id)
                if other.id != tile.id and other_sheet == sheet and column <= other_column < column + span[0] and row <= other_row < row + span[1]:
                    covered.append(f"{path.name}: {tile.id} covers {other.id}")
    assert covered == []


def test_guide_workbook_runs_and_its_code_boxes_show_the_live_cells():
    """examples/docs/guide.workbook.py is the user guide (the website's Docs link opens it):
    every cell runs, and each code box (`code_<label>`, an HTML cell) shows exactly the
    source of the live cell it describes, so text and examples cannot drift apart."""
    pytest.importorskip("anywidget")
    pytest.importorskip("plotly")
    pytest.importorskip("matplotlib")
    import html as markup

    document = SheetDocument.load(Path(__file__).parents[2] / "examples" / "docs" / "guide.workbook.py")
    assert SheetDocument.loads(document.dumps()) == document
    workbook = ReactiveWorkbook()
    snapshot = asyncio.run(workbook.load_document_async(document))
    workbook.close()
    assert [(cell["id"], cell["error"]) for cell in snapshot.cells if cell["error"]] == []
    by_name = {definition.name: definition for definition in document.cells}
    values = {name: result(snapshot, definition.id) for name, definition in by_name.items()}
    labels = {definition.id: definition.name for definition in document.cells if definition.name}
    sheets = {name: name for name in document.sheet_names[1:]}

    def as_typed(definition):
        """The source as the guide shows it: labels instead of the stored coordinates."""
        from reaktiv_workbook.sheets import ReferenceScope, iter_coordinate_references

        source = definition.source
        if definition.kind == "input":
            return source  # an input's value (no references)
        lines = source.splitlines(keepends=True)
        offsets = [0]
        for line in lines:
            offsets.append(offsets[-1] + len(line))
        scope = ReferenceScope(sheet=split_cell_id(definition.id)[0], sheets=sheets)
        for (start_row, start_col), (end_row, end_col), target in sorted(
            iter_coordinate_references(source, scope), reverse=True
        ):
            start = offsets[start_row - 1] + start_col
            end = offsets[end_row - 1] + end_col
            source = source[:start] + labels.get(target, target) + source[end:]
        return source

    shown = 0
    for name, definition in by_name.items():
        if not name.startswith("code_") or name[5:] not in by_name:
            continue
        box = base64.b64decode(values[name]["richOutput"]["dataBase64"]).decode()
        assert markup.escape(as_typed(by_name[name[5:]])) in box, name
        shown += 1
    assert shown >= 12
    assert values["verdict"]["value"] == "Loved it"
    assert values["stars"]["richOutput"]["mimeType"] == "application/vnd.anywidget+json"
    assert values["kpis"]["richOutput"]["mimeType"] == "text/html"
    assert values["revenue_chart"]["richOutput"]["mimeType"] == "application/vnd.plotly.v1+json"
    # Chapters link to their neighbours, in note order.
    notes = [by_name_id.name for note_id in document.note_order for by_name_id in document.cells if by_name_id.id == note_id]
    for index, name in enumerate(notes):
        links = re.findall(r"\]\(#note-(\w+)\)", by_name[name].source)
        assert links[-len(notes[max(0, index - 1):index] + notes[index + 1:index + 2]):] == notes[max(0, index - 1):index] + notes[index + 1:index + 2], name


def test_multi_line_string_inputs_keep_their_value_in_the_file():
    """The class body is indented when written; a multi-line string literal is written on
    one line so that indentation never ends up inside the string."""
    source = '# the look of the cards\n"""\n.card { color: red; }\n.title { font-weight: 700; }"""'
    document = SheetDocument(name="Strings", cells=(CellDefinition("A1", "input", source, name="css"),))
    text = document.dumps()
    assert "field('\\n.card { color: red; }\\n.title { font-weight: 700; }')" in text
    assert not any(line.lstrip().startswith(".title") for line in text.splitlines())
    loaded = SheetDocument.loads(text)
    snapshot = ReactiveWorkbook().apply(list(loaded.cells))
    assert result(snapshot, "A1")["value"] == "\n.card { color: red; }\n.title { font-weight: 700; }"
    assert SheetDocument.loads(loaded.dumps()) == loaded


def test_widget_host_page_has_no_inline_style_element():
    """If a host CSP lists the hash of an inline <style>, 'unsafe-inline' becomes void and the
    <style> elements that widgets' _css need are refused (unstyled widgets). The host adds its
    base styles from its script instead."""
    page = (Path(__file__).parents[2] / "frontend" / "public" / "anywidget" / "host.html").read_text()
    outside_scripts = re.sub(r"<script\b.*?</script>", "", page, flags=re.S)
    assert not re.search(r"<style\b", outside_scripts)
    assert " style=" not in outside_scripts  # inline style attributes are hashed too


def test_output_layout_wrappers_in_exports_and_pages():
    """[{{ x }}](#sheet-output?layout=wide) is the note editor's size/layout of a value: the
    app's display keeps it, self-contained notes drop it, static pages mark it."""
    pd = pytest.importorskip("pandas")
    workbook = ReactiveWorkbook({"frame": pd.DataFrame({"a": [1, 2]})})
    snapshot = workbook.apply(
        cells(
            ("A1", "formula", "frame"),
            ("B1", "markdown", "Data:\n\n[{{ A1 }}](#sheet-output?layout=wide)\n\nEnd [web](https://x.y)"),
        )
    )
    assert "](#sheet-output?layout=wide)" in result(snapshot, "B1")["value"]
    note = workbook.render_note("B1")
    assert "#sheet-output" not in note and "| a |" in note and "[web](https://x.y)" in note
    page = workbook.render_note_page("B1")
    assert "<!--reaktiv-layout:wide-->" in page and "<!--/reaktiv-layout-->" in page and "#sheet-output" not in page
    workbook.close()


def test_save_check_compares_the_written_file_with_the_workbook():
    """Before the app saves, Python loads the file it wrote and compares it with the workbook
    in the app (model.verify_written_document); labels and coordinates compare equal."""
    from dataclasses import replace

    from reaktiv_workbook.model import verify_written_document

    document = SheetDocument(
        name="Check",
        cells=(
            CellDefinition("A1", "input", "2", name="today"),
            CellDefinition("B1", "formula", "dict(today=today, doubled=today * 2)", name="board"),
            CellDefinition("C1", "markdown", "Value: {{ board }}", name="note"),
        ),
    )
    expected = document.to_dict()  # what the app sends (labels in the sources)
    good = document.dumps()
    assert verify_written_document(good, expected) == []

    broken = good.replace("today=self.today()", "self.today()=self.today()")
    problems = verify_written_document(broken, expected)
    assert len(problems) == 1 and problems[0].startswith("The file would not load")

    changed = replace(document, cells=(*document.cells[:1], replace(document.cells[1], source="today * 3"), document.cells[2]))
    assert verify_written_document(changed.dumps(), expected) == ["Cell B1 (board): its code would change"]
    fewer = replace(document, cells=document.cells[:2])
    assert verify_written_document(fewer.dumps(), expected) == ["Cell C1 (note) would be missing"]

    # The same check through the kernel server (remote kernel).
    server = RuntimeServer()
    assert server.dispatch("/v1/verify-document", {"source": good, "document": expected}) == []
    assert server.dispatch("/v1/verify-document", {"source": broken, "document": expected})[0].startswith("The file would not load")


def test_examples_keep_their_code_in_cells():
    """Helpers are function cells and constants input cells; shared code holds at most
    state that must survive recomputation (the scheduled pipeline's history)."""
    examples = Path(__file__).parents[2] / "examples"
    for path in [*sorted((examples / "education").glob("*.workbook.py")), *(examples / name for name in (
        "features/plotly-dashboard.workbook.py", "trip-planner-app.workbook.py", "features/anywidget-demo.workbook.py",
        "welcome.workbook.py", "budget.workbook.py", "signal-lab.workbook.py", "model-fit.workbook.py",
        "wave-laboratory.workbook.py", "vectors.workbook.py", "binary-search.workbook.py", "calorie-coach.workbook.py",
        "project-planner.workbook.py",
    ))]:
        assert SheetDocument.load(path).code == "", path.name
    pipeline = SheetDocument.load(examples / "scheduled-pipeline.workbook.py")
    assert "HISTORY = deque" in pipeline.code and "def " not in pipeline.code
    functions = {cell.name for cell in pipeline.cells if cell.source.lstrip().startswith(("def ", '"""')) or "\ndef " in cell.source}
    assert {"read_sensor", "sparkline", "summarize"} <= functions


# --- anywidget: the Jupyter widget protocol through the engine's comm (widgets.py) ----

ANYWIDGET_CODE = '''
import anywidget
import traitlets


class Counter(anywidget.AnyWidget):
    _esm = "export default { render({ model, el }) {} }"
    _css = ".x { color: red }"
    value = traitlets.Int(0).tag(sync=True)  # data: bound to an input cell
    clicks = traitlets.Int(0).tag(sync=True)  # the widget's own state
    data = traitlets.Bytes(b"").tag(sync=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.on_msg(self._reply)

    def _reply(self, widget, content, buffers):
        if isinstance(content, dict):
            return  # anywidget commands have their own handler
        if content == "reset":
            self.clicks = 0
        self.send({"echo": content, "sizes": [len(buffer) for buffer in buffers]}, [b"\\x01\\x02"])

    @anywidget.experimental.command
    def _double(self, message, buffers):
        return {"doubled": message * 2}, []


class Panel(anywidget.AnyWidget):
    _esm = "export default { render() {} }"
    child = traitlets.Instance(Counter).tag(sync=True, **__import__("ipywidgets").widget_serialization)
'''


def anywidget_workbook():
    pytest.importorskip("anywidget")
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(anywidget_cells(), code=ANYWIDGET_CODE)
    return workbook, snapshot


def anywidget_cells(count="2", bump="False"):
    return named_cells(
        ("A1", "formula", "bind(Counter(clicks=1, data=b'\\x00\\xff'), value=count)", "counter"),
        ("A2", "formula", "count * 10", "scaled"),
        ("A3", "effect", "if bump:\n    counter.clicks = 7"),
        ("A4", "input", bump, "bump"),
        ("A5", "formula", "Panel(child=counter)", "panel"),
        ("A6", "input", count, "count"),
    )


def widget_spec(snapshot, cell_id):
    payload = result(snapshot, cell_id)["richOutput"]
    return json.loads(base64.b64decode(payload["dataBase64"]))


def test_bound_widgets_show_input_cells_and_their_data_stays_in_the_graph():
    workbook, snapshot = anywidget_workbook()
    spec = widget_spec(snapshot, "A1")
    assert spec["esm"].startswith("export default") and spec["css"] == ".x { color: red }"
    assert spec["state"]["value"] == 2 and spec["bindings"] == {"value": "A6"}
    assert spec["state"]["data"] == {"$binary": base64.b64encode(b"\x00\xff").decode()}
    assert result(snapshot, "A2")["value"] == 20

    # The view's change of a bound trait is written to its input cell (by the app):
    old_model = widgets.model_id_of(workbook._ensure_slot("A1")())
    models = len(widgets.registry.models)
    snapshot = workbook.apply(anywidget_cells(count="7"))
    assert result(snapshot, "A2")["value"] == 70 and widget_spec(snapshot, "A1")["state"]["value"] == 7
    # The cell made a new widget; the old one is closed (no models pile up).
    assert old_model not in widgets.registry.models
    assert len(widgets.registry.models) == models
    # A save the view sends for the closed widget is ignored, not applied elsewhere.
    workbook.update_widget("A1", {"clicks": 99}, model_id=old_model)
    assert workbook._ensure_slot("A1")().clicks == 1

    # The widget's own state, with a binary value (model.save_changes()):
    counter = workbook._ensure_slot("A1")()
    snapshot = workbook.update_widget("A1", {"clicks": 4, "data": {"$binary": base64.b64encode(b"ok").decode()}})
    assert workbook._ensure_slot("A1")() is counter
    assert counter.clicks == 4 and counter.data == b"ok"


def test_removing_a_cell_closes_its_widgets():
    workbook, _ = anywidget_workbook()
    counter = widgets.model_id_of(workbook._ensure_slot("A1")())
    panel = widgets.model_id_of(workbook._ensure_slot("A5")())

    workbook.apply([cell for cell in anywidget_cells() if cell.id != "A5"])
    assert panel not in widgets.registry.models and counter in widgets.registry.models

    workbook.apply([cell for cell in anywidget_cells() if cell.id not in ("A1", "A3", "A5")])
    assert counter not in widgets.registry.models
    assert counter not in workbook._widget_cells


def test_widget_state_is_not_part_of_the_graph():
    workbook, snapshot = anywidget_workbook()
    snapshot = workbook.apply([*anywidget_cells(), CellDefinition("B1", "formula", "counter.clicks + 1", name="peek")])
    error = result(snapshot, "B1")["error"]
    assert error.startswith("WidgetStateError: Cell B1 reads Counter.clicks") and "bind(widget, clicks=my_input)" in error
    snapshot = workbook.apply(
        [
            *anywidget_cells(),
            CellDefinition("B2", "formula", "bind(Counter(), value=scaled)", name="to_formula"),
            CellDefinition("B3", "formula", "bind(Counter(), value=3)", name="to_value"),
            CellDefinition("B4", "formula", "bind(Counter(), nope=count)", name="to_unknown"),
            CellDefinition("B5", "markdown", "Clicks: {{ counter.clicks }}", name="note"),
        ]
    )
    assert "A2 is a formula cell; a widget can only be bound to input cells" in result(snapshot, "B2")["error"]
    assert "bind(value=…) needs an input cell" in result(snapshot, "B3")["error"]
    assert "Counter has no synced trait 'nope'" in result(snapshot, "B4")["error"]
    assert "WidgetStateError" in result(snapshot, "B5")["error"]  # notes too


def test_python_side_widget_changes_reach_the_view():
    workbook, snapshot = anywidget_workbook()
    snapshot = workbook.apply(anywidget_cells(bump="True"))
    assert widget_spec(snapshot, "A1")["state"]["clicks"] == 7  # the effect set it


def test_custom_messages_commands_and_nested_models():
    workbook, snapshot = anywidget_workbook()
    workbook.update_widget("A1", {"clicks": 5})
    snapshot = workbook.widget_message("A1", "reset", [{"$binary": base64.b64encode(b"abc").decode()}])
    assert widget_spec(snapshot, "A1")["state"]["clicks"] == 0  # the handler changed a trait
    (message,) = snapshot.to_dict()["widgetMessages"]
    assert message["cellId"] == "A1" and message["content"] == {"echo": "reset", "sizes": [3]}
    assert message["buffers"] == [{"$binary": base64.b64encode(b"\x01\x02").decode()}]

    # anywidget's experimental.invoke: a command message and its response
    snapshot = workbook.widget_message("A1", {"id": "42", "kind": "anywidget-command", "name": "_double", "msg": 21})
    reply = snapshot.to_dict()["widgetMessages"][-1]
    assert reply["content"]["id"] == "42" and reply["content"]["response"] == {"doubled": 42}

    # a widget that refers to another one: the child's model travels along
    spec = widget_spec(snapshot, "A5")
    child_id = spec["state"]["child"].removeprefix("IPY_MODEL_")
    assert spec["models"][child_id]["state"]["value"] == 2
    panel = workbook._ensure_slot("A5")()
    snapshot = workbook.update_widget("A5", {"clicks": 3}, model_id=child_id)
    assert workbook._ensure_slot("A1")().clicks == 3
    assert widget_spec(snapshot, "A5")["models"][child_id]["state"]["clicks"] == 3
    # The parent only refers to the child: it keeps its instance (and its view's state).
    assert workbook._ensure_slot("A5")() is panel




def test_labels_are_local_and_explicit_references_track_label_changes():
    cells = [
        CellDefinition("A1", "input", "10", name="amount"),
        CellDefinition("B1", "formula", "amount + Budget.amount"),
        CellDefinition("Budget!A1", "input", "20", name="amount"),
        CellDefinition("Budget!B1", "formula", "amount + Main.amount"),
        CellDefinition("Budget!C1", "markdown", "Local {{ amount }} / other {{ Main.amount }}"),
        CellDefinition("Budget!D1", "formula", "amount = 3\namount + Main.amount"),
        CellDefinition("Empty!A1", "formula", "amount"),
    ]
    workbook = ReactiveWorkbook()
    try:
        snapshot = workbook.apply(cells, sheets=["Main", "Budget", "Empty"])
        assert result(snapshot, "B1")["value"] == 30
        assert result(snapshot, "Budget!B1")["value"] == 30
        assert result(snapshot, "Budget!C1")["display"] == "Local 20 / other 10"
        assert result(snapshot, "Budget!D1")["value"] == 13
        assert result(snapshot, "Empty!A1")["error"] is not None
        cells[2] = CellDefinition("Budget!A1", "input", "20", name="cost")
        snapshot = workbook.apply(cells, sheets=["Main", "Budget", "Empty"])
        assert result(snapshot, "B1")["error"] is not None
        assert result(snapshot, "Budget!B1")["error"] is not None
    finally:
        workbook.close()
    with pytest.raises(ValueError, match="Duplicate cell label"):
        from reaktiv_workbook.model import normalize_cells
        normalize_cells([cells[0], CellDefinition("A2", "input", "1", name="amount")])


def test_sheet_local_labels_follow_cross_sheet_moves_without_changing_other_labels():
    from reaktiv_workbook.model import move_cell_group
    cells = [
        CellDefinition("A1", "input", "10", name="amount"),
        CellDefinition("A2", "formula", "amount * 2", name="total"),
        CellDefinition("B1", "formula", "total + amount"),
        CellDefinition("Budget!A1", "input", "20", name="amount"),
        CellDefinition("Budget!B1", "formula", "amount + Main.total"),
    ]
    moved = move_cell_group(cells, ["A2"], "A2", "Budget!C1", ["Main", "Budget"])
    sources = {cell.id: cell.source for cell in moved}
    assert sources["Budget!C1"] == "Main.amount * 2"
    assert sources["B1"] == "Budget.total + amount"
    assert sources["Budget!B1"] == "amount + total"
    snapshot = ReactiveWorkbook().apply(moved, sheets=["Main", "Budget"])
    assert result(snapshot, "Budget!C1")["value"] == 20
    assert result(snapshot, "B1")["value"] == 30
    assert result(snapshot, "Budget!B1")["value"] == 40


@pytest.mark.asyncio
async def test_duplicate_labels_in_resources_and_widget_bindings():
    from reaktiv_workbook.model import SheetTab
    document = SheetDocument(name="Scoped resources", sheet_name="Main", sheets=(SheetTab("Budget"),), code=ANYWIDGET_CODE, cells=(
        CellDefinition("A1", "input", "2", name="count"),
        CellDefinition("A2", "resource", "await asyncio.sleep(0)\nreturn count * 10", name="loaded"),
        CellDefinition("Budget!A1", "input", "5", name="count"),
        CellDefinition("Budget!A2", "resource", "await asyncio.sleep(0)\nreturn count * 10", name="loaded"),
        CellDefinition("Budget!B1", "formula", "loaded + Main.loaded"),
        CellDefinition("Budget!C1", "formula", "bind(Counter(), value=Main.count)"),
    ))
    opened = SheetDocument.loads(document.dumps())
    assert opened == document
    workbook = ReactiveWorkbook()
    try:
        snapshot = await workbook.load_document_async(opened)
        assert result(snapshot, "A2")["value"] == 20
        assert result(snapshot, "Budget!A2")["value"] == 50
        assert result(snapshot, "Budget!B1")["value"] == 70
        spec = widget_spec(snapshot, "Budget!C1")
        assert spec["bindings"]["value"] == "A1"
    finally:
        workbook.close()


def test_per_cell_output_preparation_excludes_evaluation_and_uses_existing_caches(monkeypatch):
    import importlib
    engine = importlib.import_module('reaktiv_workbook.workbook')
    outputs = importlib.import_module('reaktiv_workbook.cell_outputs')
    clock = [0.0]
    monkeypatch.setattr(engine, 'perf_counter', lambda: clock[0])
    monkeypatch.setattr(outputs, 'perf_counter', lambda: clock[0])
    workbook = ReactiveWorkbook()

    def prepare(value):
        clock[0] += 0.25
        return None

    monkeypatch.setattr(outputs, 'rich_output_payload', prepare)
    try:
        first = workbook.apply(cells(('A1', 'formula', "print('once')\n42")))
        assert result(first, 'A1')['value'] == 42
        assert result(first, 'A1')['durationMs'] == 0
        assert result(first, 'A1')['outputPreparationMs'] == 250
        second = workbook.snapshot()
        assert result(second, 'A1')['outputPreparationMs'] == 0
        assert result(second, 'A1')['durationMs'] == 0
        assert len(second.logs) == 1  # profiling did not evaluate the formula again
        assert second.to_dict()['cells'][0]['outputPreparationMs'] == 0
    finally:
        workbook.close()


def test_np_in_cells_is_imported_on_first_use_and_explains_a_missing_numpy(monkeypatch):
    import builtins

    from reaktiv_workbook.optional import OptionalModule

    assert OptionalModule("json").dumps([1]) == "[1]"
    real_import = builtins.__import__

    def without(name, *args, **kwargs):
        if name == "no_such_module_xyz":
            raise ModuleNotFoundError("No module named 'no_such_module_xyz'", name=name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without)
    with pytest.raises(ModuleNotFoundError, match=r"pip install no_such_module_xyz, or run the workbook with --sandbox"):
        _ = OptionalModule("no_such_module_xyz").anything
