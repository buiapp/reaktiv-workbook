"""The kernel's HTTP interface (FastAPI)."""

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from reaktiv_workbook.api import KernelSettings, create_app
from reaktiv_workbook.api.dependencies import get_runtime
from reaktiv_workbook.model import CellDefinition
from reaktiv_workbook.runtime import RuntimeServer

TOKEN = "s3cret"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ORIGIN = "http://localhost:4200"


@pytest.fixture
def runtime():
    runtime = RuntimeServer()
    yield runtime
    runtime.close()


def client_for(app):
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://kernel")


def kernel(runtime, **settings):
    return create_app(runtime, KernelSettings(token=TOKEN, allow_origin=ORIGIN, **settings), owns_runtime=False)


@pytest.mark.asyncio
async def test_direct_action_update_and_trace_opt_in(runtime):
    async with client_for(kernel(runtime)) as client:
        response = await client.post('/v1/apply', headers=AUTH, json={'cells': [
            {'id':'A1','kind':'input','source':'1'},
        ]})
        initial = response.json()
        assert 'updateTrace' not in initial
        definition = {'name':'set_value', 'source':'def set_value(self):\n    self.A1.set(7)', 'references':{'A1':'A1'}}
        response = await client.post('/v1/update-action', headers=AUTH, json={
            'definition':definition, 'expectedRevision':initial['workbookRevision'],
        })
        assert response.status_code == 200, response.text
        assert response.json()['appliedAction']['name'] == 'set_value'
        assert response.json()['cells'][0]['value'] == 1
        refused = await client.post('/v1/update-action', headers=AUTH, json={
            'definition':definition, 'expectedRevision':initial['workbookRevision'],
        })
        assert refused.status_code == 400
        result = await client.post('/v1/run-action', headers=AUTH, json={'name':'set_value'})
        assert result.json()['cells'][0]['value'] == 7
        traced = await client.post('/v1/apply', headers=AUTH, json={
            'cells':[{'id':'A1','kind':'input','source':'9'}], 'enableUpdateTracing':True,
        })
        assert 'updateTrace' in traced.json()
        disabled = await client.post('/v1/apply', headers=AUTH, json={
            'cells':[{'id':'A1','kind':'input','source':'10'}], 'enableUpdateTracing':False,
        })
        assert 'updateTrace' not in disabled.json()


@pytest.mark.asyncio
async def test_action_validation_error_names_editor_line_and_allows_correction_without_restart(runtime):
    async with client_for(kernel(runtime)) as client:
        applied = await client.post('/v1/apply', headers=AUTH, json={'cells': []})
        revision = applied.json()['workbookRevision']
        refused = await client.post('/v1/update-action', headers=AUTH, json={
            'definition': {'name': 'capture', 'source': 'def capture(self):\n    await missing()'},
            'expectedRevision': revision,
        })
        assert refused.status_code == 400
        message = refused.json()['error']
        assert 'Action capture, line 2' in message
        assert 'await missing()' in message
        corrected = await client.post('/v1/update-action', headers=AUTH, json={
            'definition': {'name': 'capture', 'source': 'def capture(self):\n    return 42'},
            'expectedRevision': revision,
        })
        assert corrected.status_code == 200, corrected.text
        result = await client.post('/v1/run-action', headers=AUTH, json={'name': 'capture'})
        assert result.json()['actions'][0]['output']['value'] == 42


@pytest.mark.asyncio
async def test_requests_need_the_token_and_every_failure_is_a_readable_error(runtime):
    async with client_for(kernel(runtime)) as client:
        refused = await client.get("/health", headers={"Origin": ORIGIN})
        assert refused.status_code == 401
        assert refused.json() == {"error": "Missing or invalid kernel token"}
        # The browser can read errors: they carry the CORS headers too.
        assert refused.headers["access-control-allow-origin"] == ORIGIN
        health = await client.get("/health", headers=AUTH)
        assert health.status_code == 200 and health.json()["status"] == "ok"

        # Preflight needs no token.
        preflight = await client.options(
            "/v1/apply",
            headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"},
        )
        assert preflight.status_code == 200
        assert "authorization" in preflight.headers["access-control-allow-headers"].lower()

        invalid = await client.post("/v1/apply", headers=AUTH, json={"cells": "A1"})
        assert invalid.status_code == 400 and invalid.json()["error"].startswith("Invalid request: cells")
        misspelt = await client.post("/v1/tick-timer", headers=AUTH, json={"cellID": "A1"})
        assert misspelt.status_code == 400 and "cellID" in misspelt.json()["error"]
        refused_by_engine = await client.post("/v1/inspect-document", headers=AUTH, json={"source": "def ("})
        assert refused_by_engine.status_code == 400 and refused_by_engine.json()["error"].startswith("SyntaxError")
        unknown_chart = await client.post("/v1/resample", headers=AUTH, json={"token": "gone"})
        assert unknown_chart.status_code == 404 and unknown_chart.json()["error"].startswith("KeyError")
        # Embedded-session endpoints exist only in a SheetSession's editor.
        assert (await client.post("/v1/session", headers=AUTH, json={})).status_code == 404
        assert (await client.post("/v1/nothing", headers=AUTH, json={})).json() == {"error": "Not Found"}


