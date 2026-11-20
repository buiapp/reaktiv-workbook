from dataclasses import replace
from reaktiv_workbook import CellDefinition, ReactiveWorkbook


def value(snapshot, id):
    return next(cell["value"] for cell in snapshot.cells if cell["id"] == id)


def test_effect_updates_are_untracked_atomic_and_persist_comments():
    w = ReactiveWorkbook()
    cells = [
        CellDefinition("A1", "input", "0", name="trigger"),
        CellDefinition("A2", "input", "# Count\n0", name="counter"),
        CellDefinition("B1", "formula", "counter * 2"),
        CellDefinition(
            "C1",
            "effect",
            "trigger\ncells.counter.update(lambda counter: counter + 1)\ncells.counter.update(lambda counter: counter + 1)",
        ),
    ]
    s = w.apply(cells)
    assert value(s, "A2") == 2
    assert value(s, "B1") == 4
    assert s.dependencies["C1"] == ["A1"]
    assert next(c.source for c in w.document.cells if c.id == "A2") == "# Count\n2"
    assert s.to_dict()["cellChanges"][0]["id"] == "A2"
    saved = cells.copy()
    saved[1] = next(c for c in w.document.cells if c.id == "A2")
    s = w.apply([replace(saved[0], source="1"), *saved[1:]])
    assert value(s, "A2") == 4
    assert value(s, "B1") == 8
    assert w.snapshot().to_dict().get("cellChanges") is None
    w.close()


def test_invalid_writes_and_failed_effects_do_not_change_inputs():
    for source in [
        'cells.count.set(3)\nraise ValueError("failed")',
        "cells.count.set(3)\ncells.derived.set(4)",
    ]:
        w = ReactiveWorkbook()
        s = w.apply(
            [
                CellDefinition("A1", "input", "1", name="count"),
                CellDefinition("B1", "formula", "count * 2", name="derived"),
                CellDefinition("C1", "effect", source),
            ]
        )
        assert value(s, "A1") == 1
        assert s.effects[0]["error"]
        assert not s.cell_changes
        w.close()
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "1", name="count"),
            CellDefinition("B1", "formula", "cells.count.set(2)"),
        ]
    )
    assert "Only effect" in s.cells[1]["error"]
    assert value(s, "A1") == 1
    w.close()


def test_linked_override_and_reset_from_effects():
    w = ReactiveWorkbook()
    w.apply(
        [
            CellDefinition("A1", "input", "10", name="base"),
            CellDefinition("B1", "linked", "base * 2", name="price"),
            CellDefinition("C1", "effect", "cells.price.set(7)"),
            CellDefinition("D1", "effect", "cells.price.reset()"),
        ]
    )
    # Both ran once on apply; running them again (Run effect) sets and resets the override.
    assert value(w.run_effect("D1"), "B1") == 20
    assert value(w.run_effect("C1"), "B1") == 7
    assert next(c.override for c in w.document.cells if c.id == "B1") == "7"
    assert value(w.run_effect("D1"), "B1") == 20
    assert next(c.override for c in w.document.cells if c.id == "B1") is None
    w.close()


def test_explicit_handle_reads_are_dependencies_and_feedback_is_bounded():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "1", name="count"),
            CellDefinition("B1", "formula", "cells.count.get() * 2"),
            CellDefinition("C1", "effect", "cells.count.set(count + 1)"),
        ]
    )
    assert s.dependencies["B1"] == ["A1"]
    assert "feedback loop" in s.effects[0]["error"].lower()
    assert value(s, "A1") <= 51
    w.close()


def test_sheet_local_handles_and_qualified_handles():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "0", name="count"),
            CellDefinition("Other!A1", "input", "0", name="count"),
            CellDefinition(
                "Other!B1", "effect", "cells.count.set(2)\ncells.Sheet1.count.set(3)"
            ),
        ],
        sheets=["Sheet1", "Other"],
    )
    assert value(s, "A1") == 3
    assert value(s, "Other!A1") == 2
    w.close()


def test_history_restore_does_not_repeat_writes_and_later_effects_still_work():
    w = ReactiveWorkbook()
    original = [
        CellDefinition("A1", "input", "0", name="trigger"),
        CellDefinition("A2", "input", "0", name="counter"),
        CellDefinition(
            "B1", "effect", "trigger\ncells.counter.update(lambda n: n + 1)"
        ),
    ]
    w.apply(original)
    before = list(w.document.cells)
    w.apply([replace(c, source="1") if c.id == "A1" else c for c in before])
    after = list(w.document.cells)
    assert value(w.apply(before, allow_cell_writes=False), "A2") == 1
    assert value(w.apply(after, allow_cell_writes=False), "A2") == 2
    assert (
        value(
            w.apply([replace(c, source="2") if c.id == "A1" else c for c in after]),
            "A2",
        )
        == 3
    )
    w.close()


