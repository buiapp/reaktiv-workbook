from dataclasses import replace
import asyncio
import numpy as np
from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument


def test_initialization_calls_function_cells_once_without_subscribing():
    cells = [
        CellDefinition('A1', 'input', 'make_value()', name='state'),
        CellDefinition('B1', 'formula', 'def make():\n    return np.array([seed, seed + 1])', name='make_value'),
        CellDefinition('C1', 'input', '2', name='seed'),
        CellDefinition('D1', 'formula', 'int(state.sum())'),
    ]
    w = ReactiveWorkbook()
    first = w.apply(cells)
    initial = w.value('A1')
    assert np.array_equal(initial, [2, 3])
    assert not first.dependencies['A1']
    assert first.source_dependencies['A1'] == ['B1']
    w.apply([*cells[:2], replace(cells[2], source='10'), cells[3]])
    assert w.value('A1') is initial
    assert w.value('D1') == 5
    w.apply([replace(cells[0], source='make_value() * 2'), cells[1], replace(cells[2], source='10'), cells[3]])
    assert np.array_equal(w.value('A1'), [20, 22])
    assert w.value('D1') == 42
    w.close()


def test_initializer_roundtrip_and_native_model_are_per_instance():
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', 'make_value()', name='state'),
        CellDefinition('B1', 'formula', 'def make():\n    return [2, 3]', name='make_value'),
        CellDefinition('C1', 'input', '"hello"', name='text'),
    ))
    source = doc.dumps()
    assert '@input_cell' in source
    assert SheetDocument.loads(source).cells == doc.cells
    ns = {'__name__': 'input_test'}
    exec(source, ns)
    model = next(v for v in ns.values() if isinstance(v, type) and getattr(v, '__reaktiv_workbook__', None))
    a, b = model(), model()
    assert a.Sheet1.state() == [2, 3] and a.Sheet1.text() == 'hello'
    assert a.Sheet1.state() is not b.Sheet1.state()
    a.Sheet1.state.set([9])
    assert a.Sheet1.state() == [9] and b.Sheet1.state() == [2, 3]
    assert model(Sheet1={"state": [7]}).Sheet1.state() == [7]


def test_effect_and_host_write_actual_python_objects_without_serializing():
    w = ReactiveWorkbook()
    w.apply([
        CellDefinition('A1', 'input', 'None', name='state'),
        CellDefinition('B1', 'formula', 'None if state is None else state.shape[0]'),
        CellDefinition('C1', 'effect', 'cells.state.set(np.arange(3))', trigger='manual'),
    ])
    snapshot = w.run_effect('C1')
    assert np.array_equal(w.value('A1'), [0, 1, 2])
    assert w.value('B1') == 3
    assert not snapshot.cell_changes
    assert w.document.cells[0].source == 'None'
    value = np.array([4, 5])
    asyncio.run(w.set_input_values_async({'A1': value}))
    assert w.value('A1') is value and w.value('B1') == 2
    w.apply(w.document.cells)
    assert w.value('A1') is value
    w.close()


def test_input_errors_are_reported_and_can_be_repaired():
    w = ReactiveWorkbook()
    bad = CellDefinition('A1', 'input', 'missing_function()')
    assert 'NameError' in w.apply([bad]).cells[0]['error']
    assert w.apply([replace(bad, source='dict(answer=42)')]).cells[0]['error'] is None
    assert w.value('A1') == {'answer': 42}
    assert 'Circular input initialization' in w.apply([replace(bad, source='A1')]).cells[0]['error']
    w.close()


def test_initializers_see_other_edits_and_recover_through_python_writes():
    w = ReactiveWorkbook()
    cells = [CellDefinition('A1', 'input', '0', name='state'),
             CellDefinition('B1', 'formula', 'seed * 2', name='derived'),
             CellDefinition('C1', 'input', '2', name='seed')]
    w.apply(cells)
    w.apply([replace(cells[0], source='derived'), cells[1], replace(cells[2], source='10')])
    assert w.value('A1') == 20
    w.apply([replace(cells[0], source='unknown()'), *cells[1:]])
    asyncio.run(w.set_input_values_async({'A1': np.array([7])}))
    assert np.array_equal(w.value('A1'), [7])
    w.apply(w.document.cells)
    assert np.array_equal(w.value('A1'), [7])
    w.close()


def test_empty_input_and_native_assignment_preserve_signal_semantics():
    doc = SheetDocument(cells=(CellDefinition('A1', 'input', '', name='state'),))
    assert SheetDocument.loads(doc.dumps()).cells == doc.cells
    ns = {'__name__': 'empty_input'}
    exec(doc.dumps(), ns)
    model = next(v for v in ns.values() if isinstance(v, type) and getattr(v, '__reaktiv_workbook__', None))
    instance = model()
    instance.Sheet1.state = [1]
    assert instance.Sheet1.state() == [1]
    w = ReactiveWorkbook()
    assert w.apply(doc.cells).cells[0]['value'] is None
    w.close()


def test_nonliteral_linked_override_resets_and_tracks_its_lifetime():
    w = ReactiveWorkbook()
    w.apply([CellDefinition('A1', 'input', '2', name='seed'),
             CellDefinition('B1', 'linked', 'np.array([seed])', name='state')])
    snapshot = asyncio.run(w.set_input_values_async({'B1': np.array([9])}))
    result = next(cell for cell in snapshot.cells if cell['id'] == 'B1')
    assert result['runtimeOnlyInput'] and result['linkedOverride'] is not None
    assert w.document.cells[1].override is None
    assert np.array_equal(w.value('B1'), [9])
    asyncio.run(w.set_input_values_async({}, reset=['B1']))
    assert np.array_equal(w.value('B1'), [2])
    assert not next(cell for cell in w.snapshot().cells if cell['id'] == 'B1').get('runtimeOnlyInput')
    w.close()
