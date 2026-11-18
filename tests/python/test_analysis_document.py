from reaktiv_workbook.model import CellDefinition, SheetDocument
from reaktiv_workbook.analysis_document import analysis_document
from reaktiv_workbook.editor import virtual_source
from reaktiv_workbook.source_analysis import remember_literal


def test_large_literal_data_is_only_compacted_for_analysis():
    source = '[' + ','.join(['255'] * 100000) + ']'
    remember_literal(source, [255])
    doc = SheetDocument(cells=(CellDefinition('A1','input',source,name='buffer'),
        CellDefinition('B1','formula','buffer[0]+1')))
    compact = analysis_document(doc)
    assert len(compact.cells[0].source) < 100
    assert 'list[' in compact.cells[0].source
    assert doc.cells[0].source is source
    assert compact.cells[1] is doc.cells[1]
    text,_ = virtual_source(doc,'','buffer[0]')
    assert len(text) < 10000
    assert 'from typing import Any' in text


def test_analysis_preserves_small_and_nonliteral_initializers_without_execution():
    source = 'raise RuntimeError("must not execute")\n' + '# padding\n' * 600
    doc = SheetDocument(cells=(CellDefinition('A1','input','[1, 2]'),CellDefinition('B1','input',source)))
    assert analysis_document(doc) is doc


def test_cold_literal_analysis_is_cached_and_preserves_container_shape(monkeypatch):
    import reaktiv_workbook.analysis_document as module
    source = '{"large": [' + ','.join(['1234']*1000) + ']}'
    doc = SheetDocument(cells=(CellDefinition('A1','input',source),))
    compact = analysis_document(doc)
    assert compact.cells[0].source.startswith('dict[')
    monkeypatch.setattr(module.ast,'literal_eval',lambda _: (_ for _ in ()).throw(AssertionError('reparsed')))
    assert analysis_document(doc).cells[0].source == compact.cells[0].source