def test_failed_mutable_update_does_not_mutate_stored_value():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "[1]", name="items"),
            CellDefinition(
                "B1",
                "effect",
                'def change(items):\n    items.append(2)\n    raise ValueError("fail")\ncells.items.update(change)',
            ),
        ]
    )
    assert value(s, "A1") == [1]
    assert s.effects[0]["error"]
    w.close()


def test_convergent_self_write_and_chained_effects_settle():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "0", name="a"),
            CellDefinition("A2", "input", "0", name="b"),
            CellDefinition("B1", "effect", "if a < 3:\n    cells.a.set(a + 1)"),
            CellDefinition("B2", "effect", "cells.b.set(a * 2)"),
        ]
    )
    assert value(s, "A1") == 3
    assert value(s, "A2") == 6
    assert not any(effect["error"] for effect in s.effects)
    w.close()


def test_numpy_scalars_and_read_your_writes_use_literal_values():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "0", name="count"),
            CellDefinition("B1", "input", "0", name="observed"),
            CellDefinition(
                "C1",
                "effect",
                "cells.count.set(np.int64(4))\ncells.observed.set(cells.count.get())",
            ),
        ]
    )
    s = w.run_effect("C1")
    assert value(s, "A1") == 4 and value(s, "B1") == 4
    assert all(c.source == "4" for c in w.document.cells if c.kind == "input")
    w.close()


def test_detached_handles_track_reads_and_bound_feedback():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "0", name="count"),
            CellDefinition(
                "B1", "effect", "target = cells.count\ntarget.set(target.get() + 1)"
            ),
        ]
    )
    assert s.dependencies["B1"] == ["A1"]
    assert "feedback loop" in s.effects[0]["error"].lower()
    assert value(s, "A1") <= 50
    w.close()


def test_writes_keep_literal_types_and_runtime_values_in_sync():
    for before, after in [
        ("1", "True"),
        ("1", "1.0"),
        ("[1]", "[1.0]"),
        ("{1: 1}", "{1.0: True}"),
    ]:
        w = ReactiveWorkbook()
        s = w.apply(
            [
                CellDefinition("A1", "input", before, name="target"),
                CellDefinition("B1", "formula", "repr(target)"),
                CellDefinition("C1", "effect", f"cells.target.set({after})"),
            ]
        )
        assert value(s, "B1") == after
        assert next(c.source for c in w.document.cells if c.id == "A1") == after
        w.close()


def test_feedback_between_effects_is_reported_without_breaking_the_workbook():
    w = ReactiveWorkbook()
    s = w.apply(
        [
            CellDefinition("A1", "input", "0", name="a"),
            CellDefinition("A2", "input", "0", name="b"),
            CellDefinition("B1", "effect", "cells.b.set(a + 1)"),
            CellDefinition("B2", "effect", "cells.a.set(b + 1)"),
        ]
    )
    assert any(
        "feedback loop" in (effect["error"] or "").lower() for effect in s.effects
    )
    assert max(value(s, "A1"), value(s, "A2")) <= 105
    w.close()


def test_generated_workbook_handles_execute_outside_the_app():
    from pathlib import Path

    namespace = {"__name__": "effect_write_fixture"}
    fixture = (
        Path(__file__).parents[1]
        / "fixtures/workbooks/effect-input-writes.app.sheet.py"
    )
    exec(compile(fixture.read_text(), str(fixture), "exec"), namespace)
    model = namespace["EffectInputWritesWorkbook"]()
    assert model.Sheet1.counter() == 5
    assert model.Sheet1.price() == 7
    assert model.Sheet1.b2() == 12
    model.Sheet1.reset_price.set(True)  # D1 resets the linked price
    assert model.Sheet1.price() == 10
    model.dispose()


def test_native_reset_uses_the_original_derivation_of_a_saved_override():
    from pathlib import Path

    fixture = (
        Path(__file__).parents[1]
        / "fixtures/workbooks/effect-input-writes.app.sheet.py"
    )
    source = fixture.read_text().replace(
        '@cell("B1", label="price")', '@cell("B1", label="price", override="7")'
    )
    namespace = {"__name__": "saved_override_fixture"}
    exec(compile(source, str(fixture), "exec"), namespace)
    model = namespace["EffectInputWritesWorkbook"]()
    assert model.Sheet1.price() == 7
    model.Sheet1.reset_price.set(True)  # D1 resets the linked price
    assert model.Sheet1.price() == 10
    model.dispose()
