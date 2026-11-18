"""Runtime input data can be excluded from Python source without losing live reactivity."""
from dataclasses import replace

import pytest

from reaktiv_workbook import ActionDefinition, CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.model import verify_written_document


@pytest.mark.asyncio
async def test_large_action_write_skips_literal_conversion_and_reopens_with_initializer(monkeypatch):
    import reaktiv_workbook.workbook as engine
    data = list(range(100_000))
    original = engine.literal_source
    def encode(value):
        assert value is not data, 'session-only data must never be serialized as source'
        return original(value)
    monkeypatch.setattr(engine, 'literal_source', encode)
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '# Acquired samples\n[]', name='samples', save_value=False),
        CellDefinition('B1', 'formula', 'sum(samples)', name='total'),
        CellDefinition('C1', 'input', '0', name='saved'),
    ), actions=(ActionDefinition('acquire', 'def acquire(self):\n    self.samples.set(DATA)\n    self.saved.set(42)\n    return self.total()', references={'samples': 'A1', 'saved': 'C1', 'total': 'B1'}),))
    w = ReactiveWorkbook({'DATA': data})
    try:
        await w.load_document_async(doc)
        result = await w.run_action_async('acquire')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == sum(data)
        assert w._last_values['A1'] is data
        assert next(c for c in result.cells if c['id'] == 'A1')['runtimeOnlyInput']
        assert w.document.cells[0].source == '# Acquired samples\n[]'
        assert next(c for c in w.document.cells if c.id == 'C1').source == '42'
        source = w.document.dumps()
        assert len(source) < 4000
        assert verify_written_document(source, w.document.to_dict()) == []
        loaded = SheetDocument.loads(source)
        assert loaded.cells[0].save_value is False
        reopened = ReactiveWorkbook()
        try:
            snap = await reopened.load_document_async(loaded)
            assert next(c for c in snap.cells if c['id'] == 'A1')['value'] == []
        finally:
            reopened.close()
        # Metadata-only toggles and unrelated applies must not reinitialize the input.
        for save in (True, False):
            cells = [replace(c, save_value=save) if c.id == 'A1' else c for c in w.document.cells]
            await w.apply_async(cells)
            assert w._last_values['A1'] is data
    finally:
        w.close()


@pytest.mark.asyncio
async def test_effect_writes_keep_initializer_and_default_inputs_still_persist():
    w = ReactiveWorkbook()
    try:
        doc = SheetDocument(cells=(
            CellDefinition('A1', 'input', '[]', name='samples', save_value=False),
            CellDefinition('A2', 'input', '0', name='saved'),
            CellDefinition('B1', 'effect', 'cells.samples.set([1, 2, 3])\ncells.saved.set(9)'),
            CellDefinition('C1', 'formula', 'sum(samples)'),
        ))
        result = await w.load_document_async(doc)
        assert next(c for c in result.cells if c['id'] == 'C1')['value'] == 6
        assert next(c for c in w.document.cells if c.id == 'A1').source == '[]'
        assert next(c for c in w.document.cells if c.id == 'A2').source == '9'
    finally:
        w.close()


@pytest.mark.parametrize('initializer', ['# samples\n[]', 'list(range(3))'])
def test_input_persistence_round_trip_and_native_execution(initializer):
    doc = SheetDocument(cells=(CellDefinition('A1', 'input', initializer, name='samples', save_value=False),))
    source = doc.dumps()
    assert 'save_value=False' in source
    assert SheetDocument.loads(source) == doc
    assert verify_written_document(source, doc.to_dict()) == []
    namespace = {}
    exec(source, namespace)
    model = next(v for v in namespace.values() if isinstance(v, type) and bool(getattr(v, '__reaktiv_workbook__', None)))()
    try:
        assert model.Sheet1.samples() == ([] if initializer.startswith('#') else [0, 1, 2])
    finally:
        model.dispose()
    default = CellDefinition('A1', 'input', '[]')
    assert 'saveValue' not in default.to_dict()
    assert 'save_value=' not in SheetDocument(cells=(default,)).dumps()


@pytest.mark.parametrize('value', [None, 0, 'false'])
def test_invalid_persistence_types_are_rejected(value):
    with pytest.raises(TypeError, match='boolean'):
        CellDefinition.from_dict({'id': 'A1', 'kind': 'input', 'source': '[]', 'saveValue': value})


def test_non_input_persistence_is_rejected():
    with pytest.raises(ValueError, match='only to input'):
        CellDefinition('A1', 'formula', '1', save_value=False)
