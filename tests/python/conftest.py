"""Shared test setup."""
import pytest


@pytest.fixture(autouse=True)
def private_configuration(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """Never read or write the user's configuration (e.g. the saved MCP pairing token)."""
    monkeypatch.setenv('REAKTIV_WORKBOOK_CONFIG_DIR', str(tmp_path_factory.mktemp('config')))
    monkeypatch.delenv('REAKTIV_WORKBOOK_MCP_TOKEN', raising=False)


@pytest.fixture
def served_editor(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """A stand-in for the built browser IDE, for sessions that serve their own editor
    (CI runs the Python tests without building the frontend)."""
    root = tmp_path_factory.mktemp('web')
    (root / 'index.html').write_text('<app-root></app-root>')
    monkeypatch.setattr('reaktiv_workbook.standalone.frontend_root', lambda: root)
