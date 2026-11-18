from dataclasses import replace
import json
import pytest
from reaktiv import LinkedSignal
from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.cli import main


def definitions(override=None):
    return [CellDefinition('A1', 'input', '10', name='base'), CellDefinition('B1', 'linked', 'base * 2', name='price', override=override), CellDefinition('C1', 'formula', 'price + 1')]


def result(snapshot, id):
    return next(cell for cell in snapshot.cells if cell['id'] == id)


def test_linked_default_override_reset_and_dependency_changes():
    workbook = ReactiveWorkbook()
    cells = definitions()
    assert result(workbook.apply(cells), 'B1')['value'] == 20
    assert isinstance(workbook._nodes['B1'], LinkedSignal)
    manual = definitions('7')
    first = workbook.apply(manual)
    assert result(first, 'B1')['value'] == 7
    assert result(first, 'B1')['linkedOverride'] == '7'
    assert result(first, 'C1')['value'] == 8
    assert workbook.snapshot().dependencies['B1'] == ['A1']
    assert result(workbook.apply(manual), 'B1')['value'] == 7
    reset = workbook.apply(cells)
    assert result(reset, 'B1')['value'] == 20
    assert result(reset, 'B1')['linkedOverride'] is None
    workbook.apply(manual)
    changed = workbook.apply([replace(manual[0], source='12'), *manual[1:]])
    assert result(changed, 'B1')['value'] == 24
    assert result(changed, 'B1')['linkedOverride'] is None
    assert workbook.document.cells[1].override is None
    # A subsequent unrelated apply must not resurrect the stale override.
    refreshed = list(workbook.document.cells)
    assert result(workbook.apply(refreshed), 'B1')['value'] == 24
    workbook.close()


def test_restore_and_undo_apply_override_after_all_dependencies_change():
    workbook = ReactiveWorkbook()
    original = definitions('7')
    assert result(workbook.apply(original), 'B1')['value'] == 7
    changed = [replace(original[0], source='12'), *original[1:]]
    assert result(workbook.apply(changed), 'B1')['value'] == 24
    restored = workbook.apply(original)
    assert result(restored, 'B1')['value'] == 7
    assert result(restored, 'B1')['linkedOverride'] == '7'
    # Editing the derivation clears a manual override.
    edited = workbook.apply([original[0], replace(original[1], source='base * 3', override=None), original[2]])
    assert result(edited, 'B1')['value'] == 30
    assert result(edited, 'B1')['linkedOverride'] is None
    workbook.close()


def test_linked_save_reopen_plain_python_and_cli(tmp_path, capsys):
    doc = SheetDocument(name='Linked', cells=tuple(definitions('7')))
    source = doc.dumps()
    assert '@linked' in source and 'override="7"' in source
    reopened = SheetDocument.loads(source)
    assert reopened.cells[1].kind == 'linked'
    assert reopened.cells[1].source == 'base * 2'
    assert reopened.cells[1].override == '7'
    namespace = {'__name__': 'test_model'}
    exec(source, namespace)
    model_type = next(value for value in namespace.values() if isinstance(value, type) and getattr(value, '__reaktiv_workbook__', None))
    first, second = model_type(), model_type()
    assert first.Sheet1.price() == second.Sheet1.price() == 7
    first.Sheet1.base.set(12)
    assert first.Sheet1.price() == 24 and second.Sheet1.price() == 7
    file = tmp_path / 'linked.sheet.py'
    doc.save(file)
    assert main([str(file), '--set', 'price=9', '--check', '--json']) == 0
    payload = json.loads(capsys.readouterr().out)
    assert result(type('Snapshot', (), {'cells': payload['cells']}), 'B1')['value'] == 9


@pytest.mark.parametrize('source,expected', [('0', 0), ('False', False), ('None', None), ('""', ''), ('[1, 2]', [1, 2])])
def test_falsy_and_container_overrides_are_distinct_from_no_override(source, expected):
    workbook = ReactiveWorkbook()
    snapshot = workbook.apply(definitions(source)[:2])
    assert result(snapshot, 'B1')['value'] == expected
    assert result(snapshot, 'B1')['linkedOverride'] == source
    workbook.close()


