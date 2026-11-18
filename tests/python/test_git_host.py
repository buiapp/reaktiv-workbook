"""Git through the CLI session: allowed commands, the workbook's folder, pull reloads."""
import json
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import pytest
from reaktiv_workbook import CellDefinition, SheetDocument, WorkbookSession
from reaktiv_workbook.git_host import GitRefused, find_git, run_git, valid_arguments

pytestmark = pytest.mark.skipif(find_git() is None, reason="git is not installed")


def connection(session: WorkbookSession) -> tuple[str, str]:
    parts = urlsplit(session.open_editor('http://127.0.0.1:4200/', open_browser=False))
    return parse_qs(parts.query)['session'][0], parse_qs(parts.fragment)['token'][0]


def post(endpoint: str, token: str, route: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(endpoint + route, data=json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=30) as response:
        result: dict[str, object] = json.load(response)
        return result


def git(folder: Path, *args: str) -> str:
    return subprocess.run(['git', *args], cwd=folder, check=True, capture_output=True, text=True).stdout


def repository(folder: Path) -> None:
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'config', 'user.email', 'test@example.invalid')
    git(folder, 'config', 'user.name', 'Test')


def test_only_allowed_commands_and_options_run() -> None:
    valid_arguments(['status', '--porcelain=v2', '--branch'])
    valid_arguments(['commit', '-m', '-c is fine in a message', '--only', '--', 'a.workbook.py'])
    valid_arguments(['log', '--', '--exec'])  # a path
    for refused in (['config', 'core.sshCommand', 'x'], ['push', '--receive-pack=evil'],
                    ['pull', '--upload-pack', 'evil'], ['status', '-c', 'core.pager=evil'],
                    ['status', '--git-dir=/elsewhere'], []):
        with pytest.raises(GitRefused):
            valid_arguments(refused)


def test_runs_in_the_given_folder(tmp_path: Path) -> None:
    repository(tmp_path)
    result = run_git(tmp_path, ['rev-parse', '--show-toplevel'])
    assert result['code'] == 0 and Path(str(result['stdout']).strip()).resolve() == tmp_path.resolve()


def test_session_commits_the_workbook_and_refuses_git_in_run_mode(tmp_path: Path) -> None:
    repository(tmp_path)
    path = tmp_path / 'budget.workbook.py'
    SheetDocument(name='Budget', cells=(CellDefinition('A1', 'input', '1', name='amount'),)).save(path)
    with WorkbookSession.load(path) as session:
        endpoint, token = connection(session)
        assert post(endpoint, token, '/v1/session', {})['path'] == str(path.resolve())
        status = post(endpoint, token, '/v1/git', {'args': ['status', '--porcelain', '--', 'budget.workbook.py']})
        assert status['code'] == 0 and '?? budget.workbook.py' in str(status['stdout'])
        post(endpoint, token, '/v1/git', {'args': ['add', '--', 'budget.workbook.py']})
        commit = post(endpoint, token, '/v1/git', {'args': ['commit', '--message=First', '--only', '--', 'budget.workbook.py']})
        assert commit['code'] == 0
        assert git(tmp_path, 'log', '--format=%s').strip() == 'First'
        with pytest.raises(HTTPError) as refused:
            post(endpoint, token, '/v1/git', {'args': ['config', 'user.name', 'x']})
        assert refused.value.code == 400
        session.mode = 'run'
        with pytest.raises(HTTPError) as run_mode:
            post(endpoint, token, '/v1/git', {'args': ['status']})
        assert run_mode.value.code == 400


def test_pull_reloads_the_session_from_disk(tmp_path: Path) -> None:
    remote, mine, theirs = tmp_path / 'remote.git', tmp_path / 'mine', tmp_path / 'theirs'
    git(tmp_path, 'init', '-q', '--bare', '-b', 'main', str(remote))
    for clone in (mine, theirs):
        git(tmp_path, 'clone', '-q', str(remote), str(clone))
        git(clone, 'config', 'user.email', 'test@example.invalid')
        git(clone, 'config', 'user.name', 'Test')
    SheetDocument(name='Shared', cells=(CellDefinition('A1', 'input', '1', name='amount'),)).save(theirs / 'shared.workbook.py')
    git(theirs, 'add', '.'); git(theirs, 'commit', '-q', '-m', 'one'); git(theirs, 'push', '-q', 'origin', 'main')
    git(mine, 'pull', '-q', 'origin', 'main')
    with WorkbookSession.load(mine / 'shared.workbook.py') as session:
        endpoint, token = connection(session)
        before = post(endpoint, token, '/v1/session', {})
        SheetDocument(name='Shared', cells=(CellDefinition('A1', 'input', '42', name='amount'),)).save(theirs / 'shared.workbook.py')
        git(theirs, 'commit', '-q', '-am', 'two'); git(theirs, 'push', '-q', 'origin', 'main')
        pulled = post(endpoint, token, '/v1/git', {'args': ['pull', '--ff-only', 'origin', 'main']})
        assert pulled['code'] == 0, pulled
        after = post(endpoint, token, '/v1/session', {})
        assert int(str(after['revision'])) > int(str(before['revision']))
        document = after['document']
        assert isinstance(document, dict)
        assert [cell['source'] for cell in document['cells'] if cell['id'] == 'A1'] == ['42']
