"""Widget writes while an action is awaiting; no apply/recompile or cross-thread graph reads."""
import asyncio
from threading import get_ident

import pytest

from reaktiv_workbook import ActionDefinition, CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.action_inputs import ActionInputs


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():
            await asyncio.sleep(.01)


@pytest.mark.asyncio
async def test_widget_checkbox_changes_live_plot_and_calculation_before_action_finishes():
    import plotly.graph_objects as go
    owner = get_ident()
    threads, frames = [], []
    started, finish = asyncio.Event(), asyncio.Event()
    w = ReactiveWorkbook({'started': started, 'finish': finish, 'threads': threads, 'thread_id': get_ident, 'go': go})
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '# display option\nFalse', name='log_scale'),
        CellDefinition('B1', 'formula', 'threads.append(thread_id())\n100 if log_scale else 1'),
        CellDefinition('C1', 'formula', "go.Figure(go.Scatter(y=[1, 10, 100])).update_layout(yaxis_type='log' if log_scale else 'linear')"),
    ), actions=(ActionDefinition('measure', 'async def measure(self):\n    started.set()\n    await finish.wait()'),))
    try:
        await w.load_document_async(doc)
        w.snapshot_reporter = frames.append
        pending = asyncio.create_task(w.run_action_async('measure', run_id='measurement'))
        await started.wait()
        admitted = await asyncio.to_thread(w.action_inputs.submit, 'measurement', {'A1': '# display option\nTrue'})
        assert admitted is True
        await until(lambda: any(next(cell for cell in frame['cells'] if cell['id'] == 'B1')['value'] == 100 for frame in frames))
        assert not pending.done()
        assert w.value('C1').layout.yaxis.type == 'log'
        assert set(threads) == {owner}
        assert w.document.cells[0].source == '# display option\nTrue'
        finish.set()
        snapshot = await pending
        assert next(cell for cell in snapshot.cell_changes if cell.id == 'A1').source == '# display option\nTrue'
        assert not w.action_inputs.submit('measurement', {'A1': 'False'})
    finally:
        finish.set()
        w.close()


@pytest.mark.asyncio
async def test_rapid_batches_are_coalesced_atomic_and_preserve_linked_and_session_only_inputs():
    started, finish = asyncio.Event(), asyncio.Event()
    seen = []
    w = ReactiveWorkbook({'started': started, 'finish': finish, 'seen': seen})
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '0', save_value=False),
        CellDefinition('A2', 'input', '100'),
        CellDefinition('B1', 'linked', 'A1 * 2'),
        CellDefinition('C1', 'effect', 'seen.append(A1 + A2)'),
    ), actions=(ActionDefinition('measure', 'async def measure(self):\n    started.set()\n    await finish.wait()'),))
    try:
        await w.load_document_async(doc)
        pending = asyncio.create_task(w.run_action_async('measure', run_id='stress'))
        await started.wait()
        for cycle in range(5):
            for index in range(1000):
                value = (index + cycle) % 101
                assert w.action_inputs.submit('stress', {'A1': str(value), 'A2': str(100-value), 'B1': '42'})
            await until(lambda: w.value('A1') == value)
            assert not pending.done()
            assert w.value('B1') == 42
        assert seen and set(seen) == {100}
        finish.set()
        await pending
        # Explicit widget edits update the saved initializer, despite save_value=False.
        loaded = SheetDocument.loads(w.document.dumps())
        assert next(cell for cell in loaded.cells if cell.id == 'A1').source == str(value)
    finally:
        finish.set()
        w.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('cancel', [False, True])
async def test_final_drain_includes_accepted_writes_on_completion_or_cancellation(cancel):
    started, finish = asyncio.Event(), asyncio.Event()
    w = ReactiveWorkbook({'started': started, 'finish': finish})
    doc = SheetDocument(cells=(CellDefinition('A1', 'input', '0'), CellDefinition('B1', 'resource', 'await asyncio.sleep(.01)\nA1 * 2')), actions=(
        ActionDefinition('measure', 'async def measure(self):\n    started.set()\n    await finish.wait()'),))
    try:
        await w.load_document_async(doc)
        pending = asyncio.create_task(w.run_action_async('measure', run_id='closing'))
        await started.wait()
        assert w.action_inputs.submit('closing', {'A1': '7'})
        if cancel:
            w.cancel_action('measure')
        else:
            finish.set()
        result = await pending
        assert result.cells[0]['value'] == 7
        assert result.cell_changes[0].source == '7'
        assert next(cell for cell in result.cells if cell['id']=='B1')['value'] == 14
        assert not w.action_inputs.submit('closing', {'A1': '8'})
    finally:
        finish.set()
        w.close()


def test_mailbox_refuses_code_readonly_targets_and_old_runs_without_partial_updates():
    inbox = ActionInputs()
    inbox.begin('one', {'A1':'input', 'B1':'formula'})
    with pytest.raises((ValueError, SyntaxError)):
        inbox.submit('one', {'A1': 'print("must not execute")'})
    with pytest.raises(ValueError, match='writable'):
        inbox.submit('one', {'A1':'7', 'B1':'8'})
    assert inbox.take() == {}
    assert inbox.submit('one', {'A1':'1'})
    assert inbox.take(finish=True)['A1'][1] == 1
    inbox.begin('two', {'A1':'input'})
    assert not inbox.submit('one', {'A1':'9'})
    assert inbox.take() == {}