def test_overriding_linked_input_does_not_rerun_derivation_or_lose_clock():
    workbook = ReactiveWorkbook()
    cells = [CellDefinition('A1', 'input', '10', name='base'), CellDefinition('B1', 'linked', 'every(1)\nmeasure(base)', name='linked_value')]
    first = workbook.apply(cells, code='calls = []\ndef measure(value):\n    calls.append(value)\n    return value')
    assert first.timers and workbook._import_globals['calls'] == [10]
    manual = workbook.apply([cells[0], replace(cells[1], override='7')])
    assert result(manual, 'B1')['value'] == 7
    assert workbook._import_globals['calls'] == [10]
    assert manual.timers
    ticked = workbook.tick_timer('B1')
    assert result(ticked, 'B1')['value'] == 10
    assert result(ticked, 'B1')['linkedOverride'] is None
    workbook.close()


def test_invalid_derivation_reports_cell_error_without_losing_saved_override():
    workbook = ReactiveWorkbook()
    failed = workbook.apply([CellDefinition('B1', 'linked', '1 / 0', override='7')])
    assert 'ZeroDivisionError' in result(failed, 'B1')['error']
    assert workbook.document.cells[0].override == '7'
    assert result(failed, 'B1')['linkedOverride'] == '7'
    workbook.close()


def advanced_cells():
    return [
        CellDefinition('A1', 'input', '[1, 2, 3]', name='options'),
        CellDefinition('B1', 'linked', 'options', name='selected', computation='# Keep the selection while valid.\nprevious.value if previous is not None and previous.value in source else source[0]'),
        CellDefinition('C1', 'formula', 'selected * 10'),
    ]


def test_linked_previous_state_preserves_valid_override_and_reset_starts_fresh():
    workbook = ReactiveWorkbook()
    cells = advanced_cells()
    assert result(workbook.apply(cells), 'B1')['value'] == 1
    assert result(workbook.apply([cells[0], replace(cells[1], override='2'), cells[2]]), 'B1')['value'] == 2
    changed = workbook.apply([replace(cells[0], source='[1, 2, 4]'), *workbook.document.cells[1:]])
    assert result(changed, 'B1')['value'] == 2
    assert result(changed, 'B1')['linkedOverride'] is None
    assert result(changed, 'C1')['value'] == 20
    assert workbook.snapshot().dependencies['B1'] == ['A1']
    # Reset means fresh derivation, not retaining the previous selection.
    workbook.apply([workbook.document.cells[0], replace(cells[1], override='4'), cells[2]])
    reset = workbook.apply([workbook.document.cells[0], cells[1], cells[2]])
    assert result(reset, 'B1')['value'] == 1
    invalid = workbook.apply([replace(cells[0], source='[3, 4]'), cells[1], cells[2]])
    assert result(invalid, 'B1')['value'] == 3
    workbook.close()


def test_previous_value_source_and_untracked_computation_reads():
    workbook = ReactiveWorkbook()
    cells = [CellDefinition('A1', 'input', '10'), CellDefinition('B1', 'input', '1'),
             CellDefinition('C1', 'linked', 'A1', computation='(None if previous is None else (previous.source, previous.value), source, B1)')]
    assert result(workbook.apply(cells), 'C1')['value'] == [None, 10, 1]
    # Reads in computation do not subscribe, just like native LinkedSignal.
    assert result(workbook.apply([cells[0], replace(cells[1], source='2'), cells[2]]), 'C1')['value'] == [None, 10, 1]
    workbook.apply([cells[0], replace(cells[1], source='2'), replace(cells[2], override='None')])
    updated = workbook.apply([replace(cells[0], source='20'), replace(cells[1], source='2'), *workbook.document.cells[2:]])
    assert result(updated, 'C1')['value'] == [[10, None], 20, 2]
    workbook.close()


