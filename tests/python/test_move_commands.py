import json
import pytest
from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.model import SheetTab
from reaktiv_workbook.moves import MoveConflict, MoveRejected, move_workbook
from reaktiv_workbook.actions import ActionDefinition
from reaktiv_workbook.sheets import ReferenceScope, iter_coordinate_references


def test_cached_analysis_resolves_each_scope_and_source_independently():
    source = 'amount + A1 + Other.total + cells.A2'
    left = ReferenceScope({'amount':'B1','Other!total':'Other!C1'},'',{'Sheet1':'','Other':'Other'})
    right = ReferenceScope({'New!amount':'New!D1','Other!total':'Other!E1'},'New',{'Sheet1':'','Other':'Other','New':'New'})
    assert [v for _,_,v in iter_coordinate_references(source,left)] == ['B1','A1','Other!C1','A2']
    assert [v for _,_,v in iter_coordinate_references(source,right)] == ['New!D1','New!A1','Other!E1','New!A2']
    assert [v for _,_,v in iter_coordinate_references('amount + A3',right)] == ['New!D1','New!A3']


@pytest.mark.asyncio
async def test_large_literal_move_is_sparse_does_not_analyze_buffer_or_initialize_again(monkeypatch):
    import reaktiv_workbook.source_analysis as analysis
    source = '[' + ','.join(['255'] * 250000) + ']'
    w = ReactiveWorkbook()
    cells = [CellDefinition('A1','input',source,name='buffer'), CellDefinition('B1','markdown','Heading')]
    w.apply(cells)
    original = w.value('A1')
    tokenize = analysis.tokenize.generate_tokens
    def guarded(readline):
        import io
        lines = []
        while line := readline():
            lines.append(line)
        text = ''.join(lines)
        assert len(text) < 100000, 'large unchanged buffer was tokenized'
        return tokenize(io.StringIO(text).readline)
    monkeypatch.setattr(analysis.tokenize,'generate_tokens',guarded)
    result = await move_workbook(w,w.revision,'A1','A2')
    assert w.value('A2') is original
    assert result['patches'] == [{'previousId':'A1','changes':{'id':'A2'}}]
    assert len(json.dumps(result)) < 20000
    w.close()


@pytest.mark.asyncio
async def test_move_evaluates_current_implementation_once_and_keeps_unrelated_cached():
    counts = []
    w = ReactiveWorkbook(globals={'counts':counts})
    cells = [CellDefinition('A1','input','3',name='amount'),
             CellDefinition('B1','formula',"counts.append('dependent')\namount*2"),
             CellDefinition('C1','formula',"counts.append('unrelated')\n42")]
    first = w.apply(cells)
    counts.clear()
    result = await move_workbook(w,first.workbook_revision,'A1','A2')
    assert counts == ['dependent']
    assert w.value('B1') == 6
    assert not result['graph']['rebuilt']
    with pytest.raises(MoveConflict):
        await move_workbook(w,first.workbook_revision,'A2','A3')
    assert w.value('A2') == 3
    w.close()


@pytest.mark.asyncio
async def test_move_preserves_opaque_input_values_and_swaps_identical_initializers():
    w = ReactiveWorkbook()
    w.apply([CellDefinition('A1','input','None'),CellDefinition('B1','input','None')])
    left,right = object(),object()
    await w.set_input_values_async({'A1':left,'B1':right})
    await move_workbook(w,w.revision,'A1','B1')
    assert w.value('A1') is right
    assert w.value('B1') is left
    w.close()


@pytest.mark.asyncio
async def test_cross_sheet_group_move_rewrites_references_widgets_and_action_bindings():
    action = ActionDefinition('change','def change(self, value=1):\n    self.amount.set(value)',
        references={'amount':'A1'},bindings={'value':{'cell':'B1'}})
    doc = SheetDocument(sheets=(SheetTab('Other'),), cells=(CellDefinition('A1','input','3',name='amount'),
        CellDefinition('B1','formula','A1*2'),CellDefinition('C1','markdown','{{ A1 }}')),actions=(action,))
    w = ReactiveWorkbook()
    await w.load_document_async(doc)
    result = await move_workbook(w,w.revision,'A1','Other!A2',['A1','B1'])
    assert w.value('Other!A2') == 3
    assert w.value('Other!B2') == 6
    assert w.document.actions[0].references['amount'] == 'Other!A2'
    assert w.document.actions[0].bindings['value'] == {'cell':'Other!B2'}
    assert 'Other.A2' in next(c.source for c in w.document.cells if c.id=='C1')
    assert result['graph']['workbookRevision'] == w.revision
    w.close()