@pytest.mark.asyncio
async def test_unexpected_errors_and_oversized_bodies(runtime):
    class Broken(RuntimeServer):
        def dispatch(self, path, payload):
            raise AttributeError("a bug")

    app = kernel(runtime, max_body_bytes=1000)
    broken = Broken()
    app.dependency_overrides[get_runtime] = lambda: broken
    try:
        async with client_for(app) as client:
            failed = await client.post("/v1/apply", headers={**AUTH, "Origin": ORIGIN}, json={"cells": []})
            assert failed.status_code == 500
            assert failed.json() == {"error": "AttributeError: a bug"}
            assert failed.headers["access-control-allow-origin"] == ORIGIN
            large = await client.post("/v1/inspect-document", headers=AUTH, json={"source": "x" * 2000})
            assert large.status_code == 413 and "limit" in large.json()["error"]

            async def chunks():
                for _ in range(5):
                    yield b" " * 400  # no Content-Length: counted while reading

            streamed = await client.post("/v1/inspect-document", headers={**AUTH, "Content-Type": "application/json"}, content=chunks())
            assert streamed.status_code == 413
    finally:
        broken.close()


@pytest.mark.asyncio
async def test_workbook_requests_and_their_results(runtime):
    async with client_for(kernel(runtime)) as client:
        cells = [CellDefinition("A1", "input", "20", name="price").to_dict(), CellDefinition("A2", "formula", "price * 2").to_dict()]
        graph = (await client.post("/v1/apply", headers=AUTH, json={"cells": cells, "stopped": []})).json()
        assert {cell["id"]: cell["value"] for cell in graph["cells"]}["A2"] == 40
        progress = (await client.post("/v1/progress", headers=AUTH, json={"after": 0})).json()
        assert progress["events"][0]["cellId"] in ("A1", "A2")
        moved = (await client.post("/v1/move-cells", headers=AUTH, json={"cells": cells, "sourceId": "A1", "targetId": "B1"})).json()
        assert sorted(cell["id"] for cell in moved) == ["A2", "B1"]


@pytest.mark.asyncio
async def test_control_requests_answer_while_a_cell_runs_forever(runtime):
    """Progress, usage and interrupt never wait for the workbook, even while every update request
    waits on it: they run on the event loop, not in the worker threads."""
    async with client_for(kernel(runtime)) as client:
        cells = [CellDefinition("A1", "formula", "while True:\n    pass", name="spin").to_dict(), CellDefinition("B1", "formula", "40 + 2").to_dict()]
        running = asyncio.create_task(client.post("/v1/apply", headers=AUTH, json={"cells": cells}))
        for _ in range(200):
            if runtime.progress.running():
                break
            await asyncio.sleep(0.01)
        queued = [asyncio.create_task(client.post("/v1/clear-logs", headers=AUTH, json={})) for _ in range(3)]
        usage = await asyncio.wait_for(client.post("/v1/usage", headers=AUTH, json={}), 5)
        assert usage.status_code == 200 and "memoryBytes" in usage.json()
        assert (await asyncio.wait_for(client.post("/v1/progress", headers=AUTH, json={}), 5)).status_code == 200
        interrupted = await asyncio.wait_for(client.post("/v1/interrupt", headers=AUTH, json={}), 5)
        assert interrupted.json() == {"interrupted": True}
        graph = (await asyncio.wait_for(running, 10)).json()
        assert graph["stopped"] == ["A1"]
        assert {cell["id"]: cell["value"] for cell in graph["cells"]}["B1"] == 42
        assert [(await task).status_code for task in queued] == [200, 200, 200]


