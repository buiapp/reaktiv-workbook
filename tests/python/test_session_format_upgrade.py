"""Like marimo, a CLI session upgrades an older-format workbook in place when it is saved."""
import json
from pathlib import Path
import shutil
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

from reaktiv_workbook import SheetDocument, WorkbookSession

LEGACY = Path(__file__).parents[1] / 'fixtures/workbooks/legacy/coordinates.app.sheet.py'


def post(endpoint: str, token: str, route: str, payload: dict[str, object]) -> dict[str, object]:
    request = Request(endpoint + route, data=json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=30) as response:
        result: dict[str, object] = json.load(response)
        return result


def test_saving_a_format_1_workbook_upgrades_the_same_file(tmp_path: Path) -> None:
    path = tmp_path / 'budget.sheet.py'
    shutil.copy(LEGACY, path)
    before = SheetDocument.load(path)
    with WorkbookSession.load(path) as session:
        parts = urlsplit(session.open_editor('http://127.0.0.1:4200/', open_browser=False))
        endpoint, token = parse_qs(parts.query)['session'][0], parse_qs(parts.fragment)['token'][0]
        state = post(endpoint, token, '/v1/session', {})
        document = state['document']
        assert isinstance(document, dict) and document['sourceFormatVersion'] == 1
        saved = post(endpoint, token, '/v1/session-save', {'document': document, 'sessionRevision': state['revision']})
        saved_document = saved['document']
        assert isinstance(saved_document, dict) and saved_document['sourceFormatVersion'] == 2
        assert saved['path'] == str(path.resolve())
    assert '@workbook_config(' in path.read_text()
    assert sorted(path.parent.iterdir()) == [path] or all(p == path or p.name.endswith('.snapshot.json') for p in path.parent.iterdir())
    assert SheetDocument.load(path).cells == before.cells
