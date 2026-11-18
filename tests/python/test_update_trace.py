from dataclasses import replace
import pytest

from reaktiv_workbook import CellDefinition, ReactiveWorkbook


def observations(snapshot):
    return snapshot.to_dict()['updateTrace']['cells']


def chain(value):
    return [
        CellDefinition('A1', 'input', str(value)),
        CellDefinition('B1', 'formula', 'A1 % 2'),
        CellDefinition('C1', 'formula', 'B1 * 10'),
        CellDefinition('D1', 'formula', '100'),
    ]


def test_tracing_is_disabled_by_default_and_does_not_collect_or_build_observations(monkeypatch):
    w = ReactiveWorkbook()
    try:
        def unexpected(*args, **kwargs):
            raise AssertionError('disabled tracing must not build observations')
        monkeypatch.setattr(w._update_trace, 'complete', unexpected)
        w.apply(chain(1))
        result = w.apply(chain(3)).to_dict()
        assert 'updateTrace' not in result
        assert w._update_trace.runs == w._update_trace.equalities == w._update_trace.outputs == {}
        assert not w._update_trace.roots
        assert w._update_trace.latest is None
        assert next(cell['value'] for cell in result['cells'] if cell['id'] == 'C1') == 10
    finally:
        w.close()


def test_trace_flag_can_be_disabled_without_retaining_observations():
    w = ReactiveWorkbook(enable_update_tracing=True)
    try:
        assert 'updateTrace' in w.apply(chain(1)).to_dict()
        w.set_update_tracing(False)
        assert 'updateTrace' not in w.apply(chain(2)).to_dict()
        assert not w._update_trace._versions
        w.set_update_tracing(True)
        assert 'updateTrace' in w.snapshot().to_dict()
    finally:
        w.close()


def test_equal_intermediate_stops_propagation_and_trace_survives_read_only_snapshots():
    w = ReactiveWorkbook(enable_update_tracing=True)
    try:
        first = w.apply(chain(1))
        assert observations(first)['B1']['executions'] == 1
        same = w.apply(chain(3))
        trace = observations(same)
        assert trace['A1']['status'] == 'changed'
        assert trace['B1']['status'] == 'equal'
        assert trace['B1']['executions'] == 1
        assert trace['B1']['equal'] is True
        assert trace['C1']['status'] == 'cached'
        assert trace['C1']['executions'] == 0
        assert trace['D1']['status'] == 'unaffected'
        assert trace['B1']['changedDependencies'] == ['A1']
        assert w.snapshot().to_dict()['updateTrace'] == same.to_dict()['updateTrace']
        different = observations(w.apply(chain(4)))
        assert different['B1']['status'] == 'changed'
        assert different['C1']['status'] == 'changed'
        assert different['C1']['executions'] == 1
    finally:
        w.close()


def test_custom_equality_observed_once_and_never_repeated_by_trace():
    checks = []
    w = ReactiveWorkbook({'checks': checks}, enable_update_tracing=True)
    try:
        defs = chain(1)
        defs[1] = replace(defs[1], source='A1 * 10', equal="lambda a, b: (checks.append(1) or True)")
        w.apply(defs)
        defs[0] = replace(defs[0], source='2')
        result = w.apply(defs)
        assert observations(result)['B1']['status'] == 'equal'
        assert observations(result)['B1']['equality'] == 'custom'
        assert len(checks) == 1
        trace = result.to_dict()['updateTrace']
        assert w.snapshot().to_dict()['updateTrace'] == trace
        assert len(checks) == 1
    finally:
        w.close()


def test_failed_cells_and_conditional_unobserved_inputs_are_not_invented_dependencies():
    w = ReactiveWorkbook(enable_update_tracing=True)
    try:
        defs = [CellDefinition('A1','input','1'), CellDefinition('B1','input','2'),
                CellDefinition('C1','formula','B1 if A1 == 0 else 42'), CellDefinition('D1','formula','1 / 0')]
        w.apply(defs)
        defs[1] = replace(defs[1],source='3')
        result = observations(w.apply(defs))
        assert result['C1']['status'] == 'unaffected'
        assert result['C1']['dependencies'] == ['A1']
        assert result['D1']['status'] == 'failed'
    finally:
        w.close()


def test_mutated_rich_output_identity_is_reported_separately_from_publication():
    class Figure:
        text = 'before'
        def _repr_html_(self):
            return '<p>' + self.text + '</p>'
    for equality, expected in [('', 'equal'), ('lambda a,b: False', 'changed')]:
        figure = Figure()
        w = ReactiveWorkbook({'figure':figure}, enable_update_tracing=True)
        try:
            defs = [CellDefinition('A1','input','1'), CellDefinition('B1','formula','A1\nfigure',equal=equality)]
            first = w.apply(defs)
            assert observations(first)['B1']['output'] == 'prepared'
            figure.text = 'after'
            defs[0] = replace(defs[0],source='2')
            updated = w.apply(defs)
            assert observations(updated)['B1']['status'] == expected
            assert observations(updated)['B1']['executions'] == 1
            assert observations(updated)['B1']['output'] == 'reused'
            assert updated.cells[1]['richOutput'] == first.cells[1]['richOutput']
        finally:
            w.close()


@pytest.mark.asyncio
async def test_equal_input_write_and_async_resource_loader_are_traced():
    w = ReactiveWorkbook(enable_update_tracing=True)
    try:
        await w.apply_async(chain(1))
        same = await w.set_input_values_async({'A1':1})
        rows = observations(same)
        assert rows['A1']['status'] == 'equal'
        assert rows['A1']['executions'] == 0
        assert rows['B1']['status'] == 'cached'
        assert rows['C1']['status'] == 'cached'
        defs = [CellDefinition('A1','input','1'), CellDefinition('B1','resource','return A1 * 2')]
        await w.apply_async(defs)
        defs[0] = replace(defs[0],source='2')
        rows = observations(await w.apply_async(defs))
        assert rows['B1']['status'] == 'changed'
        assert rows['B1']['executions'] == 1
    finally:
        w.close()


def test_output_prepared_through_a_note_is_not_misreported_as_reused():
    w = ReactiveWorkbook(enable_update_tracing=True)
    try:
        defs = [CellDefinition('A1','markdown','{{ B1 }}'),
                CellDefinition('B1','formula','html(str(C1))'), CellDefinition('C1','input','1')]
        first = w.apply(defs)
        assert observations(first)['B1']['output'] == 'prepared'
        defs[2] = replace(defs[2],source='2')
        result = w.apply(defs)
        assert observations(result)['B1']['executions'] == 1
        assert observations(result)['B1']['output'] == 'prepared'
    finally:
        w.close()
