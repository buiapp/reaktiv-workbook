"""Old-to-new migration preserves authoring, native execution, and runtime semantics."""
from dataclasses import replace
from pathlib import Path
import pytest

from reaktiv_workbook import ActionDefinition, CellDefinition as C, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.model import SheetTab, verify_written_document
from reaktiv_workbook.workbook_format import canonical_actions

FIXTURES = Path(__file__).parents[1] / 'fixtures/workbooks'


# Format-1 files as written before (legacy-pre-rename: `reactive_sheet` imports) and after
# the rename to Reaktiv Workbook (legacy: `reaktiv_workbook` imports).
@pytest.mark.parametrize('path', sorted([*(FIXTURES / 'legacy').glob('*.sheet.py'), *(FIXTURES / 'legacy-pre-rename').glob('*.sheet.py')]),
                         ids=lambda path: f'{path.parent.name}/{path.name}')
def test_legacy_fixtures_upgrade_idempotently_and_keep_every_definition(path):
    old = SheetDocument.load(path)
    written = old.dumps()
    assert '@workbook_config(' in written and '"formatVersion": 2' in written
    upgraded = SheetDocument.loads(written)
    assert upgraded == old
    assert upgraded.dumps() == written
    assert verify_written_document(written, old.to_dict()) == []


def document():
    return SheetDocument(name='Multi', sheet_name='Inputs', sheets=(SheetTab('Analysis'),),
        cells=(C('A1','input','3',name='value'), C('B1','formula','value * 2',name='double'),
               C('Analysis!A1','input','5',name='value'),C('Analysis!B1','formula','Inputs.double + value',name='total')),
        actions=(ActionDefinition('change', 'def change(self):\n    # self.inputs stays text: 😀\n    self.Inputs.value.set(7)\n    self.Analysis.value.set(9)\n    return self.Analysis.total()'),))


@pytest.mark.asyncio
async def test_duplicate_labels_have_local_members_and_workbook_owned_actions_in_both_runtimes():
    doc = document()
    text = doc.dumps()
    assert text.count('value = cell("A1"') == 2
    assert 'self.workbook.Inputs.double()' in text
    assert 'def change(self)' in text.split('class MultiWorkbook(Workbook):')[1]
    loaded = SheetDocument.loads(text)
    assert loaded.actions[0].references == {'Inputs.value':'A1','Analysis.value':'Analysis!A1','Analysis.total':'Analysis!B1'}
    namespace = {'__name__':'format_v2_test'}
    exec(text, namespace)
    native = namespace['MultiWorkbook']()
    app = ReactiveWorkbook()
    try:
        assert native.Inputs.value() == 3 and native.Analysis.value() == 5
        assert native.change() == 23
        assert native.Analysis.total() == 23
        await app.load_document_async(loaded)
        result = await app.run_action_async('change')
        assert result.actions[0]['output']['value'] == 23
        assert result.actions[0]['error'] is None
        assert '# self.inputs stays text: 😀' in loaded.actions[0].source
    finally:
        native.dispose(); app.close()


def test_every_sheet_owns_its_layout_and_first_sheet_is_not_special_in_source():
    doc = replace(document(), columns=15, rows=20, column_widths={'A':160}, note_order=('Analysis!B1',))
    source = doc.dumps()
    assert 'Inputs = worksheet(' in source and 'Analysis = worksheet(' in source
    assert 'sheetName' not in source and 'Analysis!A1' not in source
    loaded = SheetDocument.loads(source)
    assert loaded == canonical_actions(doc)
    assert loaded.columns == 15 and loaded.rows == 20 and loaded.column_widths == {'A':160}
    assert loaded.note_order == ('Analysis!B1',)


def test_dependencies_have_one_authoritative_pep723_declaration_and_shared_code_is_passive():
    doc = replace(document(), packages=('pandas',), imports=('from pathlib import Path',), code='# shared helper\nFACTOR = 2\ndef helper(x):\n    return x * FACTOR')
    source = doc.dumps()
    assert source.count('"pandas"') == 1
    assert 'from pathlib import Path' in source and '# shared helper' in source
    assert SheetDocument.loads(source) == canonical_actions(doc)
    # Parsing an initializer or module region never executes it.
    dangerous = source.replace('FACTOR = 2', 'FACTOR = open("/file/that/must/not/be/opened")')
    assert 'open(' in SheetDocument.loads(dangerous).code


