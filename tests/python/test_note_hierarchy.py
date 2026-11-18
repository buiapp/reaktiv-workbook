import pytest
from reaktiv_workbook.model import CellDefinition, SheetDocument, SheetTab, FORMAT_NAME, FORMAT_VERSION, verify_written_document


def test_note_hierarchy_survives_both_file_and_json_boundaries():
    cells = tuple(CellDefinition(id, 'markdown', f'# {id}') for id in ['A1','A2','A3','Budget!A1'])
    document = SheetDocument(cells=cells, sheets=(SheetTab('Budget'),), note_order=('A1','A3','A2'), note_parents={'A2':'A1','A3':'A2','Budget!A1':'A1'})
    assert SheetDocument.loads(document.dumps()) == document
    assert SheetDocument.from_dict(document.to_dict()) == document
    assert verify_written_document(document.dumps(), document.to_dict()) == []
    changed = document.to_dict()
    changed['layout']['noteParents'] = {'A2':'A1'}
    assert "The workbook's note hierarchy would change" in verify_written_document(document.dumps(), changed)


def test_note_hierarchy_keeps_invalid_branches_reachable_and_validates_types():
    cells = tuple(CellDefinition(id,'markdown',f'# {id}') for id in ['A1','A2','A3'])
    assert SheetDocument(cells=cells,note_parents={'A1':'A2','A2':'A1','A3':'A2'}).note_parents == {}
    assert SheetDocument(cells=cells,note_parents={'A2':'missing','A3':'A2'}).note_parents == {'A3':'A2'}
    for parents in [None, [], {'A2':1}]:
        with pytest.raises(TypeError,match='Note parents'):
            SheetDocument.from_dict({'format':FORMAT_NAME, 'version':FORMAT_VERSION, 'cells':[cell.to_dict() for cell in cells], 'layout':{'noteParents':parents}})