@pytest.mark.asyncio
async def test_browser_move_command_uses_the_same_live_implementation(monkeypatch):
    import reaktiv_workbook.browser as browser
    w = ReactiveWorkbook()
    monkeypatch.setattr(browser,'_workbook',w)
    initial = json.loads(await browser.apply_model_async(json.dumps([
        {'id':'A1','kind':'input','source':'3','name':'amount'},
        {'id':'B1','kind':'formula','source':'amount*2'}])))
    result = json.loads(await browser.move_workbook_command(json.dumps({
        'expectedRevision':initial['workbookRevision'],'sourceId':'A1','targetId':'A2'})))
    assert result['patches'] == [{'previousId':'A1','changes':{'id':'A2'}}]
    assert w.value('B1') == 6
    w.close()

@pytest.mark.asyncio
async def test_move_preserves_stopped_addresses_and_opaque_linked_override():
    w = ReactiveWorkbook()
    w.apply([CellDefinition('A1', 'input', '3'),
             CellDefinition('B1', 'linked', 'A1 * 2'),
             CellDefinition('C1', 'formula', '1 / 0')])
    value = object()
    await w.set_input_values_async({'B1': value})
    w._stopped.add('C1')
    await move_workbook(w, w.revision, 'B1', 'B2')
    assert w.value('B2') is value
    assert 'B2' in w._runtime_inputs
    await move_workbook(w, w.revision, 'C1', 'C2')
    assert 'C2' in w._stopped and 'C1' not in w._stopped
    w.close()


@pytest.mark.asyncio
async def test_runtime_literal_writes_prime_scope_independent_analysis():
    from reaktiv_workbook.source_analysis import known_literal
    w = ReactiveWorkbook()
    w.apply([CellDefinition('A1', 'input', 'None')])
    await w.set_input_values_async({'A1': list(range(1000))})
    source = w.document.cells[0].source
    assert known_literal(source)
    w.close()


@pytest.mark.parametrize('target', ['B1', 'B2', 'C3'])
def test_group_move_rejects_positions_inside_an_existing_span(target):
    from reaktiv_workbook.model import move_cell_group
    cells = (CellDefinition('A1', 'input', '1', view={'span': [3, 3]}), CellDefinition('E1', 'input', '2'))
    with pytest.raises(ValueError, match='overlap'):
        move_cell_group(cells, ['E1'], 'E1', target)
    assert cells[1].id == 'E1'


def test_moving_tile_cannot_cover_filled_anchors_or_intersect_other_tiles():
    from reaktiv_workbook.model import move_cell_group, move_cells
    for target in (CellDefinition('E3', 'input', '2'), CellDefinition('E2', 'input', '2', view={'span': [2, 2]})):
        cells = (CellDefinition('A1', 'input', '1', view={'span': [3, 3]}), target)
        for move in (lambda: move_cells(cells, 'A1', 'C1'), lambda: move_cell_group(cells, ['A1'], 'A1', 'C1')):
            with pytest.raises(ValueError, match='overlap'):
                move()


def test_group_move_vacates_its_old_footprints_and_allows_adjacent_edges():
    from reaktiv_workbook.model import move_cell_group
    cells = (CellDefinition('A1', 'input', '1', view={'span': [2, 2]}), CellDefinition('C1', 'input', '2'))
    moved = move_cell_group(cells, ['A1', 'C1'], 'A1', 'B1')
    assert {cell.id for cell in moved} == {'B1', 'D1'}


def test_span_collisions_are_sheet_scoped_and_swaps_use_both_final_footprints():
    from reaktiv_workbook.model import move_cell_group, move_cells
    cells = (CellDefinition('A1', 'input', '1'), CellDefinition('Other!A1', 'input', '2', view={'span': [3, 3]}))
    with pytest.raises(ValueError, match='overlap'):
        move_cell_group(cells, ['A1'], 'A1', 'Other!B2', ['Sheet1', 'Other'])
    assert {cell.id for cell in move_cells(cells, 'A1', 'Other!A1', ['Sheet1', 'Other'])} == {'A1', 'Other!A1'}
    blocked_swap = (CellDefinition('A1', 'input', '1', view={'span': [2, 2]}), CellDefinition('D1', 'input', '2'), CellDefinition('E2', 'input', '3'))
    with pytest.raises(ValueError, match='overlap'):
        move_cells(blocked_swap, 'A1', 'D1')