@pytest.mark.asyncio
async def test_canonical_action_references_follow_cross_sheet_moves():
    from reaktiv_workbook.moves import move_workbook
    book = ReactiveWorkbook()
    try:
        authored = document()
        method = authored.actions[0]
        authored = replace(authored, actions=(replace(method, source=method.source.replace('return self.Analysis.total()', 'return self.Analysis.total() + self.Inputs.double()')),))
        doc = SheetDocument.loads(authored.dumps())
        await book.load_document_async(doc)
        with pytest.raises(ValueError, match='Duplicate cell label'):
            await move_workbook(book, book.revision, 'A1', 'Analysis!C2')
        await move_workbook(book, book.revision, 'B1', 'Analysis!C2')
        reopened = SheetDocument.loads(book.document.dumps())
        assert 'self.Analysis.double()' in reopened.actions[0].source
        assert 'self.Inputs.double()' not in reopened.actions[0].source
        await book.load_document_async(reopened)
        result = await book.run_action_async('change')
        assert result.actions[0]['output']['value'] == 37
    finally:
        book.close()


def test_actions_and_cells_have_separate_namespaces_and_reserved_cell_labels_survive():
    doc = SheetDocument(cells=(C('A1','input','1',name='reset'),C('A2','input','2',name='workbook')),
        actions=(ActionDefinition('reset','def reset(self):\n    self.Sheet1.reset.set(5)'),))
    source = doc.dumps(); loaded = SheetDocument.loads(source)
    assert loaded.cells == doc.cells
    namespace = {}; exec(source,namespace)
    native = namespace['UntitledWorkbook']()
    try:
        native.reset()
        assert native.Sheet1.reset() == 5
        assert native.Sheet1.cell_a2() == 2
    finally: native.dispose()


@pytest.mark.asyncio
async def test_legacy_handle_get_and_resource_reads_migrate_without_changing_meaning():
    doc = SheetDocument(cells=(C('A1','input','3',name='value'),C('B1','resource','await asyncio.sleep(0.001)\nreturn value * 2',name='loaded')),
        actions=(ActionDefinition('read','def read(self):\n    return self.cells.Sheet1.loaded() + self.cells.Sheet1.value.get()'),))
    loaded = SheetDocument.loads(doc.dumps())
    assert 'self.Sheet1.loaded.value()' in loaded.actions[0].source
    assert 'self.Sheet1.value()' in loaded.actions[0].source
    engine = ReactiveWorkbook()
    try:
        await engine.load_document_async(loaded)
        assert (await engine.run_action_async('read')).actions[0]['output']['value'] == 9
    finally: engine.close()


@pytest.mark.parametrize('before,after,reason', [
    ('class MultiWorkbook(Workbook):','class MultiWorkbook(object):','inherit directly from Workbook'),
    ('class InputsWorksheet(Worksheet["MultiWorkbook"]):','class InputsWorksheet(object):','inherit directly from Worksheet'),
    ('    Inputs = worksheet(', '    dispose = worksheet(', 'Reserved worksheet symbol'),
    ('    def change(self):', '    def Inputs(self):', 'distinct names'),
    ('    Inputs = worksheet(', '    arbitrary = 123\n    Inputs = worksheet(', 'Workbook members'),
    ('if __name__ == "__main__":', 'EXTRA = 123\nif __name__ == "__main__":', 'Put imports and shared code'),
])
def test_unsupported_managed_declarations_fail_instead_of_silently_disappearing(before,after,reason):
    with pytest.raises(ValueError,match=reason):
        SheetDocument.loads(document().dumps().replace(before,after))


@pytest.mark.asyncio
async def test_actions_keep_reference_targets_after_sheet_rename_before_save():
    book = ReactiveWorkbook()
    try:
        original = SheetDocument.loads(document().dumps())
        renamed = replace(original, sheet_name='Parameters', cells=tuple(replace(cell, source=cell.source.replace('Inputs.', 'Parameters.')) for cell in original.cells))
        await book.load_document_async(renamed)
        result = await book.run_action_async('change')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == 23
        assert 'self.Parameters.value.set(7)' in book.document.dumps()
    finally:
        book.close()


def test_legacy_linked_reset_keeps_native_cell_handle_semantics():
    doc = SheetDocument(cells=(C('A1','input','3',name='value'),C('B1','linked','value * 2',name='derived',override='99')),
        actions=(ActionDefinition('restore','def restore(self):\n    self.cells.Sheet1.derived.reset()\n    return self.cells.Sheet1.derived()'),))
    loaded = SheetDocument.loads(doc.dumps())
    namespace = {}; exec(loaded.dumps(), namespace)
    native = namespace['UntitledWorkbook']()
    try:
        assert native.Sheet1.derived() == 99
        assert native.restore() == 6
    finally:
        native.dispose()


def test_migration_preserves_nested_self_receivers_and_only_rewrites_workbook_owner():
    source = '''def inspect(self):
    def other(self):
        return self.cells.A1.get()
    return self.cells.A1.get()
'''
    doc = SheetDocument(cells=(C('A1','input','3'),), actions=(ActionDefinition('inspect',source),))
    migrated = SheetDocument.loads(doc.dumps())
    assert '        return self.cells.A1.get()' in migrated.actions[0].source
    assert '    return self.Sheet1.a1()' in migrated.actions[0].source
    assert migrated.actions[0].references == {'Sheet1.a1': 'A1'}
