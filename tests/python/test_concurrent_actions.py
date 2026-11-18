"""Async actions are independent functions sharing one owner-loop graph."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from reaktiv_workbook import ActionDefinition, CellDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.runtime import RuntimeServer


def doc():
    document = SheetDocument(cells=(
        CellDefinition('A1', 'input', '0', name='count'),
        CellDefinition('A2', 'input', 'False', name='log_scale'),
        CellDefinition('B1', 'formula', 'count * 2'),
        CellDefinition('B2', 'formula', "'log' if log_scale else 'linear'"),
    ), actions=(ActionDefinition('measure', '''async def measure(self, amount=1):
    self.count.update(lambda previous: previous + amount)
    print('started', amount)
    await asyncio.sleep(10)
    return amount''', references={'count':'A1'}),
    ActionDefinition('add', 'def add(self):\n    self.count.update(lambda value: value + 5)\n    return self.count()', references={'count':'A1'})))
    first = document.actions[0]
    return replace(document, actions=(*document.actions, replace(first, name='measure_other', source=first.source.replace('def measure(', 'def measure_other('))))


async def until(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(.01)


@pytest.mark.asyncio
async def test_different_actions_overlap_duplicate_is_refused_and_inputs_cancel_remain_independent():
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc())
        first = asyncio.create_task(w.run_action_async('measure', run_id='first'))
        second = asyncio.create_task(w.run_action_async('measure_other', {'amount':{'value':10}}, run_id='second'))
        await until(lambda: w.value('A1') == 11)
        assert w.action_running('measure')
        with pytest.raises(RuntimeError, match='already running'):
            await w.run_action_async('measure', run_id='duplicate')
        with pytest.raises(RuntimeError, match='already running'):
            await w.action_method('measure')()
        assert w.value('A1') == 11
        for index in range(100):
            snapshot = await w.set_inputs_async({'A2':str(index % 2 == 0)})
            assert next(cell['value'] for cell in snapshot.cells if cell['id']=='B2') == ('log' if index % 2 == 0 else 'linear')
        added = await w.run_action_async('add', run_id='third')
        assert w.value('B1') == 32
        assert next(action for action in added.actions if action['name']=='add')['runs'][0]['output']['value'] == 16
        assert not first.done() and not second.done()
        assert w.cancel_action('measure', 'first')
        cancelled = await first
        runs = {run['id']:run for action in cancelled.actions for run in action['runs']}
        assert runs['first']['status'] == 'cancelled'
        assert runs['second']['status'] == 'running'
        assert not w.action_running('measure') and w.action_running('measure_other') and not second.done()
        assert not w.cancel_action('add', 'second')
        assert w.cancel_action('measure_other', 'second')
        await second
        assert not w.action_running('measure')
        assert w.value('A1') == 16
        logs = [log for log in w.snapshot().logs if log['cellId'] in ('action:measure', 'action:measure_other')]
        assert {log['invocationId'] for log in logs} == {'first', 'second'}
    finally:
        w.close()


@pytest.mark.asyncio
async def test_concurrent_actions_batch_reads_match_native_graph():
    from reaktiv import Signal, computed, batch
    native = Signal(0)
    doubled = computed(lambda: native() * 2)
    seen = []
    w = ReactiveWorkbook({'seen':seen})
    source = '''async def acquire(self, offset):
    from reaktiv import batch
    for index in range(200):
        with batch():
            self.count.set(offset + index)
            assert self.double() == (offset + index) * 2
        seen.append(self.double())
        await asyncio.sleep(.001)
'''
    try:
        action = ActionDefinition('acquire', source, references={'count':'A1','double':'B1'})
        await w.load_document_async(replace(doc(), actions=(action, replace(action, name='acquire_other', source=source.replace('def acquire(', 'def acquire_other(')))))
        await asyncio.gather(w.run_action_async('acquire', {'offset':{'value':0}}), w.run_action_async('acquire_other', {'offset':{'value':1000}}))
        expected = []
        for index in range(200):
            for offset in (0,1000):
                with batch():
                    native.set(offset+index)
                    expected.append(doubled())
        assert seen == expected
        assert w.value('B1') == doubled()
    finally:
        w.close()


def test_http_owner_allows_concurrent_runs_and_defers_structural_edits():
    runtime = RuntimeServer()
    try:
        runtime.dispatch('/v1/apply', {'cells':[cell.to_dict() for cell in doc().cells], 'actions':[a.to_dict() for a in doc().actions]})
        with ThreadPoolExecutor(max_workers=4) as pool:
            first = pool.submit(runtime.dispatch, '/v1/run-action', {'name':'measure', 'runId':'one'})
            second = pool.submit(runtime.dispatch, '/v1/run-action', {'name':'measure_other', 'runId':'two'})
            async def ready():
                await until(lambda: runtime.workbook.action_invocation_running('measure_other','two'))
            asyncio.run(ready())
            queued = pool.submit(runtime.dispatch, '/v1/clear-logs', {})
            snapshot = runtime.dispatch('/v1/set-inputs', {'sources':{'A2':'True'}})
            assert next(cell['value'] for cell in snapshot['cells'] if cell['id']=='B2') == 'log'
            assert not queued.done()
            runtime.dispatch('/v1/cancel-action', {'name':'measure','runId':'one'})
            first.result(5)
            assert not second.done() and not queued.done()
            runtime.dispatch('/v1/cancel-action', {'name':'measure_other','runId':'two'})
            second.result(5)
            queued.result(5)
    finally:
        runtime.close()

@pytest.mark.asyncio
async def test_http_routes_accept_overlapping_actions_and_targeted_cancel():
    import httpx
    from reaktiv_workbook.api.app import create_app
    from reaktiv_workbook.api import KernelSettings
    runtime = RuntimeServer()
    app = create_app(runtime, KernelSettings(), owns_runtime=False)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            response = await client.post('/v1/apply', json={'cells':[cell.to_dict() for cell in doc().cells], 'actions':[action.to_dict() for action in doc().actions]})
            assert response.status_code == 200
            one = asyncio.create_task(client.post('/v1/run-action', json={'name':'measure','runId':'http-one'}))
            two = asyncio.create_task(client.post('/v1/run-action', json={'name':'measure_other','runId':'http-two'}))
            await until(lambda: runtime.workbook.action_invocation_running('measure_other','http-two'))
            duplicate = await client.post('/v1/run-action', json={'name':'measure','runId':'http-duplicate'})
            assert duplicate.status_code == 400 and 'already running' in duplicate.text
            response = await client.post('/v1/set-inputs',json={'sources':{'A2':'True'}})
            assert response.status_code == 200
            assert next(cell['value'] for cell in response.json()['cells'] if cell['id']=='B2') == 'log'
            response = await client.post('/v1/cancel-action',json={'name':'measure','runId':'http-one'})
            assert response.json()['cancelled'] is True
            assert (await one).status_code == 200
            assert not two.done()
            assert (await client.post('/v1/cancel-action',json={'name':'measure_other','runId':'http-two'})).json()['cancelled'] is True
            assert (await two).status_code == 200
    finally:
        runtime.close()

@pytest.mark.asyncio
async def test_one_failure_does_not_finish_another_run_and_last_completion_owns_aggregate_result():
    w = ReactiveWorkbook()
    action = ActionDefinition('work', '''async def work(self, fail=False):
    if fail:
        raise ValueError('device failed')
    await asyncio.sleep(.05)
    return 42''')
    try:
        await w.load_document_async(replace(doc(), actions=(action, replace(action,name='failing_work',source=action.source.replace('def work(', 'def failing_work(')))))
        good = asyncio.create_task(w.run_action_async('work', run_id='success'))
        await until(lambda: w.action_running('work'))
        failed = await w.run_action_async('failing_work', {'fail':{'value':True}}, run_id='failure')
        assert w.action_running('work') and not good.done()
        receipt = next(run for item in failed.actions for run in item['runs'] if run['id']=='failure')
        assert receipt['status']=='failed' and 'device failed' in receipt['error']
        result = await good
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value']==42
        assert {run['id']:run['status'] for item in result.actions for run in item['runs']}=={'success':'succeeded','failure':'failed'}
        assert not w.action_running('work')
    finally:
        w.close()


def test_embedded_python_invocations_return_their_own_values_while_resources_settle(tmp_path):
    from reaktiv_workbook import SheetSession
    path = tmp_path / 'concurrent.sheet.py'
    cells = (CellDefinition('A1','input','0',name='count'),
             CellDefinition('B1','resource','await asyncio.sleep(.15)\ncount * 2'))
    source = 'async def measure(self, amount):\n    self.count.set(amount)\n    await asyncio.sleep(.02)\n    return amount'
    first = ActionDefinition('measure',source,references={'count':'A1'})
    replace(doc(),cells=cells,actions=(first,replace(first,name='measure_other',source=source.replace('def measure(', 'def measure_other(')))).save(path)
    with SheetSession.load(path) as session, ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(session.run_action, 'measure', amount=1)
        two = pool.submit(session.run_action, 'measure_other', amount=2)
        assert one.result(5) == 1
        assert two.result(5) == 2
