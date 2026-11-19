"""The live bridge routes only to shared app windows; it never loads a workbook."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import time

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from reaktiv_workbook.mcp_bridge import (
    CommandReply, LiveWorkbookBridge, WorkbookPresence, create_bridge_app,
)

TOKEN = 'pairing-token-for-test-at-least-32-characters'
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def presence(workbook='one'):
    return WorkbookPresence(id=workbook, name='Workbook ' + workbook, kernelRunning=True)


def wait_command(bridge, workbook='one'):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        messages = bridge.poll(presence(workbook))['commands']
        if messages:
            return messages[0]
        time.sleep(.01)
    raise AssertionError('No bridge command delivered')


def test_multiple_windows_deliver_once_revoke_and_shutdown():
    bridge = LiveWorkbookBridge(timeout_seconds=3)
    bridge.poll(presence('one'))
    bridge.poll(presence('two'))
    assert {w['workbook'] for w in bridge.list_workbooks()['open']} == {'one', 'two'}
    with ThreadPoolExecutor() as pool:
        result = pool.submit(bridge.request, 'one', 'edit', {'revision': 'r1'})
        command = wait_command(bridge)
        assert command['operation'] == 'edit'
        assert not bridge.poll(presence())['commands']  # no replay on another poll
        assert not bridge.poll(presence('two'))['commands']
        with pytest.raises(ValueError, match='match'):
            bridge.reply(CommandReply(workbook='two', id=command['id'], result={}))
        bridge.reply(CommandReply(workbook='one', id=command['id'], result={'revision': 'r2'}))
        assert result.result() == {'workbook': 'one', 'revision': 'r2'}
        result = pool.submit(bridge.request, 'one', 'read', {})
        wait_command(bridge)
        bridge.remove('one', 'User revoked access', revoke=True)
        with pytest.raises(RuntimeError, match='revoked'):
            result.result()
        with pytest.raises(ValueError, match='revoked'):
            bridge.poll(presence('one'))
        assert len(bridge.list_workbooks()['open']) == 1
        result = pool.submit(bridge.request, 'two', 'read', {})
        wait_command(bridge, 'two')
        bridge.close()
        with pytest.raises(RuntimeError, match='closed'):
            result.result()
    assert not bridge.list_workbooks()['open']


def test_timeout_and_expired_windows_do_not_replay():
    bridge = LiveWorkbookBridge(timeout_seconds=.02, lease_seconds=.01)
    bridge.poll(presence())
    with pytest.raises(TimeoutError, match='unknown'):
        bridge.request('one', 'edit', {})
    assert not bridge.poll(presence())['commands']
    time.sleep(.02)
    assert bridge.list_workbooks() == {'open': []}
    with pytest.raises(ValueError, match='disconnected'):
        bridge.request('one', 'read', {})
    bridge.close()


@pytest.mark.asyncio
async def test_client_cancellation_removes_undelivered_edits():
    bridge = LiveWorkbookBridge()
    bridge.poll(presence())
    command = asyncio.create_task(bridge.request_async('one', 'edit', {}))
    await asyncio.sleep(.01)
    assert bridge.pending
    command.cancel()
    with pytest.raises(asyncio.CancelledError):
        await command
    assert not bridge.pending
    assert not bridge.poll(presence())['commands']
    bridge.close()


@pytest.mark.asyncio
async def test_http_token_cors_schema_and_revocation():
    bridge = LiveWorkbookBridge()
    app = create_bridge_app(bridge, TOKEN, 'https://sheets.example')
    async with AsyncClient(transport=ASGITransport(app), base_url='http://bridge') as client:
        assert (await client.post('/bridge/poll', json=presence().model_dump())).status_code == 401
        assert (await client.post('/bridge/poll', headers=AUTH, json={**presence().model_dump(), 'source': 'refused'})).status_code == 422
        for origin in ('http://localhost:4200', 'http://127.0.0.1:4200', 'https://sheets.example'):
            response = await client.options('/bridge/poll', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,content-type'})
            assert response.headers['access-control-allow-origin'] == origin
        response = await client.options('/bridge/poll', headers={
            'Origin': 'https://unrelated.example', 'Access-Control-Request-Method': 'POST'})
        assert 'access-control-allow-origin' not in response.headers
        assert (await client.post('/bridge/poll', headers=AUTH, json=presence().model_dump())).status_code == 200
        assert (await client.post('/bridge/unshare', headers=AUTH, json={'workbook': 'one'})).status_code == 200
        assert (await client.post('/bridge/poll', headers=AUTH, json=presence().model_dump())).status_code == 409
    bridge.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('bind_host,allowed_hosts,request_host', [
    ('127.0.0.1', None, '127.0.0.1'),
    ('192.0.2.10', None, '192.0.2.10'),
    ('0.0.0.0', ['192.0.2.10'], '192.0.2.10'),
    ('0.0.0.0', ['*'], '192.0.2.35'),
])
async def test_remote_http_mcp_auth_and_shared_app_routing(bind_host, allowed_hosts, request_host):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from reaktiv_workbook.api.serving import BackgroundServer
    from reaktiv_workbook.mcp_server import create_live_http_app

    server = BackgroundServer(create_live_http_app(TOKEN, host=bind_host, allowed_hosts=allowed_hosts))
    base = f'http://127.0.0.1:{server.port}'
    try:
        async with AsyncClient(base_url=base, headers={**AUTH, 'Host': f'{request_host}:{server.port}', 'Accept': 'application/json, text/event-stream'}) as app:
            for attempt in range(100):
                try:
                    response = await app.post('/bridge/poll', json=presence().model_dump())
                    if response.status_code == 200:
                        break
                except httpx.ConnectError:
                    pass
                await asyncio.sleep(.02)
            else:
                raise AssertionError('HTTP server did not start')
            # Mounted MCP routes must enforce auth independently of FastAPI dependencies.
            assert (await app.post('/mcp', headers={'Authorization': 'Bearer wrong'}, json={})).status_code == 401
            unrestricted = allowed_hosts is not None and '*' in allowed_hosts
            assert (await app.post('/mcp', headers={'Host': 'unlisted.example'}, json={})).status_code == (400 if unrestricted else 421)
            assert (await app.post('/mcp', headers={'Origin': 'https://unrelated.example'}, json={})).status_code == 403
            if unrestricted:
                for host_header in ('another.example:8766', '198.51.100.9:8766', '[2001:db8::1]:8766'):
                    assert (await app.post('/mcp', headers={'Host': host_header}, json={})).status_code == 400
                    assert (await app.post('/mcp', headers={'Host': host_header, 'Authorization': 'Bearer wrong'}, json={})).status_code == 401
                assert (await app.post('/mcp', headers={'Origin': 'http://localhost:4200'}, json={})).status_code == 400
            async with AsyncClient() as anonymous:
                assert (await anonymous.get(base + '/mcp')).status_code == 401
            async with streamable_http_client(base + '/mcp', http_client=app) as (reader, writer, _):
                async with ClientSession(reader, writer) as client:
                    await client.initialize()
                    assert {t.name for t in (await client.list_tools()).tools} == {
                        'list_workbooks', 'get_user_context', 'read_workbook', 'edit_cells', 'save_workbook',
                        'get_workbook_overview', 'inspect_cells', 'get_dependencies', 'get_logs',
                        'get_diagnostics', 'get_kernel_status', 'control_kernel',
                        'get_authoring_guide', 'list_actions', 'upsert_action', 'run_action',
                        'cancel_action', 'get_rendering_capabilities', 'get_workbook_environment', 'update_workbook_environment',
                        'manage_worksheet', 'add_image', 'inspect_cell_layout', 'inspect_visual', 'set_cell_view', 'set_cell_colors', 'resize_worksheet', 'set_worksheet_layout', 'move_cells', 'set_cell_label',
                        'insert_rows_or_columns', 'delete_rows_or_columns'}
                    advertised = {tool.name: tool.annotations for tool in (await client.list_tools()).tools}
                    assert advertised['get_logs'].readOnlyHint is True
                    assert advertised['control_kernel'].destructiveHint is True
                    resources = await client.list_resources()
                    guide_resource = next(item for item in resources.resources if item.name == 'workbook-authoring/SKILL.md')
                    resource = await client.read_resource(guide_resource.uri)
                    guide = resource.contents[0].text
                    assert 'name: reaktiv-workbook-workbook-authoring' in guide
                    assert 'resize_worksheet' in guide
                    assert any(prompt.name == 'workbook_authoring' for prompt in (await client.list_prompts()).prompts)
                    prompt = await client.get_prompt('workbook_authoring')
                    assert guide in prompt.messages[0].content.text
                    tool_guide = await client.call_tool('get_authoring_guide', {})
                    assert guide in tool_guide.content[0].text
                    listed = await client.call_tool('list_workbooks', {})
                    assert listed.structuredContent['open'][0]['workbook'] == 'one'
                    # Stateless HTTP requests retain the process-owned bridge registry.
                    assert (await client.call_tool('list_workbooks', {})).structuredContent == listed.structuredContent
                    for name, arguments, operation, expected in [
                        ('get_workbook_overview', {}, 'overview', {}),
                        ('inspect_cells', {'cell_ids': ['A1']}, 'inspect', {'cellIds': ['A1']}),
                        ('get_dependencies', {'cell_ids': ['A1'], 'mode': 'source', 'depth': 2},
                            'dependencies', {'cellIds': ['A1'], 'mode': 'source', 'depth': 2}),
                        ('get_logs', {'level': 'error', 'limit': 5}, 'logs', {'level': 'error', 'limit': 5}),
                        ('get_diagnostics', {}, 'diagnostics', {}),
                        ('get_kernel_status', {}, 'kernel-status', {}),
                        ('control_kernel', {'action': 'interrupt'}, 'kernel-control', {'action': 'interrupt', 'force': False}),
                        ('list_actions', {}, 'actions', {}),
                        ('upsert_action', {'revision': 'r1', 'definition': {'name': 'add', 'source': 'def add(self):\n    return 3'}},
                            'action-edit', {'revision': 'r1'}),
                        ('run_action', {'revision': 'r1', 'name': 'add', 'arguments': {'amount': {'value': 3}}},
                            'action-run', {'name': 'add', 'arguments': {'amount': {'value': 3}}}),
                        ('cancel_action', {'name': 'add'}, 'action-cancel', {'name': 'add'}),
                        ('set_cell_colors', {'revision': 'r1', 'cell_ids': ['A1'], 'color': '#cde7ae'},
                            'colors', {'cellIds': ['A1'], 'color': '#cde7ae'}),
                        ('set_cell_colors', {'revision': 'r1', 'cell_ids': ['A1'], 'expression': "'#ffcccc' if A1 > 80 else None"},
                            'colors', {'cellIds': ['A1'], 'color': '', 'expression': "'#ffcccc' if A1 > 80 else None"}),
                        ('set_worksheet_layout', {'revision': 'r1', 'worksheet': 'Sheet1', 'row_heights': {'2': 64}, 'column_widths': {'B': None}},
                            'tracks', {'worksheet': 'Sheet1', 'rowHeights': {'2': 64}, 'columnWidths': {'B': None}}),
                        ('move_cells', {'revision': 'r1', 'cell_id': 'A1', 'target_id': 'A2'},
                            'move', {'cellId': 'A1', 'targetId': 'A2'}),
                        ('set_cell_label', {'revision': 'r1', 'cell_id': 'A1', 'label': ''},
                            'label', {'cellId': 'A1', 'label': ''}),
                        ('resize_worksheet', {'revision': 'r1', 'worksheet': 'Sheet1', 'columns': 12, 'rows': 30},
                            'resize', {'worksheet': 'Sheet1', 'columns': 12, 'rows': 30}),
                        ('insert_rows_or_columns', {'revision': 'r1', 'worksheet': 'Sheet1', 'axis': 'row', 'before': 3},
                            'grid-lines', {'worksheet': 'Sheet1', 'axis': 'row', 'change': 'insert', 'index': 3, 'count': 1}),
                        ('delete_rows_or_columns', {'revision': 'r1', 'worksheet': 'Sheet1', 'axis': 'column', 'start': 'B', 'count': 2},
                            'grid-lines', {'worksheet': 'Sheet1', 'axis': 'column', 'change': 'delete', 'index': 'B', 'count': 2,
                                           'allowBrokenReferences': False}),
                    ]:
                        request = asyncio.create_task(client.call_tool(name, {'workbook': 'one', **arguments}))
                        for _ in range(100):
                            commands = (await app.post('/bridge/poll', json=presence().model_dump())).json()['commands']
                            if commands:
                                break
                            await asyncio.sleep(.01)
                        else:
                            raise AssertionError(f'{name} did not reach the window')
                        delivered = commands[0]
                        assert delivered['operation'] == operation
                        assert all(delivered['payload'].get(key) == value for key, value in expected.items())
                        await app.post('/bridge/reply', json={'workbook': 'one', 'id': delivered['id'],
                            'result': {'routed': operation}})
                        result = await request
                        assert not result.isError
                        assert result.structuredContent['routed'] == operation
                    editing = asyncio.create_task(client.call_tool('edit_cells', {
                        'workbook': 'one', 'revision': 'live-r1',
                        'cells': [{'id': 'C1', 'kind': 'markdown', 'source': '# From remote OpenCode', 'view': {'page': True}}]}))
                    for attempt in range(100):
                        commands = (await app.post('/bridge/poll', json=presence().model_dump())).json()['commands']
                        if commands:
                            break
                        await asyncio.sleep(.02)
                    else:
                        raise AssertionError('HTTP MCP command did not reach the shared window')
                    command = commands[0]
                    assert command['payload']['revision'] == 'live-r1'
                    await app.post('/bridge/reply', json={
                        'workbook': 'one', 'id': command['id'], 'result': {'revision': 'live-r2'}})
                    result = await editing
                    assert not result.isError
                    assert result.structuredContent['revision'] == 'live-r2'
                    await app.post('/bridge/unshare', json={'workbook': 'one'})
                    assert (await client.call_tool('list_workbooks', {})).structuredContent['open'] == []
    finally:
        await asyncio.to_thread(server.stop)


def test_cli_starts_authenticated_http_by_default(monkeypatch):
    from reaktiv_workbook.mcp_server import main
    import uvicorn

    calls = []
    monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', TOKEN)
    monkeypatch.setattr('sys.argv', ['reaktiv-workbook-mcp', '--port', '9876'])
    monkeypatch.setattr(uvicorn, 'run', lambda app, **options: calls.append((app, options)))
    main()
    assert len(calls) == 1
    assert calls[0][1] == {'host': '127.0.0.1', 'port': 9876, 'access_log': False}
    assert any(route.path == '/bridge/poll' for route in calls[0][0].routes)


@pytest.mark.parametrize('arguments', [
    ['--transport', 'stdio'], ['--transport', 'streamable-http'], ['--root', '/tmp'], ['--live'],
])
def test_cli_rejects_removed_mode_options(monkeypatch, arguments):
    from reaktiv_workbook.mcp_server import main

    monkeypatch.setattr('sys.argv', ['reaktiv-workbook-mcp', *arguments])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2


@pytest.mark.parametrize('bind_host,extra', [
    ('192.0.2.10', []), ('0.0.0.0', ['--allowed-host', '192.0.2.10']),
    ('0.0.0.0', ['--allowed-host', '*']),
])
def test_cli_binds_requested_interface(monkeypatch, bind_host, extra):
    from reaktiv_workbook.mcp_server import main
    import uvicorn

    calls = []
    monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', TOKEN)
    monkeypatch.setattr('sys.argv', ['reaktiv-workbook-mcp', '--host', bind_host, *extra])
    monkeypatch.setattr(uvicorn, 'run', lambda app, **options: calls.append(options))
    main()
    assert calls[0]['host'] == bind_host


def test_wildcard_bind_requires_reachable_host(monkeypatch, capsys):
    from reaktiv_workbook.mcp_server import main

    monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', TOKEN)
    monkeypatch.setattr('sys.argv', ['reaktiv-workbook-mcp', '--host', '0.0.0.0'])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert '--allowed-host' in capsys.readouterr().err


def test_view_context_tracks_navigation_and_fresh_context_tool():
    from reaktiv_workbook.mcp_bridge import ViewContext
    from reaktiv_workbook.mcp_server import create_live_server
    context = ViewContext(windowFocused=True, lastFocusedAt='2026-11-04T12:00:00Z',
        view='notes', activePane=0, panes=[{'index': 0, 'view': 'notes', 'worksheet': 'Sheet1',
            'note': {'id': 'B1', 'name': 'overview', 'kind': 'markdown', 'title': 'Overview'}}],
        selectedCell={'id': 'A1', 'name': 'amount', 'kind': 'input'}, selectedCellIds=['A1'],
        inspectedCell=None, focusedCellId='B1', editorCellId=None, notesEditing=False,
        actionsOpen=False, consoleOpen=False)
    bridge = LiveWorkbookBridge()
    window = presence()
    window.context = context
    bridge.poll(window)
    assert bridge.list_workbooks()['open'][0]['context']['panes'][0]['note']['id'] == 'B1'
    context.view = 'sheet'
    context.panes[0].view = 'sheet'
    context.panes[0].note = None
    bridge.poll(window)
    assert bridge.list_workbooks()['open'][0]['context']['view'] == 'sheet'

    async def exercise():
        server = create_live_server(bridge, allowed_hosts=['127.0.0.1'])
        task = asyncio.create_task(server.call_tool('get_user_context', {'workbook': 'one'}))
        for _ in range(100):
            commands = bridge.poll(window)['commands']
            if commands:
                break
            await asyncio.sleep(.01)
        else:
            raise AssertionError('Context was not requested from the live window')
        assert commands[0]['operation'] == 'context'
        bridge.reply(CommandReply(workbook='one', id=commands[0]['id'], result={'context': context.model_dump()}))
        result = await task
        assert 'sheet' in str(result)
    try:
        asyncio.run(exercise())
    finally:
        bridge.close()


@pytest.mark.asyncio
async def test_skill_action_example_validates_and_runs_in_the_real_engine():
    import json
    import re
    from reaktiv_workbook.mcp_server import authoring_guide
    from reaktiv_workbook import ActionDefinition, CellDefinition, ReactiveWorkbook, SheetDocument
    guide = authoring_guide()
    snippet = re.search(r'```json\n(.*?)\n```', guide, re.DOTALL)
    assert snippet is not None
    definition = ActionDefinition.from_dict(json.loads(snippet.group(1)))
    workbook = ReactiveWorkbook()
    document = SheetDocument(cells=(CellDefinition('A1', 'input', '1', name='quantity'),),
        actions=(definition,))
    await workbook.load_document_async(document)
    # Installing/inspecting a method must not invoke it.
    assert next(cell['value'] for cell in workbook.snapshot().cells if cell['id'] == 'A1') == 1
    result = await workbook.run_action_async('add_items', {'amount': {'value': 3}})
    assert next(cell['value'] for cell in result.cells if cell['id'] == 'A1') == 4


def test_any_server_host_origin_matching_preserves_explicit_origin():
    from reaktiv_workbook.mcp_server import mcp_origin_allowed
    assert mcp_origin_allowed('https://sheets.example', 'https://sheets.example')
    assert mcp_origin_allowed('http://[::1]:4200', None)
    assert not mcp_origin_allowed('https://sheets.example.evil', 'https://sheets.example')
    assert not mcp_origin_allowed('http://localhost.evil:4200', None)


def test_mcp_view_patch_preserves_metadata_merges_widgets_and_validates_markdown_intent():
    from reaktiv_workbook import CellDefinition
    from reaktiv_workbook.mcp_server import patch_cell_view, mcp_cell_definition
    original = CellDefinition('A1', 'input', '7', name='amount', color='#cde7ae', view={
        'span': [2, 3], 'display': 'rendered', 'widget': {'type': 'number', 'min': 0, 'max': 20}})
    updated = patch_cell_view(original, {'widget': {'type': 'range', 'max': 100}})
    assert updated.source == '7' and updated.name == 'amount' and updated.color == original.color
    assert updated.view == {'span': [2, 3], 'display': 'rendered', 'widget': {'type': 'range', 'min': 0, 'max': 100}}
    assert patch_cell_view(updated, {'widget': {'min': None}}).view['widget'] == {'type': 'range', 'max': 100}
    assert patch_cell_view(updated, {'widget': None}).view == {'span': [2, 3], 'display': 'rendered'}
    assert original.view['widget']['type'] == 'number'
    for patch in [{'unknown': True}, {'widget': {'type': 'slider'}}, {'widget': {'type': 'range', 'step': True}}, {'span': [0, 3]}, {'widget': {'type': 'number', 'typo': 1}}]:
        with pytest.raises((ValueError, TypeError)):
            patch_cell_view(original, patch)
    markdown = {'id': 'B1', 'kind': 'markdown', 'source': '**Voltage**'}
    with pytest.raises(ValueError, match='explicit view.page'):
        mcp_cell_definition(markdown)
    label = mcp_cell_definition({**markdown, 'view': {'page': False, 'display': 'rendered'}})
    assert label.view == {'page': False, 'display': 'rendered'}
    assert mcp_cell_definition({**markdown, 'view': {'page': True}}).view is None
    assert patch_cell_view(label, {'page': True}).view == {'display': 'rendered'}
    assert patch_cell_view(label, {'span': [2, 1]}).view['page'] is False


@pytest.mark.asyncio
async def test_set_cell_view_routes_through_inspect_then_revision_protected_edit(monkeypatch):
    from reaktiv_workbook.mcp_server import create_live_server
    bridge = LiveWorkbookBridge()
    calls = []
    async def request(workbook, operation, payload):
        calls.append((workbook, operation, payload))
        if operation == 'inspect':
            return {'revision': 'r1', 'cells': [{'id': 'A1', 'kind': 'input', 'source': '7', 'name': 'amount', 'view': {'span': [2, 2]}}]}
        return {'revision': 'r2'}
    monkeypatch.setattr(bridge, 'request_async', request)
    server = create_live_server(bridge, allowed_hosts=['127.0.0.1:*'])
    await server.call_tool('set_cell_view', {'workbook': 'one', 'revision': 'r1', 'cell_id': 'A1',
        'view': {'display': 'rendered', 'widget': {'type': 'range', 'min': 0, 'max': 100}}})
    assert [call[1] for call in calls] == ['inspect', 'edit', 'inspect']
    assert calls[1][2]['revision'] == 'r1'
    cell = calls[1][2]['cells'][0]
    assert cell['source'] == '7' and cell['name'] == 'amount'
    assert cell['view'] == {'span': [2, 2], 'display': 'rendered', 'widget': {'type': 'range', 'min': 0, 'max': 100}}
    calls.clear()
    with pytest.raises(Exception, match='conflict'):
        await server.call_tool('set_cell_view', {'workbook': 'one', 'revision': 'old', 'cell_id': 'A1', 'view': {'display': 'rendered'}})
    assert [call[1] for call in calls] == ['inspect']
    bridge.close()


@pytest.mark.asyncio
async def test_view_only_edit_preserves_live_values_and_does_not_rerun_input_initializers():
    from reaktiv_workbook import CellDefinition, ReactiveWorkbook
    from reaktiv_workbook.mcp_server import patch_cell_view
    initializers = []
    workbook = ReactiveWorkbook({'initializers': initializers})
    cells = [CellDefinition('A1', 'input', '(initializers.append(1), 7)[1]', name='amount'),
        CellDefinition('B1', 'formula', 'amount * 2')]
    try:
        await workbook.apply_async(cells)
        node = workbook._nodes['A1']
        snapshot = await workbook.apply_async([patch_cell_view(cells[0], {
            'display': 'rendered', 'widget': {'type': 'range', 'min': 0, 'max': 100}}), cells[1]])
        assert initializers == [1]
        assert workbook._nodes['A1'] is node
        results = {cell['id']: cell for cell in snapshot.cells}
        assert results['A1']['value'] == 7 and results['B1']['value'] == 14
        assert results['A1']['widget']['type'] == 'range'
    finally:
        workbook.close()


@pytest.mark.asyncio
async def test_set_cell_view_sampling_failure_preserves_successful_edit_without_retry(monkeypatch):
    from reaktiv_workbook.mcp_server import create_live_server
    bridge = LiveWorkbookBridge()
    calls = []
    async def request(workbook, operation, payload):
        calls.append(operation)
        if operation == 'edit':
            return {'revision': 'r2', 'applied': True}
        if len(calls) == 1:
            return {'revision': 'r1', 'cells': [{'id': 'A1', 'kind': 'input', 'source': '7'}]}
        raise RuntimeError('Window disconnected after commit')
    monkeypatch.setattr(bridge, 'request_async', request)
    server = create_live_server(bridge, allowed_hosts=['127.0.0.1:*'])
    result = await server.call_tool('set_cell_view', {'workbook': 'one', 'revision': 'r1', 'cell_id': 'A1', 'view': {'display': 'rendered'}})
    assert 'unavailable' in str(result) and 'r2' in str(result)
    assert calls == ['inspect', 'edit', 'inspect']
    bridge.close()


@pytest.mark.asyncio
async def test_management_and_visual_tools_forward_bounded_requests(monkeypatch):
    import base64
    from reaktiv_workbook.mcp_server import create_live_server
    bridge = LiveWorkbookBridge()
    calls = []

    async def request(workbook, operation, payload):
        calls.append((workbook, operation, payload))
        if operation == 'visual':
            return {'mimeType':'image/png','dataBase64':'aGVsbG8=','cellId':'A1','captureKind':'visible-cell'}
        if operation == 'inspect':
            return {'revision':'r2','layout':[{'cellId':'A1','fit':{'resizeNeeded':True}}], 'cells':[{'id':'A1'}]}
        return {'revision':'r2'}

    monkeypatch.setattr(bridge, 'request_async', request)
    server = create_live_server(bridge, allowed_hosts=['127.0.0.1'])
    await server.call_tool('manage_worksheet', {'workbook':'one','revision':'r1','action':'create','name':'Circuits','columns':20})
    assert calls[-1] == ('one','worksheets',{'revision':'r1','action':'create','name':'Circuits','columns':20,'allowBrokenReferences':False})
    await server.call_tool('update_workbook_environment', {'workbook':'one','revision':'r2','shared_code':'','packages':['schemdraw']})
    assert calls[-1][2] == {'revision':'r2','code':'','packages':['schemdraw']}
    await server.call_tool('get_workbook_environment', {'workbook':'one'})
    assert calls[-1][2] == {'read':True}
    visual = await server.call_tool('inspect_visual', {'workbook':'one','cell_id':'A1'})
    assert any(getattr(item,'type',None)=='image' for item in (visual[0] if isinstance(visual, tuple) else visual)), repr(visual)[:1200]
    await server.call_tool('add_image', {'workbook':'one','revision':'r1','mime_type':'image/png','data_base64':base64.b64encode(b'image').decode()})
    assert calls[-1][1] == 'asset'
    with pytest.raises(Exception,match='base64|Invalid|padding|Only'):
        await server.call_tool('add_image', {'workbook':'one','revision':'r1','mime_type':'image/png','data_base64':'!bad!'})
    capabilities = await server.call_tool('get_rendering_capabilities', {})
    assert 'LaTeX' in str(capabilities) or 'latex' in str(capabilities)


def test_mcp_view_patch_accepts_opt_in_action_cancellation():
    from reaktiv_workbook.model import CellDefinition
    from reaktiv_workbook.mcp_server import patch_cell_view
    button = CellDefinition("A1", "input", "0")
    updated = patch_cell_view(button, {"widget": {"type": "button", "action": "measure", "cancelWhileRunning": True}})
    assert updated.view["widget"]["cancelWhileRunning"] is True
    assert updated.source == "0"
