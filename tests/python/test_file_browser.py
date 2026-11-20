"""The CLI session's folder listing behind the file/folder picker."""
import ast
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

import pytest
from reaktiv_workbook import CellDefinition, SheetDocument, WorkbookSession
from reaktiv_workbook import file_browser
from reaktiv_workbook.file_browser import list_directory


def connection(session: WorkbookSession) -> tuple[str, str]:
    parts = urlsplit(session.open_editor('http://127.0.0.1:4200/', open_browser=False))
    return parse_qs(parts.query)['session'][0], parse_qs(parts.fragment)['token'][0]


def post(endpoint: str, token: str | None, route: str, payload: dict[str, object]) -> dict[str, object]:
    headers = {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})}
    with urlopen(Request(endpoint + route, data=json.dumps(payload).encode(), headers=headers), timeout=10) as response:
        result: dict[str, object] = json.load(response)
        return result


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    (tmp_path / 'data').mkdir()
    (tmp_path / 'data' / 'secret.csv').write_text('a,b\n1,2\n')
    (tmp_path / '.hidden').write_text('x')
    (tmp_path / 'Notes.txt').write_text('notes')
    SheetDocument(name='Picker', cells=(CellDefinition('A1', 'input', '"data/secret.csv"', name='source'),)).save(
        tmp_path / 'picker.workbook.py')
    return tmp_path


def test_lists_names_and_kinds_folders_first_without_reading_files(folder: Path) -> None:
    listing = list_directory({}, folder)
    assert listing['path'] == str(folder.resolve())
    assert listing['parent'] == str(folder.resolve().parent)
    names = [(entry['name'], entry['kind']) for entry in listing['entries']]
    assert names == [('data', 'folder'), ('Notes.txt', 'file'), ('picker.workbook.py', 'file')]
    assert 'a,b' not in json.dumps(list_directory({'path': 'data'}, folder))
    assert listing['truncated'] is False


def test_file_paths_list_their_folder_and_hidden_entries_are_opt_in(folder: Path) -> None:
    listing = list_directory({'path': str(folder / 'data' / 'secret.csv')}, folder)
    assert listing['path'] == str((folder / 'data').resolve())
    assert [entry['name'] for entry in listing['entries']] == ['secret.csv']
    hidden = list_directory({'hidden': True}, folder)
    assert '.hidden' in [entry['name'] for entry in hidden['entries']]
    with pytest.raises(ValueError, match='Not a folder'):
        list_directory({'path': str(folder / 'missing')}, folder)
    with pytest.raises(TypeError):
        list_directory({'path': 3}, folder)


def test_large_folders_are_cut_short(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_browser, 'MAX_ENTRIES', 2)
    listing = list_directory({}, folder)
    assert len(listing['entries']) == 2 and listing['truncated'] is True


def test_session_api_lists_the_workbook_folder_also_in_run_mode_and_requires_the_token(folder: Path) -> None:
    with WorkbookSession.load(folder / 'picker.workbook.py') as session:
        endpoint, token = connection(session)
        listing = post(endpoint, token, '/v1/files', {})
        assert listing['path'] == str(folder.resolve())
        with pytest.raises(HTTPError) as error:
            post(endpoint, None, '/v1/files', {})
        assert error.value.code == 401
        session.mode = 'run'  # path widgets are input controls in app mode too
        assert post(endpoint, token, '/v1/files', {'path': 'data'})['entries']


def test_a_root_confines_listings_and_resolves_links_and_parents_first(folder: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    outside = tmp_path_factory.mktemp('outside')
    (folder / 'escape').symlink_to(outside, target_is_directory=True)
    listing = list_directory({}, folder, folder)
    assert listing['parent'] is None and listing['home'] == str(folder.resolve())
    assert list_directory({'path': 'data'}, folder, folder)['parent'] == str(folder.resolve())
    for path in ('..', str(outside), 'escape', 'data/../..', '~'):
        with pytest.raises(PermissionError, match="workbook's folder"):
            list_directory({'path': path}, folder, folder)


def test_a_network_session_keeps_the_picker_and_path_inputs_in_the_workbook_folder(folder: Path) -> None:
    path = folder / 'picker.workbook.py'
    SheetDocument(name='Picker', cells=(
        CellDefinition('A1', 'input', '"data/secret.csv"', name='source', view={'widget': {'type': 'file'}}),
        CellDefinition('A2', 'input', '"free text"', name='note'),
    )).save(path)
    with WorkbookSession.load(path) as session:
        parts = urlsplit(session.open_editor(host='0.0.0.0', open_browser=False, allow_remote=True))
        endpoint, token = f'http://127.0.0.1:{parts.port}', parse_qs(parts.fragment)['token'][0]
        session.mode = 'run'
        assert post(endpoint, token, '/v1/files', {'path': 'data'})['entries']
        for request in (('/v1/files', {'path': '/'}), ('/v1/set-inputs', {'sources': {'A1': '"/etc/passwd"'}}),
                        ('/v1/set-inputs', {'sources': {'A1': '"../outside.csv"'}})):
            with pytest.raises(HTTPError) as refused:
                post(endpoint, token, *request)
            assert refused.value.code == 403
        assert session.document.cells[0].source == '"data/secret.csv"'
        post(endpoint, token, '/v1/set-inputs', {'sources': {'A1': '"Notes.txt"', 'A2': '"/etc/passwd"'}})
        # Other inputs are ordinary values; only file and folder inputs are paths.
        assert [ast.literal_eval(cell.source) for cell in session.document.cells] == ['Notes.txt', '/etc/passwd']