def test_advanced_linked_file_round_trip_and_native_model_match():
    cells = advanced_cells()
    doc = SheetDocument(cells=tuple(cells))
    source = doc.dumps()
    loaded = SheetDocument.loads(source)
    assert loaded.cells == doc.cells
    assert not loaded.actions  # computation helper is not an action
    assert '# Keep the selection while valid.' in source
    namespace = {'__name__': 'linked_native_test'}
    exec(source, namespace)
    model_type = next(item for item in namespace.values() if isinstance(item, type) and getattr(item, '__reaktiv_workbook__', None))
    first, second = model_type(), model_type()
    assert first.Sheet1.selected() == second.Sheet1.selected() == 1
    first.Sheet1.selected.set(2)
    first.Sheet1.options.set([1, 2, 4])
    assert first.Sheet1.selected() == 2
    first.Sheet1.options.set([3, 4])
    assert first.Sheet1.selected() == 3
    assert second.Sheet1.selected() == 1


def test_advanced_linked_clock_logs_and_failed_computation_cleanup():
    workbook = ReactiveWorkbook()
    cells = [CellDefinition('A1', 'input', 'False'), CellDefinition('B1', 'linked', 'every(1)\nprint("source")\nA1', computation='print("computation")\nif source:\n    raise ValueError("bad computation")\nreturn 1 if previous is None else previous.value + 1')]
    initial = workbook.apply(cells)
    assert initial.timers and result(initial, 'B1')['value'] == 1
    ticked = workbook.tick_timer('B1')
    assert ticked.timers and result(ticked, 'B1')['value'] == 2
    assert workbook.snapshot().dependencies['B1'] == ['A1']
    failed = workbook.apply([replace(cells[0], source='True'), cells[1]])
    assert 'bad computation' in result(failed, 'B1')['error']
    recovered = workbook.apply(cells)
    assert result(recovered, 'B1')['value'] == 3
    assert recovered.timers
    workbook.close()


def test_linked_computation_locals_annotations_and_method_name_collisions():
    cells = [CellDefinition('A1', 'input', '5', name='source'),
             CellDefinition('B1', 'input', '99', name='previous'),
             CellDefinition('C1', 'input', '0', name='_selected_computation'),
             CellDefinition('D1', 'linked', 'source', name='selected', annotation='int', computation='value = previous.value if previous is not None else source\nreturn min(value, A1)')]
    doc = SheetDocument(cells=tuple(cells))
    source = doc.dumps()
    loaded = SheetDocument.loads(source)
    assert loaded == doc
    assert 'def __selected_computation(self, source, previous) -> int:' in source
    workbook = ReactiveWorkbook()
    assert result(workbook.apply(loaded.cells), 'D1')['value'] == 5
    assert workbook.snapshot().source_dependencies['D1'] == ['A1']
    workbook.close()


def test_moving_linked_cells_rewrites_both_stages_and_preserves_callback_locals():
    from reaktiv_workbook import move_cells
    cells = [CellDefinition('A1', 'input', '5', name='limit'),
             CellDefinition('B1', 'linked', 'A1', computation='min(source, A1) if previous is None else previous.value')]
    moved = move_cells(cells, 'A1', 'A2')
    linked = next(cell for cell in moved if cell.id == 'B1')
    assert linked.source == 'A2'
    assert linked.computation == 'min(source, A2) if previous is None else previous.value'


def test_linked_computation_file_supports_explicit_cell_handles_in_both_stages():
    document = SheetDocument(cells=(CellDefinition('A1', 'input', '10', name='limit'),
        CellDefinition('B1', 'linked', 'cells.limit.get()', name='page', computation='cells.limit.get() if previous is None else min(source, previous.value)')))
    source = document.dumps()
    assert SheetDocument.loads(source) == document
    namespace = {'__name__': 'explicit_linked_test'}
    exec(source, namespace)
    model_type = next(value for value in namespace.values() if isinstance(value, type) and getattr(value, '__reaktiv_workbook__', None))
    model = model_type()
    assert model.Sheet1.page() == 10
    model.Sheet1.page.set(8)
    model.Sheet1.limit.set(5)
    assert model.Sheet1.page() == 5