@pytest.mark.asyncio
async def test_docs_only_when_asked(runtime):
    async with client_for(kernel(runtime)) as client:
        assert (await client.get("/openapi.json")).status_code == 404
    async with client_for(kernel(runtime, docs=True)) as client:
        schema = (await client.get("/openapi.json")).json()
    assert {"/v1/apply", "/v1/interrupt", "/v1/check", "/health"} <= set(schema["paths"])
    apply = schema["paths"]["/v1/apply"]["post"]
    assert apply["tags"] == ["workbook"] and "400" in apply["responses"]


def test_the_kernel_stops_when_the_app_goes_away_even_while_a_cell_never_ends():
    """stdin closes (the parent process quit or crashed) during a `while True` cell: Uvicorn's graceful
    shutdown would wait for that request forever, so the watchdog ends the process."""
    import json
    import subprocess
    import sys
    import threading
    import time
    import urllib.request

    process = subprocess.Popen(
        [sys.executable, "-m", "reaktiv_workbook.server", "--port", "0", "--token", TOKEN, "--exit-on-stdin-eof"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        port = json.loads(process.stdout.readline().removeprefix("REAKTIV_KERNEL_READY "))["port"]
        body = json.dumps({"cells": [{"id": "A1", "kind": "formula", "source": "while True:\n    pass"}]}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/v1/apply", data=body, headers={**AUTH, "Content-Type": "application/json"}
        )
        threading.Thread(target=lambda: _ignore_errors(urllib.request.urlopen, request, timeout=30), daemon=True).start()
        time.sleep(1)  # the cell is spinning now
        started = time.monotonic()
        process.stdin.close()
        assert process.wait(timeout=15) == 0
        assert time.monotonic() - started < 12
    finally:
        if process.poll() is None:
            process.kill()


def _ignore_errors(function, *args, **kwargs):
    try:
        function(*args, **kwargs)
    except Exception:  # noqa: BLE001 - the connection drops when the kernel exits
        pass


@pytest.mark.asyncio
async def test_actions_execute_and_cancel_outside_the_workbook_lock(runtime):
    from reaktiv_workbook import ActionDefinition
    methods=[ActionDefinition('add','def add(self, quantity: int = 2):\n    self.count.set(self.count() + quantity)\n    return self.count()',references={'count':'A1'}),
             ActionDefinition('wait','async def wait(self):\n    self.count.set(99)\n    await asyncio.sleep(100)',references={'count':'A1'})]
    async with client_for(kernel(runtime)) as client:
        response=await client.post('/v1/apply',headers=AUTH,json={'cells':[CellDefinition('A1','input','1',name='count').to_dict()],'actions':[method.to_dict() for method in methods]})
        assert response.status_code==200
        response=await client.post('/v1/run-action',headers=AUTH,json={'name':'add','arguments':{'quantity':{'value':4}}})
        assert response.status_code==200
        assert response.json()['cells'][0]['value']==5
        pending=asyncio.create_task(client.post('/v1/run-action',headers=AUTH,json={'name':'wait'}))
        for _ in range(200):
            if runtime.workbook.action_running('wait'):break
            await asyncio.sleep(.005)
        assert runtime.workbook.action_running('wait')
        cancelled=await asyncio.wait_for(client.post('/v1/cancel-action',headers=AUTH,json={'name':'wait'}),1)
        assert cancelled.json()=={'cancelled':True}
        finished=await asyncio.wait_for(pending,2)
        assert finished.json()['cells'][0]['value']==99  # Already-published action writes survive cancellation.
        assert finished.json()['actions'][1]['status']=='cancelled'
        assert any(cell['id'] == 'A1' and cell['source'] == '99' for cell in finished.json()['cellChanges'])


@pytest.mark.asyncio
async def test_live_move_is_revision_checked_sparse_and_updates_once(runtime):
    async with client_for(kernel(runtime)) as client:
        initial = await client.post('/v1/apply',headers=AUTH,json={'cells':[
            {'id':'A1','kind':'input','source':'3','name':'amount'},
            {'id':'B1','kind':'formula','source':'amount*2'}]})
        payload={'expectedRevision':initial.json()['workbookRevision'],'sourceId':'A1','targetId':'A2'}
        reply=await client.post('/v1/move-workbook',headers=AUTH,json=payload)
        assert reply.status_code == 200, reply.text
        data=reply.json()
        assert data['patches'] == [{'previousId':'A1','changes':{'id':'A2'}}]
        assert next(c['value'] for c in data['graph']['cells'] if c['id']=='B1') == 6
        assert 'queueMs' in data['timings']
        refused=await client.post('/v1/move-workbook',headers=AUTH,json=payload)
        assert refused.status_code == 409
        assert 'Move conflict:' in refused.json()['error']
        assert runtime.workbook.value('A2') == 3


@pytest.mark.asyncio
async def test_live_move_preflight_refusal_preserves_revision_for_corrected_move(runtime):
    async with client_for(kernel(runtime)) as client:
        initial = await client.post('/v1/apply', headers=AUTH, json={'cells': [
            {'id': 'A1', 'kind': 'input', 'source': '3'},
            {'id': 'B1', 'kind': 'input', 'source': '4', 'view': {'span': [2, 3]}}]})
        revision = initial.json()['workbookRevision']
        refused = await client.post('/v1/move-workbook', headers=AUTH, json={
            'expectedRevision': revision, 'sourceId': 'A1', 'targetId': 'B2'})
        assert refused.status_code == 400
        assert refused.json()['error'].startswith('MoveRejected:')
        assert runtime.workbook.revision == revision
        reply = await client.post('/v1/move-workbook', headers=AUTH, json={
            'expectedRevision': revision, 'sourceId': 'A1', 'targetId': 'A2'})
        assert reply.status_code == 200, reply.text
        assert runtime.workbook.value('A2') == 3


@pytest.mark.asyncio
async def test_live_move_grows_kernel_occupied_extent_for_selected_block(runtime):
    cells = [CellDefinition(f'{column}{row}', 'input', str(row)) for column in 'AB' for row in range(21, 27)]
    async with client_for(kernel(runtime)) as client:
        initial = await client.post('/v1/apply', headers=AUTH, json={'cells': [cell.to_dict() for cell in cells]})
        assert runtime.workbook.document.rows == 26
        reply = await client.post('/v1/move-workbook', headers=AUTH, json={
            'expectedRevision': initial.json()['workbookRevision'], 'sourceId': 'A21', 'targetId': 'A22',
            'sourceIds': [cell.id for cell in cells]})
        assert reply.status_code == 200, reply.text
        assert runtime.workbook.document.rows == 27
        assert runtime.workbook.value('B27') == 26


@pytest.mark.asyncio
async def test_apply_reports_separate_python_stages(runtime):
    async with client_for(kernel(runtime)) as client:
        reply = await client.post('/v1/apply',headers=AUTH,json={'cells':[{'id':'A1','kind':'input','source':'1'}]})
        stages = reply.json()['timings']
        assert set(stages) == {'definitionsMs','resourcesMs','snapshotMs','queueMs'}
        assert all(value >= 0 for value in stages.values())


@pytest.mark.asyncio
async def test_default_limit_opens_and_applies_a_workbook_larger_than_10mb(runtime):
    from reaktiv_workbook.model import SheetDocument
    # Large source, minimal AST and no device/library code: exercise the actual
    # inspect/apply endpoints rather than bypassing the middleware or runtime.
    cell = CellDefinition('A1', 'input', '1  # ' + 'x' * 23_000_000)
    source = SheetDocument(cells=(cell,)).dumps()
    assert len(source) > 23_000_000
    async with client_for(kernel(runtime)) as client:
        opened = await client.post('/v1/inspect-document', headers=AUTH, json={'source': source})
        assert opened.status_code == 200, opened.text[:300]
        cells = opened.json()['cells']
        applied = await client.post('/v1/apply', headers=AUTH, json={'cells': cells})
        assert applied.status_code == 200, applied.text[:300]
        assert applied.json()['cells'][0]['value'] == 1


@pytest.mark.asyncio
async def test_default_limit_remains_bounded_and_refusal_does_not_stop_kernel(runtime):
    from reaktiv_workbook.api.config import MAX_BODY_BYTES
    async with client_for(kernel(runtime)) as client:
        refused = await client.post('/v1/inspect-document',
            headers={**AUTH, 'Content-Length': str(MAX_BODY_BYTES + 1), 'Origin': ORIGIN},
            content=b'{}')
        assert refused.status_code == 413
        assert '64 MB limit' in refused.json()['error']
        assert refused.headers['access-control-allow-origin'] == ORIGIN
        health = await client.get('/health', headers=AUTH)
        assert health.status_code == 200
        small = await client.post("/v1/apply", headers=AUTH, json={"cells": []})
        assert small.status_code == 200


def test_overlapping_type_checks_are_bounded_without_blocking_evaluation(runtime):
    from reaktiv_workbook.model import SheetDocument
    runtime._check_lock.acquire()
    try:
        reply = runtime.dispatch('/v1/check', {'document': SheetDocument().to_dict(), 'mode': 'standard'})
        assert reply['available'] is False
        assert 'already running' in reply['reason']
        assert runtime.dispatch('/v1/apply', {'cells': []})['cells'] == []
    finally:
        runtime._check_lock.release()


@pytest.mark.asyncio
async def test_sync_action_logs_are_readable_while_action_holds_workbook_lock(runtime):
    async with client_for(kernel(runtime)) as client:
        await client.post('/v1/apply', headers=AUTH, json={
            'cells': [], 'actions': [{
                'name': 'live', 'label': 'Live', 'references': {}, 'bindings': {}, 'exposed': True,
                'source': "def live(self):\n    print('before wait', flush=True)\n    __import__('time').sleep(0.8)\n    print('after wait')",
            }],
        })
        cursor = (await client.post('/v1/progress', headers=AUTH, json={})).json()['seq']
        running = asyncio.create_task(client.post('/v1/run-action', headers=AUTH, json={'name': 'live', 'arguments': {}}))
        try:
            for _ in range(100):
                progress = (await client.post('/v1/progress', headers=AUTH, json={'after': cursor})).json()
                if progress['logs']:
                    break
                await asyncio.sleep(0.005)
            assert progress['logs'][0]['message'] == 'before wait'
            assert not running.done()
            cursor = progress['seq']
            repeated = (await client.post('/v1/progress', headers=AUTH, json={'after': cursor})).json()
            assert not repeated['logs']
            result = (await running).json()
            assert [entry['message'] for entry in result['logs']] == ['before wait', 'after wait']
            assert result['logs'][0]['id'] == progress['logs'][0]['id']
        finally:
            await running


def test_live_log_cursor_is_bounded_and_does_not_change_cell_activity():
    from reaktiv_workbook.runtime import ProgressLog
    progress = ProgressLog()
    progress.add('start', 'A1')
    for i in range(700):
        progress.add_log({'message': str(i)})
    assert progress.running()
    result = progress.since(0)
    assert len(result['logs']) == 500
    assert result['logs'][0]['message'] == '200'
    assert progress.since(None)['logs'] == []
    assert progress.since(result['seq'])['logs'] == []
    progress.add('end', 'A1')
    assert not progress.running()


@pytest.mark.asyncio
async def test_resource_cancel_control_bypasses_busy_workbook_and_retains_kernel(runtime):
    async with client_for(kernel(runtime)) as client:
        pending = asyncio.create_task(client.post('/v1/apply', headers=AUTH, json={'cells': [
            {'id': 'A1', 'kind': 'resource', 'source': 'await asyncio.sleep(100)\nreturn 99'},
            {'id': 'B1', 'kind': 'input', 'source': '42'},
        ]}))
        for _ in range(200):
            if runtime.workbook.resource_loading('A1'):
                break
            await asyncio.sleep(.005)
        assert runtime.workbook.resource_loading('A1')
        cancelled = await asyncio.wait_for(client.post('/v1/cancel-resource', headers=AUTH, json={'cellId': 'A1'}), 1)
        assert cancelled.status_code == 200 and cancelled.json() == {'cancelled': True}
        finished = await asyncio.wait_for(pending, 2)
        assert finished.status_code == 200
        results = {row['id']: row for row in finished.json()['cells']}
        assert results['A1']['resourceStatus'] == 'cancelled'
        assert results['A1']['display'] == 'Cancelled' and results['A1']['error'] is None
        assert results['B1']['value'] == 42
        idle = await client.post('/v1/cancel-resource', headers=AUTH, json={'cellId': 'A1'})
        assert idle.json() == {'cancelled': False}
        console = await client.post('/v1/console', headers=AUTH, json={'source': '6 * 7', 'sheet': ''})
        assert console.status_code == 200, console.text
        assert console.json()['display'] == '42'


@pytest.mark.asyncio
async def test_action_dashboard_snapshot_is_available_before_sync_action_finishes(runtime):
    async with client_for(kernel(runtime)) as client:
        await client.post('/v1/apply', headers=AUTH, json={
            'cells': [
                {'id': 'A1', 'kind': 'input', 'source': '1', 'name': 'count'},
                {'id': 'B1', 'kind': 'formula', 'source': 'count * 2'},
            ],
            'actions': [{
                'name': 'live', 'label': 'Live', 'references': {'count': 'A1'}, 'bindings': {}, 'exposed': True,
                'source': "def live(self):\n    self.count.set(7)\n    __import__('time').sleep(0.8)",
            }],
        })
        cursor = (await client.post('/v1/progress', headers=AUTH, json={})).json()['seq']
        running = asyncio.create_task(client.post('/v1/run-action', headers=AUTH, json={'name': 'live', 'arguments': {}}))
        try:
            for _ in range(100):
                progress = (await client.post('/v1/progress', headers=AUTH, json={'after': cursor})).json()
                if progress.get('snapshot'):
                    break
                await asyncio.sleep(0.005)
            assert not running.done()
            assert next(c for c in progress['snapshot']['cells'] if c['id'] == 'B1')['value'] == 14
            repeated = (await client.post('/v1/progress', headers=AUTH, json={'after': progress['seq']})).json()
            assert repeated['snapshot'] is None
            final = (await running).json()
            assert final['cellChanges'][0]['source'] == '7'
        finally:
            await running


@pytest.mark.asyncio
async def test_rich_output_cache_is_opt_in_per_request_and_keeps_legacy_full_content(runtime):
    async with client_for(kernel(runtime)) as client:
        initial = (await client.post('/v1/apply', headers=AUTH, json={'cells':[
            {'id':'A1','kind':'formula','source':'html("<p>large output</p>")'},
        ]})).json()
        rich = initial['cells'][0]['richOutput'];key=rich['cacheKey']
        assert rich['dataBase64']
        compact = (await client.post('/v1/clear-logs',headers=AUTH,json={'knownOutputs':[key]})).json()
        assert compact['cells'][0]['richOutput'] == {'cacheKey':key}
        legacy = (await client.post('/v1/clear-logs',headers=AUTH,json={})).json()
        assert legacy['cells'][0]['richOutput']==rich
        assert (await client.post('/v1/clear-logs',headers=AUTH,json={'knownOutputs':[]})).json()['cells'][0]['richOutput']==rich


@pytest.mark.asyncio
async def test_live_widget_inputs_answer_beside_running_action_and_update_progress_snapshot(runtime):
    async with client_for(kernel(runtime)) as client:
        response = await client.post('/v1/apply', headers=AUTH, json={'cells':[
            {'id':'A1','kind':'input','source':'False'},
            {'id':'B1','kind':'formula','source':'100 if A1 else 1'},
        ],'actions':[{'name':'measure','source':'async def measure(self):\n    import asyncio\n    await asyncio.sleep(10)'}]})
        assert response.status_code == 200
        pending = asyncio.create_task(client.post('/v1/run-action', headers=AUTH, json={'name':'measure','runId':'live-test'}))
        try:
            for _ in range(100):
                if runtime.workbook.action_running('measure'):
                    break
                await asyncio.sleep(.01)
            response = await asyncio.wait_for(client.post('/v1/action-inputs', headers=AUTH,
                json={'runId':'live-test','sources':{'A1':'True'}}), 1)
            assert response.status_code == 200, response.text
            assert response.json() == {'accepted': True}
            for _ in range(100):
                progress = (await client.post('/v1/progress', headers=AUTH, json={'after':0})).json()
                snapshot = progress.get('snapshot')
                if snapshot and next(cell for cell in snapshot['cells'] if cell['id']=='B1')['value'] == 100:
                    break
                await asyncio.sleep(.02)
            else:
                pytest.fail('Input did not affect the live display snapshot')
            assert not pending.done()
            refused = await client.post('/v1/action-inputs', headers=AUTH, json={'runId':'live-test','sources':{'B1':'5'}})
            assert refused.status_code == 400
            stale = await client.post('/v1/action-inputs', headers=AUTH, json={'runId':'retired','sources':{'A1':'False'}})
            assert stale.json() == {'accepted': False}
        finally:
            await client.post('/v1/cancel-action', headers=AUTH, json={'name':'measure'})
            result = await pending
        assert next(cell for cell in result.json()['cells'] if cell['id']=='B1')['value'] == 100