@pytest.mark.asyncio
async def test_rejected_live_move_leaves_revision_source_and_values_untouched():
    w = ReactiveWorkbook()
    try:
        cells = (CellDefinition('A1', 'input', '1', view={'span': [3, 3]}), CellDefinition('E1', 'input', '2'))
        w.apply(cells)
        revision, source = w.revision, w.document.dumps()
        with pytest.raises(ValueError, match='overlap'):
            await move_workbook(w, revision, 'E1', 'B2', ['E1'])
        assert w.revision == revision
        assert w.document.dumps() == source
        assert w.value('E1') == 2
    finally:
        w.close()


@pytest.mark.asyncio
async def test_move_updates_action_handles_bindings_and_minimal_member_targets():
    action = ActionDefinition('capture', '''def capture(self):
    # self.cells.Other.A1 is a comment
    text = "self.cells.Other.A1"
    self.cells.Other.A1.set(self.sample())
    return self.cells.Other.A1()''', references={'sample': 'A1', 'unused': 'Other!A1'},
        bindings={})
    doc = SheetDocument(cells=(CellDefinition('A1', 'input', '7', name='sample'),
        CellDefinition('Other!A1', 'input', '0')), sheets=(SheetTab('Other'),), actions=(action,))
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc)
        await move_workbook(w, w.revision, 'Other!A1', 'Other!B2')
        moved = w.document.actions[0]
        assert moved.references == {'sample': 'A1'}
        assert 'self.cells.Other.B2.set' in moved.source
        assert 'return self.cells.Other.B2()' in moved.source
        assert 'text = "self.cells.Other.A1"' in moved.source
        await w.run_action_async('capture')
        assert w.value('Other!B2') == 7
        saved = SheetDocument.loads(w.document.dumps())
        assert 'self.Other.b2.set(self.Sheet1.sample())' in saved.actions[0].source
        assert saved.actions[0].references == {'Sheet1.sample': 'A1', 'Other.b2': 'Other!B2'}
        assert 'text = "self.cells.Other.A1"' in saved.actions[0].source
    finally:
        w.close()


@pytest.mark.asyncio
async def test_rejected_move_leaves_revision_values_and_definitions_ready_for_next_move():
    w = ReactiveWorkbook()
    w.apply([CellDefinition('A1', 'input', '[1, 2]'),
             CellDefinition('B1', 'input', '3', view={'span': [2, 3]})])
    revision, document, value = w.revision, w.document, w.value('A1')
    with pytest.raises(MoveRejected, match='overlap'):
        await move_workbook(w, revision, 'A1', 'B2')
    assert w.revision == revision
    assert w.document == document
    assert w.value('A1') is value
    await move_workbook(w, revision, 'A1', 'A2')
    assert w.value('A2') is value
    w.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('prefix', ['', 'Other!'])
async def test_two_column_block_can_move_down_one_row_past_kernel_grid(prefix):
    w = ReactiveWorkbook()
    cells = [CellDefinition(f'{prefix}{column}{row}', 'input', str(row))
             for column in 'AB' for row in range(21, 27)]
    await w.load_document_async(SheetDocument(sheet_name='Messung', rows=26,
        sheets=(SheetTab('Other', rows=26),), cells=tuple(cells)))
    await move_workbook(w, w.revision, f'{prefix}A21', f'{prefix}A22', [cell.id for cell in cells])
    assert {cell.id for cell in w.document.cells} == {f'{prefix}{column}{row}' for column in 'AB' for row in range(22, 28)}
    assert w.value(f'{prefix}A22') == 21
    assert w.value(f'{prefix}B27') == 26
    assert w.document.rows == (26 if prefix else 27)
    assert w.document.sheets[0].rows == (27 if prefix else 26)
    w.close()


@pytest.mark.asyncio
async def test_move_expands_grid_for_full_tile_span_without_reinitializing_input():
    w = ReactiveWorkbook()
    await w.load_document_async(SheetDocument(columns=2, rows=2,
        cells=(CellDefinition('A1', 'input', '[1, 2]', view={'span': [2, 2]}),)))
    value = w.value('A1')
    await move_workbook(w, w.revision, 'A1', 'B2')
    assert (w.document.columns, w.document.rows) == (3, 3)
    assert w.value('B2') is value
    w.close()
