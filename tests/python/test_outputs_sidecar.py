"""Saved outputs always live in companions beside workbooks."""

import shutil
import subprocess
from pathlib import Path

import pytest

from reaktiv_workbook.cli import main
from reaktiv_workbook.model import CellDefinition, SheetDocument
from reaktiv_workbook.outputs import outputs_path, write_outputs, read_outputs

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")


def git(folder: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=folder, capture_output=True, text=True, check=True).stdout


def workbook(path: Path) -> Path:
    SheetDocument(
        name="Budget",
        cells=(CellDefinition("A1", "input", "2", name="n"), CellDefinition("A2", "formula", "n * 21")),
    ).save(path)
    return path


def test_in_a_repository_the_outputs_go_into_an_ignored_sidecar(tmp_path):
    git(tmp_path, "init", "-q")
    (tmp_path / "notes").mkdir()
    path = workbook(tmp_path / "notes" / "budget.sheet.py")

    assert main([str(path), "--save", str(path), "--check"]) == 0
    assert "__snapshot__" not in path.read_text()  # the diff shows only what the user changed
    sidecar = outputs_path(path)
    assert sidecar == tmp_path / "notes" / "budget.sheet.py.snapshot.json"
    assert sidecar.is_file()
    # git does not see it, and nothing in the repository changed to make it so.
    assert git(tmp_path, "status", "--porcelain", "--untracked-files=all").split() == ["??", "notes/budget.sheet.py"]
    assert "*.py.snapshot.json" in (tmp_path / ".git" / "info" / "exclude").read_text()

    # Opening the file finds its outputs again.
    loaded = SheetDocument.load(path)
    assert {cell["id"]: cell["display"] for cell in loaded.snapshot["cells"]}["A2"] == "42"

    # Saving twice does not repeat the exclude line.
    main([str(path), "--save", str(path)])
    assert (tmp_path / ".git" / "info" / "exclude").read_text().count("*.py.snapshot.json") == 1


def test_outside_a_repository_the_outputs_use_a_companion(tmp_path):
    path = workbook(tmp_path / "budget.sheet.py")
    assert main([str(path), "--save", str(path)]) == 0
    assert "__snapshot__" not in path.read_text()
    assert outputs_path(path).is_file()
    assert SheetDocument.load(path).snapshot is not None
    assert main([str(path), "--save", str(path), "--no-snapshot"]) == 0
    assert not outputs_path(path).exists()


def test_a_broken_sidecar_is_ignored(tmp_path):
    path = workbook(tmp_path / "budget.sheet.py")
    outputs_path(path).parent.mkdir(parents=True, exist_ok=True)
    outputs_path(path).write_text("{not json")
    assert SheetDocument.load(path).snapshot is None


def test_companion_is_separate_from_serialized_source(tmp_path):
    from dataclasses import replace
    path = workbook(tmp_path / "budget.sheet.py")
    document = replace(SheetDocument.load(path), snapshot={"cells": [{"id": "A1", "display": "2"}]})
    assert "__snapshot__" not in document.dumps()
    assert SheetDocument.loads(document.dumps()).snapshot is None
    document.save(path)
    assert SheetDocument.load(path).snapshot == document.snapshot
    write_outputs(path, None)
    assert read_outputs(path) is None


def test_snapshot_preference_round_trips_and_disables_python_save(tmp_path):
    from dataclasses import replace
    doc = SheetDocument(cells=(CellDefinition("A1", "input", "42"),), save_outputs=False)
    assert doc.to_dict()["saveOutputs"] is False
    assert not SheetDocument.from_dict(doc.to_dict()).save_outputs
    assert not SheetDocument.loads(doc.dumps()).save_outputs
    assert "saveOutputs" not in replace(doc, save_outputs=True).to_dict()
    path = tmp_path / "source-only.sheet.py"
    sidecar = path.with_name(path.name + ".snapshot.json")
    sidecar.write_text('{}')
    replace(doc, snapshot={"cells": []}).save(path)
    assert not sidecar.exists()
    assert not SheetDocument.load(path).save_outputs


def test_cli_respects_workbook_snapshot_preference(tmp_path, monkeypatch):
    from reaktiv_workbook import cli
    source = tmp_path / "source.sheet.py"
    saved = tmp_path / "saved.sheet.py"
    SheetDocument(cells=(CellDefinition("A1", "input", "42"),), save_outputs=False).save(source)

    def forbidden(*args, **kwargs):
        raise AssertionError("Disabled output snapshot must not be built")

    monkeypatch.setattr(cli, "make_snapshot", forbidden)
    assert cli.main([str(source), "--save", str(saved), "--check"]) == 0
    assert not SheetDocument.load(saved).save_outputs
    assert not saved.with_name(saved.name + ".snapshot.json").exists()
