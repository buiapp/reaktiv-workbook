"""Standalone CLI, lifecycle, app-mode boundary and image-save regression tests."""
import base64
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import runpy
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import pytest
from reaktiv_workbook import ActionDefinition, CellDefinition, SheetDocument, SheetSession
from reaktiv_workbook.cli import main as evaluate
from reaktiv_workbook.commands import command_main
from reaktiv_workbook import standalone
from reaktiv_workbook.session_assets import read_assets, write_assets


@pytest.fixture
def workbook(tmp_path):
    path = tmp_path / 'example.sheet.py'
    SheetDocument(name='CLI sample', cells=(
        CellDefinition('A1', 'input', '3', name='quantity'),
        CellDefinition('B1', 'formula', 'quantity * 2', name='total'),
        CellDefinition('C1', 'linked', 'quantity * 4', name='suggested'),
    ), actions=(ActionDefinition('increase', 'def increase(self):\n    self.quantity.set(self.quantity() + 1)', references={'quantity': 'A1'}),)).save(path)
    return path


def connection(session):
    parts = urlsplit(session.open_editor('http://127.0.0.1:4200/', open_browser=False))
    return parse_qs(parts.query)['session'][0], parse_qs(parts.fragment)['token'][0]


def post(endpoint, token, route, payload):
    request = Request(endpoint + route, data=json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def test_commands_dispatch_only_explicit_launch_commands(workbook, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(standalone, 'serve_workbook', lambda path, **kwargs: calls.append((path, kwargs)) or 0)
    assert command_main(['edit', str(workbook), '--headless', '--port', '8765']) == 0
    handoff = calls[0][1].pop('handoff')  # where the editor's workbook goes on a restart
    assert handoff.name.endswith('.workbook.py') and not handoff.exists()
    assert calls == [(workbook, {'mode': 'edit', 'host': '127.0.0.1', 'allow_remote': False, 'port': 8765,
                                 'open_browser': False, 'mcp_port': None, 'resume': None})]
    assert command_main(['run', str(workbook), '--no-browser']) == 0
    assert len(calls) == 2
    assert command_main(['check', str(workbook)]) == 0
    assert command_main(['evaluate', str(workbook), '--cell', 'total']) == 0
    assert command_main([str(workbook), '--check']) == 0
    assert command_main(['export', str(workbook), str(workbook.parent / 'export')]) == 0
    assert command_main(['check', str(workbook.parent / 'missing.sheet.py')]) == 2
    assert len(calls) == 2
    assert command_main([]) == 0
    assert 'edit' in capsys.readouterr().out
    with pytest.raises(SystemExit):
        command_main(['run'])
    with pytest.raises(SystemExit):
        command_main(['edit', str(workbook), '--port', '-1'])
    with pytest.raises(SystemExit):
        command_main(['edit', '--host', '0.0.0.0'])
    assert 'add --allow-remote' in capsys.readouterr().err
    with pytest.raises(SystemExit):
        command_main(['edit', str(workbook), '--host', '0.0.0.0', '--allow-remote', '--mcp'])
    assert command_main(['run', str(workbook), '--host', '0.0.0.0', '--allow-remote', '--headless']) == 0
    assert calls[-1][1]['host'] == '0.0.0.0' and calls[-1][1]['allow_remote'] is True


def test_remote_session_serves_a_link_that_attaches_to_its_own_origin(workbook):
    with SheetSession(workbook) as session:
        with pytest.raises(ValueError):
            session.open_editor(host='0.0.0.0', open_browser=False)
        parts = urlsplit(session.open_editor(host='0.0.0.0', open_browser=False, allow_remote=True))
        assert parts.hostname not in ('0.0.0.0', '127.0.0.1', None)
        assert parse_qs(parts.query)['session'] == ['/']
        token = parse_qs(parts.fragment)['token'][0]
        # Reachable on every interface, and still only with the token.
        endpoint = f'http://127.0.0.1:{parts.port}'
        assert post(endpoint, token, '/v1/session', {})['document']
        with pytest.raises(HTTPError):
            post(endpoint, 'wrong', '/v1/session', {})


def test_generated_workbook_entrypoint_cannot_launch_ui(workbook, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('Workbook execution must never dispatch a UI command')
    monkeypatch.setattr(standalone, 'serve_workbook', forbidden)
    monkeypatch.setattr('reaktiv_workbook.cli.command_main', forbidden)
    monkeypatch.setattr('sys.argv', [str(workbook), 'edit'])
    with pytest.raises(SystemExit) as result:
        runpy.run_path(str(workbook), run_name='__main__')
    assert result.value.code == 0
    # Even explicit editor-like flags cannot make the evaluator start a server.
    with pytest.raises(SystemExit):
        evaluate([str(workbook), '--headless'])


def test_run_mode_allows_controls_but_refuses_authoring_and_saving(workbook):
    original = workbook.read_bytes()
    with SheetSession.load(workbook) as session:
        session.mode = 'run'
        endpoint, token = connection(session)
        state = post(endpoint, token, '/v1/session', {})
        assert state['mode'] == 'run'
        for route, payload in [
            ('/v1/console', {'source': '1', 'sheet': ''}),
            ('/v1/apply', {'cells': []}),
            ('/v1/session-save', {'document': state['document']}),
            ('/v1/update-action', {'definition': {}, 'expectedRevision': 'x'}),
        ]:
            with pytest.raises(HTTPError) as error:
                post(endpoint, token, route, payload)
            assert error.value.code == 400
            assert 'run mode' in error.value.read().decode()
        post(endpoint, token, '/v1/set-inputs', {'sources': {'A1': '5', 'C1': '99'}})
        assert session.values.total() == 10
        assert session.values.suggested() == 99
        reset = post(endpoint, token, '/v1/session-reset-input', {'cellId': 'C1'})
        assert reset['sessionRevision'] == post(endpoint, token, '/v1/session', {})['revision']
        assert session.values.suggested() == 20
        post(endpoint, token, '/v1/run-action', {'name': 'increase'})
        assert session.values.total() == 12
        with pytest.raises(HTTPError):
            post(endpoint, token, '/v1/set-inputs', {'sources': {'A1': '__import__("os").getcwd()'}})
        assert session.values.quantity() == 6
    assert workbook.read_bytes() == original


def test_cli_editor_lifecycle_creates_once_and_closes_server(tmp_path, monkeypatch):
    root = tmp_path / 'web'
    root.mkdir()
    (root / 'index.html').write_text('<app-root></app-root>')
    monkeypatch.setattr(standalone, 'frontend_root', lambda: root)
    path = tmp_path / 'new.sheet.py'
    url = []
    monkeypatch.setattr(standalone.webbrowser, 'open', lambda value: url.append(value))
    monkeypatch.setattr(standalone, 'wait_for_shutdown', lambda *_: None)
    assert standalone.serve_workbook(path, mode='edit') == 0
    assert path.is_file() and len(url) == 1
    original = path.read_bytes()
    assert standalone.serve_workbook(path, mode='run', open_browser=False) == 0
    assert path.read_bytes() == original
    with pytest.raises(FileNotFoundError):
        standalone.serve_workbook(tmp_path / 'missing.sheet.py', mode='run', open_browser=False)


def test_session_assets_round_trip_and_session_save(workbook):
    image = b'example image bytes'
    reference = 'assets/' + hashlib.sha256(image).hexdigest()[:16] + '.png'
    document = SheetDocument.load(workbook)
    document = replace(document, cells=(*document.cells, CellDefinition('D1', 'markdown', f'![Image]({reference})')))
    encoded = {reference: base64.b64encode(image).decode()}
    prose = replace(document, cells=(CellDefinition('A1', 'markdown', f'Example path: `{reference}`'),))
    assert read_assets(workbook, prose) == {}
    write_assets(workbook, document, encoded)
    document.save(workbook)
    with SheetSession.load(workbook) as session:
        endpoint, token = connection(session)
        initial = post(endpoint, token, '/v1/session', {})
        assert initial['assets'] == encoded
        session.inputs.quantity.set(8)
        update = post(endpoint, token, '/v1/session', {'after': initial['revision']})
        assert 'assets' not in update
        saved = post(endpoint, token, '/v1/session-save', {
            'document': update['document'], 'sessionRevision': update['revision'], 'assets': encoded,
        })
        assert saved['document']['cells'][0]['source'] == '8'
    assert read_assets(workbook, SheetDocument.load(workbook)) == encoded
    assert (workbook.parent / reference).read_bytes() == image
    with pytest.raises(ValueError):
        write_assets(workbook, document, {'../escape.png': 'eA=='})
    with pytest.raises(ValueError):
        write_assets(workbook, document, {reference: 'eA=='})
    image_path = workbook.parent / reference
    image_path.unlink()
    image_path.symlink_to(workbook)
    with pytest.raises(ValueError, match='symbolic'):
        read_assets(workbook, document)


def test_new_workbooks_use_the_workbook_suffix_and_sheet_files_keep_working(tmp_path, monkeypatch):
    from reaktiv_workbook.model import is_workbook_filename, workbook_stem

    root = tmp_path / 'web'
    root.mkdir()
    (root / 'index.html').write_text('<app-root></app-root>')
    monkeypatch.setattr(standalone, 'frontend_root', lambda: root)
    monkeypatch.setattr(standalone, 'wait_for_shutdown', lambda *_: None)

    created = tmp_path / 'budget.workbook.py'
    assert standalone.serve_workbook(created, mode='edit', open_browser=False) == 0
    assert SheetDocument.load(created).name == 'budget'
    legacy = tmp_path / 'legacy.sheet.py'
    assert standalone.serve_workbook(legacy, mode='edit', open_browser=False) == 0
    assert SheetDocument.load(legacy).name == 'legacy'
    with pytest.raises(ValueError, match=r'\.workbook\.py'):
        standalone.serve_workbook(tmp_path / 'plain.py', mode='edit', open_browser=False)

    assert is_workbook_filename('a.workbook.py') and is_workbook_filename('A.SHEET.PY')
    assert not is_workbook_filename('a.py')
    assert workbook_stem('a.b.workbook.py') == 'a.b' and workbook_stem('x.sheet.py') == 'x'


def test_edit_without_a_file_keeps_an_existing_legacy_default(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(standalone, 'serve_workbook', lambda path, **kwargs: calls.append(path) or 0)
    monkeypatch.chdir(tmp_path)
    assert command_main(['edit', '--headless']) == 0
    assert calls[-1] == Path('untitled.workbook.py')
    SheetDocument(name='old default').save(tmp_path / 'workbook.sheet.py')
    assert command_main(['edit', '--headless']) == 0
    assert calls[-1] == Path('workbook.sheet.py')


def test_edit_mcp_serves_an_authenticated_bridge_linked_from_the_editor(workbook, monkeypatch):
    from reaktiv_workbook.agent_bridge import AgentBridge
    from reaktiv_workbook.standalone import with_agent_bridge

    editor = 'http://127.0.0.1:4321/?session=http%3A%2F%2F127.0.0.1%3A4321#token=abc'
    server = AgentBridge(0, 'http://127.0.0.1:4321')
    endpoint, token = server.endpoint, server.token
    try:
        assert len(token) >= 32 and endpoint == f'http://127.0.0.1:{server.port}' and server.serving
        def unshare(bearer):
            body = json.dumps({'workbook': 'none'}).encode()
            request = Request(endpoint + '/bridge/unshare', data=body, method='POST',
                              headers={'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/json'})
            with urlopen(request, timeout=10) as response:
                return response.status
        with pytest.raises(HTTPError) as refused:
            unshare('wrong')
        assert refused.value.code == 401
        assert unshare(token) == 200
        url = with_agent_bridge(editor, endpoint, token)
        parts = urlsplit(url)
        assert parse_qs(parts.query) == {'session': ['http://127.0.0.1:4321'], 'mcp': [endpoint]}
        assert parse_qs(parts.fragment) == {'token': ['abc'], 'mcpToken': [token]}
    finally:
        server.stop()

    calls = []
    monkeypatch.setattr(standalone, 'serve_workbook', lambda path, **kwargs: calls.append(kwargs) or 0)
    assert command_main(['edit', str(workbook), '--headless', '--mcp', '--mcp-port', '0']) == 0
    assert calls[-1]['mcp_port'] == 0
    from reaktiv_workbook.commands import build_parser, sandbox_arguments
    rebuilt = sandbox_arguments(build_parser().parse_args(['edit', str(workbook), '--mcp', '--sandbox']))
    assert rebuilt[-3:] == ['--mcp', '--mcp-port', '8766']


@pytest.fixture
def web_root(tmp_path, monkeypatch):
    root = tmp_path / 'web'
    (root / 'examples' / 'education').mkdir(parents=True)
    (root / 'index.html').write_text('<app-root></app-root>')
    SheetDocument(name='welcome', cells=(CellDefinition('A1', 'input', '7', name='seven'),)).save(root / 'examples' / 'welcome.workbook.py')
    SheetDocument(name='motion').save(root / 'examples' / 'education' / 'motion.workbook.py')
    monkeypatch.setattr(standalone, 'frontend_root', lambda: root)
    monkeypatch.setattr(standalone, 'wait_for_shutdown', lambda *_: None)
    return root


def test_new_creates_a_working_starter_and_links_the_guide_only_while_untouched(tmp_path, web_root, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert command_main(['new', '--headless']) == 0
    path = tmp_path / 'untitled.workbook.py'
    output = capsys.readouterr().out
    assert 'Created untitled.workbook.py' in output and '&new=1' in output
    with SheetSession.load(path) as session:
        assert session.values.total() == 13.5
    # `new` never overwrites; `edit` reopens the untouched starter with the guide.
    assert command_main(['new', '--headless']) == 2
    assert 'already exists' in capsys.readouterr().err
    assert command_main(['edit', '--headless']) == 0
    assert '&new=1' in capsys.readouterr().out
    # Once edited, it is an ordinary workbook.
    path.write_text(path.read_text().replace('"""# New workbook', '"""# My model'))
    assert command_main(['edit', '--headless']) == 0
    assert 'new=1' not in capsys.readouterr().out


def test_new_from_an_example_copies_it_next_to_the_user(tmp_path, web_root, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert command_main(['new', '--from', 'welcome', '--headless']) == 0
    copied = tmp_path / 'welcome.workbook.py'
    assert copied.read_bytes() == (web_root / 'examples' / 'welcome.workbook.py').read_bytes()
    assert 'new=1' not in capsys.readouterr().out
    assert command_main(['new', 'lesson.workbook.py', '--from', 'education/motion', '--headless']) == 0
    assert SheetDocument.load(tmp_path / 'lesson.workbook.py').name == 'motion'
    assert command_main(['new', '--from', 'missing', '--headless']) == 2
    error = capsys.readouterr().err
    assert "No example named 'missing'" in error and 'welcome, education/motion' in error
    assert not (tmp_path / 'missing.workbook.py').exists()
    assert command_main(['new', 'plain.py', '--headless']) == 2


def test_missing_packages_offer_a_sandbox_in_a_terminal(tmp_path, monkeypatch, capsys):
    from reaktiv_workbook import sandbox

    assert sandbox.missing_packages(['numpy>=1', 'no-such-package-xyz[extra]>=2', 'no-such-package-xyz', ' ']) == ['no-such-package-xyz']
    path = tmp_path / 'needs.workbook.py'
    SheetDocument(name='needs', packages=('no-such-package-xyz>=2',)).save(path)
    served, sandboxed = [], []
    monkeypatch.setattr(standalone, 'serve_workbook', lambda file, **kwargs: served.append(file) or 0)
    monkeypatch.setattr(sandbox, 'run_sandboxed', lambda file, arguments: sandboxed.append(arguments) or 0)
    monkeypatch.delenv(sandbox.SANDBOXED, raising=False)

    # No terminal (CI, scripts): name the packages and how to get them, then open as asked.
    assert command_main(['run', str(path), '--headless']) == 0
    error = capsys.readouterr().err
    assert 'not installed here: no-such-package-xyz' in error and '--sandbox' in error
    assert served == [path] and sandboxed == []

    # A terminal with uv: Enter accepts the sandbox, "n" keeps this environment.
    monkeypatch.setattr(sandbox, 'find_uv', lambda: 'uv')
    monkeypatch.setattr(sandbox, 'interactive', lambda: True)
    answers = iter(['', 'n'])
    monkeypatch.setattr('builtins.input', lambda prompt: next(answers))
    assert command_main(['edit', str(path), '--headless']) == 0
    assert sandboxed[-1][:2] == ['edit', str(path)] and served == [path]
    assert command_main(['edit', str(path), '--headless']) == 0
    assert served == [path, path] and len(sandboxed) == 1
    assert 'pip install no-such-package-xyz' in capsys.readouterr().err  # after answering n

    # Inside the sandbox nothing is offered again; nothing is missing either way.
    monkeypatch.setenv(sandbox.SANDBOXED, '1')
    assert command_main(['run', str(path), '--headless']) == 0
    assert len(sandboxed) == 1 and 'not installed' not in capsys.readouterr().err


def test_allow_remote_marks_a_proxied_loopback_session_as_shared(workbook):
    assert standalone.remote_warning('127.0.0.1', 'run', False) == ''
    assert 'proxy' in standalone.remote_warning('127.0.0.1', 'run', True)
    assert 'run Python' in standalone.remote_warning('0.0.0.0', 'edit', True)
    with SheetSession(workbook) as session:
        session.open_editor(open_browser=False)
        assert session.shared_root is None
    with SheetSession(workbook) as session:
        session.open_editor(open_browser=False, allow_remote=True)
        assert session.shared_root == workbook.parent
