from dataclasses import replace
import pytest
from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument


def result(snapshot, cell_id):
    return next(cell for cell in snapshot.cells if cell["id"] == cell_id)


def test_custom_input_equality_retains_value_and_skips_dependents():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition(
            "A1",
            "input",
            "1",
            name="amount",
            equal="lambda previous, current: abs(previous - current) < 0.1",
        ),
        CellDefinition("B1", "formula", "amount * 2"),
        CellDefinition("C1", "effect", "print(amount)"),
    ]
    s = w.apply(cells)
    runs = s.effects[0]["triggerCount"]
    s = w.apply([replace(cells[0], source="1.05"), *cells[1:]])
    assert result(s, "A1")["value"] == 1
    assert result(s, "B1")["value"] == 2
    assert s.effects[0]["triggerCount"] == runs
    s = w.apply([replace(cells[0], source="2"), *cells[1:]])
    assert result(s, "B1")["value"] == 4
    assert s.effects[0]["triggerCount"] == runs + 1
    w.close()


def test_custom_formula_equality_is_not_overridden_by_the_slot():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition("A1", "input", "0", name="trigger"),
        CellDefinition(
            "B1",
            "formula",
            "trigger\nobject_value",
            name="value",
            equal="lambda previous, current: False",
        ),
        CellDefinition("C1", "effect", "print(value)"),
    ]
    s = w.apply(cells, code="object_value = [1]")
    runs = s.effects[0]["triggerCount"]
    s = w.apply([replace(cells[0], source="1"), *cells[1:]], code="object_value = [1]")
    assert s.effects[0]["triggerCount"] == runs + 1
    w.close()


def test_equality_changes_rebuild_nodes_and_preserve_defaults():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition(
            "A1", "input", "1", name="number", equal="lambda previous, current: True"
        ),
        CellDefinition("B1", "formula", "repr(number)"),
    ]
    w.apply(cells)
    cells[0] = replace(cells[0], source="True", equal="")
    s = w.apply(cells)
    assert result(s, "B1")["value"] == "True"
    w.close()


def test_invalid_comparators_report_cell_errors_and_can_be_fixed():
    for equal in ["123", "lambda (", "unknown_function"]:
        w = ReactiveWorkbook()
        c = CellDefinition("A1", "input", "1", equal=equal)
        assert result(w.apply([c]), "A1")["error"]
        assert result(w.apply([replace(c, equal="")]), "A1")["value"] == 1
        w.close()


def test_equality_roundtrips_for_all_value_cell_kinds():
    equal = "lambda previous, current: previous == current"
    cells = [
        CellDefinition("A1", "input", "1", equal=equal),
        CellDefinition("A2", "formula", "A1 + 1", equal=equal),
        CellDefinition("A3", "linked", "A1 * 2", equal=equal, override="5"),
        CellDefinition(
            "A4", "resource", "await asyncio.sleep(0.01)\nreturn A1", equal=equal
        ),
        CellDefinition("A5", "markdown", "Value: {{ A1 }}", equal=equal),
    ]
    document = SheetDocument(name="equalities", cells=tuple(cells))
    restored = SheetDocument.loads(document.dumps())
    assert [c.equal for c in restored.cells] == [equal] * 5
    assert [c.to_dict() for c in restored.cells] == [c.to_dict() for c in cells]
    namespace = {"__name__": "equality_fixture"}
    exec(compile(document.dumps(), "equalities.sheet.py", "exec"), namespace)


@pytest.mark.asyncio
async def test_resource_equality_suppresses_equal_loaded_results():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition("A1", "input", "1", name="number"),
        CellDefinition(
            "B1",
            "resource",
            "await asyncio.sleep(0.01)\nreturn number",
            name="loaded",
            equal="lambda previous, current: int(previous) == int(current)",
        ),
        CellDefinition("C1", "formula", "loaded * 2"),
    ]
    s = await w.apply_async(cells)
    assert result(s, "B1")["value"] == 1
    s = await w.apply_async([replace(cells[0], source="1.5"), *cells[1:]])
    assert result(s, "B1")["value"] == 1
    assert result(s, "C1")["value"] == 2
    w.close()


def test_effect_set_of_same_value_honors_always_changed_input_equality():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition(
            "A1", "input", "1", name="number", equal="lambda previous, current: False"
        ),
        CellDefinition("B1", "effect", "print(number)"),
        CellDefinition("C1", "effect", "cells.number.set(1)"),
    ]
    s = w.apply(cells)
    runs = s.effects[0]["triggerCount"]
    s = w.run_effect("C1")
    assert (
        next(effect for effect in s.effects if effect["id"] == "B1")["triggerCount"]
        == runs + 1
    )
    w.close()


def test_default_identity_propagates_fresh_equal_lists_and_value_mode_retains_them():
    for equality, expected_runs in [('', 2), ('values_equal', 1)]:
        executions = []
        w = ReactiveWorkbook({'record': executions.append})
        cells = [CellDefinition('A1', 'input', '0', name='trigger'),
                 CellDefinition('B1', 'formula', 'trigger\n[1, 2]', name='items', equal=equality),
                 CellDefinition('C1', 'effect', 'record(items)')]
        try:
            w.apply(cells)
            w.apply([replace(cells[0], source='1'), *cells[1:]])
            assert len(executions) == expected_runs
            if expected_runs == 2:
                assert executions[0] is not executions[1]
        finally:
            w.close()


def test_explicit_value_comparator_roundtrips_and_executes_as_native_python():
    document = SheetDocument(cells=(CellDefinition('A1', 'input', '[1, 2]', equal='values_equal'),))
    source = document.dumps()
    assert SheetDocument.loads(source).cells[0].equal == 'values_equal'
    namespace = {'__name__': 'explicit_value_equality'}
    exec(compile(source, 'equality.sheet.py', 'exec'), namespace)
