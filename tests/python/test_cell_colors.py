from dataclasses import replace

import pytest
from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.model import SheetTab
from reaktiv_workbook.moves import move_workbook


def result(snapshot, cell_id='B1'):
    return next(cell for cell in snapshot.cells if cell['id'] == cell_id)


@pytest.mark.asyncio
async def test_color_is_a_cached_reactive_leaf_separate_from_cell_value():
    runs = []
    w = ReactiveWorkbook(globals={'runs': runs})
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '20', name='temperature'),
        CellDefinition('B1', 'formula', "runs.append('value')\n42", color='#eeeeee',
                       view={'color': {'expr': "'#FFCCCC' if temperature > 80 else '#CCFFCC'"}}),
    ))
    first = await w.load_document_async(doc)
    assert result(first)['color'] == '#ccffcc'
    assert result(first)['colorDependencies'] == ['A1']
    assert first.dependencies['B1'] == []
    next_snapshot = await w.set_input_values_async({'A1': 90})
    assert result(next_snapshot)['color'] == '#ffcccc'
    assert result(next_snapshot)['value'] == 42
    assert runs == ['value']
    w.close()


@pytest.mark.asyncio
async def test_cross_sheet_colors_errors_clearing_and_signal_reads():
    from reaktiv import Signal
    status = Signal('#123456')
    w = ReactiveWorkbook(globals={'status': status})
    doc = SheetDocument(sheets=(SheetTab('Other'),), cells=(
        CellDefinition('Other!A1', 'input', "'#abcdef'", name='status_color'),
        CellDefinition('A1', 'input', '1', color='#eeeeee', view={'color': {'expr': 'Other.status_color'}}),
        CellDefinition('B1', 'input', '2', view={'color': {'expr': 'status()'}}),
    ))
    snapshot = await w.load_document_async(doc)
    assert result(snapshot, 'A1')['color'] == '#abcdef'
    assert result(snapshot)['color'] == '#123456'
    status.set('#654321')
    assert result(w.snapshot())['color'] == '#654321'
    snapshot = await w.set_input_values_async({'Other!A1': 'invalid'})
    assert result(snapshot, 'A1')['error'] is None
    assert 'colorError' in result(snapshot, 'A1')
    assert result(snapshot, 'A1')['value'] == 1
    snapshot = await w.set_input_values_async({'Other!A1': None})
    assert result(snapshot, 'A1')['color'] == ''
    assert 'colorError' not in result(snapshot, 'A1')
    w.close()


@pytest.mark.asyncio
async def test_color_references_follow_moves_and_roundtrip_as_native_lambdas():
    doc = SheetDocument(cells=(CellDefinition('A1', 'input', "'#123456'"),
        CellDefinition('B1', 'input', '7', view={'color': {'expr': 'A1'}})))
    source = doc.dumps()
    assert '"color": lambda self:' in source
    assert SheetDocument.loads(source).cells == doc.cells
    w = ReactiveWorkbook()
    await w.load_document_async(doc)
    await move_workbook(w, w.revision, 'A1', 'A2')
    assert next(cell for cell in w.document.cells if cell.id == 'B1').view == {'color': {'expr': 'A2'}}
    assert result(w.snapshot())['color'] == '#123456'
    await w.load_document_async(replace(w.document, cells=tuple(replace(cell, view=None) if cell.id == 'B1' else cell for cell in w.document.cells)))
    assert 'color' not in result(w.snapshot())
    w.close()


@pytest.mark.parametrize('color', ['red', {'expr': ''}, {'expr': 'if ???'}, {'expr': 1}])
def test_color_expression_validation(color):
    with pytest.raises((ValueError, SyntaxError)):
        CellDefinition('A1', 'input', '1', view={'color': color})


def test_installing_and_caching_color_configuration_preserves_live_input_object():
    w = ReactiveWorkbook()
    cells = [CellDefinition('A1', 'input', '[1, 2]'), CellDefinition('B1', 'input', 'True')]
    w.apply(cells)
    value = w.value('A1')
    cells[0] = replace(cells[0], view={'color': {'expr': "'#123456' if B1 else None"}})
    first = w.apply(cells)
    node = w._color_configs['A1'][1]
    assert result(first, 'A1')['color'] == '#123456'
    assert w.value('A1') is value
    w.apply([cells[0], replace(cells[1], source='False')])
    assert w._color_configs['A1'][1] is node
    assert w.value('A1') is value
    assert result(w.snapshot(), 'A1')['color'] == ''
    w.close()
