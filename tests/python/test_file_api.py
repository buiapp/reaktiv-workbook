"""The file worker uses the production writer without importing workbook code."""
import json
from pathlib import Path
import subprocess
import sys

from reaktiv_workbook.file_api import serialize_document
from reaktiv_workbook.model import SheetDocument, verify_written_document


def document():
    return {
        "format": "reaktiv-workbook", "version": 4, "name": "Commands", "grid": {"columns": 10, "rows": 16},
        "environment": {"packages": ["package_that_is_not_installed"], "imports": ["import package_that_is_not_installed"], "code": "raise RuntimeError('must not run')"},
        "cells": [
            {"id": "A1", "kind": "input", "source": "1", "name": "pulse_signal"},
            {"id": "PLC!B6", "kind": "input", "source": "2", "name": "pulse_signal"},
        ],
        "sheets": [{"name": "PLC", "grid": {"columns": 10, "rows": 16}}],
        "actions": [{"name": "capture", "source": "def capture(self):\n    self.plc_b6.set(42)\n    raise RuntimeError('must not run')", "references": {"plc_b6": "PLC!B6"}}],
        "snapshot": {"savedAt": "2026-10-19", "cells": [], "dependencies": {}},
    }


def test_static_serialization_preserves_action_targets_and_never_runs_code():
    doc = document()
    result = serialize_document(doc)
    assert result["problems"] == []
    assert verify_written_document(result["source"], doc) == []
    loaded = SheetDocument.loads(result["source"])
    assert loaded.snapshot is None
    assert loaded.actions[0].references == {"PLC.pulse_signal": "PLC!B6"}
    assert "self.PLC.pulse_signal.set(42)" in loaded.actions[0].source


def test_serialization_reports_code_errors_before_returning_a_saveable_file():
    doc = document()
    doc["cells"][0]["kind"] = "formula"
    doc["cells"][0]["source"] = "if True:"
    result = serialize_document(doc)
    assert result["problems"]
    assert "A1" in "\n".join(result["problems"])


def test_file_package_has_no_runtime_or_third_party_dependencies():
    root = Path(__file__).parents[2] / "python" / "reaktiv_workbook"
    script = '''
import sys, types, json
package = types.ModuleType('reaktiv_workbook_files')
package.__path__ = [sys.argv[1]]
sys.modules['reaktiv_workbook_files'] = package
from reaktiv_workbook_files.file_api import serialize_document_json
result = json.loads(serialize_document_json(sys.stdin.read()))
assert result['problems'] == [], result
assert not {'numpy', 'reaktiv', 'reaktiv_workbook.workbook'} & sys.modules.keys()
'''
    subprocess.run([sys.executable, "-S", "-c", script, str(root)], input=json.dumps(document()), text=True, check=True)


def test_generated_file_is_written_and_parsed_once(monkeypatch):
    original_dump, original_load = SheetDocument.dumps, SheetDocument.loads
    calls = {"write": 0, "read": 0}

    def dump(self, **kwargs):
        calls["write"] += 1
        return original_dump(self, **kwargs)

    def load(source):
        calls["read"] += 1
        return original_load(source)

    monkeypatch.setattr(SheetDocument, "dumps", dump)
    monkeypatch.setattr(SheetDocument, "loads", load)
    assert serialize_document(document())["problems"] == []
    assert calls == {"write": 1, "read": 1}


def test_invalid_generated_python_still_blocks_save(monkeypatch):
    monkeypatch.setattr(SheetDocument, "dumps", lambda self: "class Broken(:")
    result = serialize_document(document())
    assert result["problems"]
    assert "The file would not load" in result["problems"][0]


def test_static_writer_matches_independent_verifier_for_all_fixtures():
    fixtures = Path(__file__).parents[1] / "fixtures" / "workbooks" / "cases.json"
    for case in json.loads(fixtures.read_text())["cases"]:
        doc = {**document(), "actions": [], "sheets": [], **case,
               "environment": {"packages": [], "imports": case.get("imports", []), "code": case.get("code", "")}}
        result = serialize_document(doc)
        assert result["problems"] == [], (case["name"], result["problems"])
        assert verify_written_document(result["source"], doc) == [], case["name"]


def test_action_diagnostics_locate_parse_and_compile_errors_without_executing_methods():
    for source, expected in (
        ("def capture(self):\n    if True", "expected ':'"),
        ("def capture(self):\n    await missing()", "'await' outside async"),
        ("def capture(self, limit=expensive()):\n    pass", "literal Python values"),
    ):
        doc = document()
        doc['actions'][0]['source'] = source
        result = serialize_document(doc)
        assert not result['source']
        message = '\n'.join(result['problems'])
        assert 'Action capture' in message
        assert expected in message
        assert 'Fix this method in Actions' in message
        if 'await' in source or 'if True' in source:
            assert 'line 2' in message
            assert '> 2:' in message


def test_static_serialization_preserves_small_cell_zoom():
    for zoom in (0.1, 0.25, 0.49, 0.5, 2):
        doc = document()
        doc["layout"] = {"zoom": zoom}
        result = serialize_document(doc)
        assert result["problems"] == []
        assert SheetDocument.loads(result["source"]).zoom == zoom
        assert verify_written_document(result["source"], doc) == []


def test_static_serialization_rejects_zoom_below_ten_percent():
    doc = document()
    doc["layout"] = {"zoom": 0.09}
    result = serialize_document(doc)
    assert result["problems"]


def test_inspection_reports_python_source_version_without_executing_user_code():
    from reaktiv_workbook.file_api import inspect_document
    legacy = Path(__file__).parents[1] / 'fixtures/workbooks/legacy/model-actions.app.sheet.py'
    source = legacy.read_text()
    parsed = inspect_document(source)
    assert parsed['version'] == 4  # JSON schema is separate from Python syntax.
    assert parsed['sourceFormatVersion'] == 1
    updated = serialize_document(parsed)
    assert updated['problems'] == []
    assert inspect_document(updated['source'])['sourceFormatVersion'] == 2
    assert legacy.read_text() == source
