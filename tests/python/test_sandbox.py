"""`--sandbox`: commands run through `uv run` with the workbook's declared packages."""
import json
import os
from pathlib import Path
import re
import stat
import sys

import pytest
from reaktiv_workbook import CellDefinition, SheetDocument
from reaktiv_workbook.commands import build_parser, command_main, sandbox_arguments
from reaktiv_workbook import sandbox
from reaktiv_workbook.sandbox import SandboxError, normalize_packages, sandbox_command


@pytest.fixture
def workbook(tmp_path: Path) -> Path:
    path = tmp_path / "declared.sheet.py"
    SheetDocument(name="Declared", packages=("schemdraw", "pandas>=2", " pandas>=2 "),
                  cells=(CellDefinition("A1", "formula", "1 + 1", name="two"),)).save(path)
    return path


@pytest.fixture
def fake_uv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A `uv` that records its arguments and exits with the code in FAKE_UV_EXIT."""
    record = tmp_path / "uv-arguments.json"
    script = tmp_path / "uv"
    script.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        f"open({str(record)!r}, 'w').write(json.dumps(sys.argv[1:]))\n"
        "raise SystemExit(int(os.environ.get('FAKE_UV_EXIT', '0')))\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("REAKTIV_UV", str(script))
    return record


def test_command_installs_declared_packages_and_this_workbook(workbook: Path) -> None:
    command = sandbox_command("uv", workbook, ["check", str(workbook)])

    assert command[:4] == ["uv", "run", "--isolated", "--no-project"]
    assert command[command.index("--python") + 1] == f"{sys.version_info.major}.{sys.version_info.minor}"
    separator = command.index("--")
    assert command[separator:] == ["--", "reaktiv-workbook", "check", str(workbook)]
    options = command[:separator]
    # Declared packages, trimmed and de-duplicated; base packages are not repeated.
    packages = [options[i + 1] for i, value in enumerate(options) if value == "--with"]
    assert "schemdraw" in packages and packages.count("pandas>=2") == 1
    assert "numpy" not in packages
    # The workbook and reaktiv come from where the running copies were installed.
    assert any(value in ("--with", "--with-editable") for value in options[4:])
    assert any(value.startswith("reaktiv") or Path(value).exists() for value in options)


def test_exact_python_pin_is_used_and_ranges_fall_back_to_the_launcher(workbook: Path) -> None:
    launcher = f"{sys.version_info.major}.{sys.version_info.minor}"
    assert sandbox.sandbox_python(SheetDocument(name="x", python="3.11")) == "3.11"
    # A header range such as ">=3.9" is not a pin: the document keeps no version.
    source = re.sub(r'(?m)^# requires-python = .*$', '# requires-python = ">=3.9"', workbook.read_text())
    ranged = SheetDocument.loads(source)
    assert ranged.python == ""
    assert sandbox.sandbox_python(ranged) == launcher
    assert sandbox.sandbox_python(None) == launcher


def test_option_like_requirements_are_rejected() -> None:
    assert normalize_packages([" b ", "a", "", "a"]) == ["a", "b"]
    for bad in ("--index-url=https://example.invalid", "-e .", "pandas\n--extra"):
        with pytest.raises(SandboxError, match="Invalid package requirement"):
            normalize_packages([bad])


def test_install_origin_uses_editable_checkout_or_wheel_or_version(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    wheel = tmp_path / "reaktiv-0.25.0-py3-none-any.whl"
    wheel.write_bytes(b"")

    class Installed:
        version = "0.25.0"

        def __init__(self, origin: object) -> None:
            self.origin = origin

        def read_text(self, name: str) -> str | None:
            return None if self.origin is None else json.dumps(self.origin)

    cases = {
        None: ["--with", "reaktiv==0.25.0"],
        "editable": ["--with-editable", str(tmp_path)],
        "wheel": ["--with", str(wheel)],
    }
    origins = {
        None: None,
        "editable": {"url": tmp_path.as_uri(), "dir_info": {"editable": True}},
        "wheel": {"url": wheel.as_uri(), "archive_info": {}},
    }
    for case, expected in cases.items():
        monkeypatch.setattr(sandbox, "distribution", lambda name, origin=origins[case]: Installed(origin))
        assert sandbox.install_arguments("reaktiv") == expected
    missing = {"url": (tmp_path / "gone.whl").as_uri(), "archive_info": {}}
    monkeypatch.setattr(sandbox, "distribution", lambda name: Installed(missing))
    with pytest.raises(SandboxError, match="no longer exists"):
        sandbox.install_arguments("reaktiv")


@pytest.mark.parametrize(("arguments", "expected"), [
    (["check", "w.sheet.py", "--sandbox"], ["check", "w.sheet.py"]),
    (["export", "w.sheet.py", "out", "--sandbox"], ["export", "w.sheet.py", "out"]),
    (["edit", "w.sheet.py", "--sandbox", "--headless", "--port", "8123"],
     ["edit", "w.sheet.py", "--port", "8123", "--host", "127.0.0.1", "--headless"]),
    (["run", "w.sheet.py", "--sandbox", "--host", "::1"], ["run", "w.sheet.py", "--port", "0", "--host", "::1"]),
])
def test_child_command_is_rebuilt_without_sandbox(arguments: list[str], expected: list[str]) -> None:
    assert sandbox_arguments(build_parser().parse_args(arguments)) == expected


def test_sandboxed_command_returns_the_child_exit_code(workbook: Path, fake_uv: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_UV_EXIT", "1")
    monkeypatch.setenv("VIRTUAL_ENV", "/outer/venv")
    assert command_main(["check", str(workbook), "--sandbox"]) == 1
    recorded = json.loads(fake_uv.read_text())
    assert recorded[:3] == ["run", "--isolated", "--no-project"]
    assert recorded[recorded.index("--"):] == ["--", "reaktiv-workbook", "check", str(workbook)]


def test_missing_uv_and_invalid_requirements_fail_before_running(
        tmp_path: Path, workbook: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.delenv("REAKTIV_UV", raising=False)
    monkeypatch.setattr(sandbox.shutil, "which", lambda name: None)
    assert command_main(["check", str(workbook), "--sandbox"]) == 2
    assert "requires uv" in capsys.readouterr().err

    hostile = tmp_path / "hostile.sheet.py"
    SheetDocument(name="Hostile", packages=("--index-url=https://example.invalid",)).save(hostile)
    monkeypatch.setenv("REAKTIV_UV", os.devnull)
    assert command_main(["check", str(hostile), "--sandbox"]) == 2
    assert "Invalid package requirement" in capsys.readouterr().err


@pytest.mark.parametrize("arguments", [["evaluate", "{file}", "--sandbox"], ["{file}", "--sandbox"]])
def test_evaluate_forms_reject_sandbox_instead_of_ignoring_it(arguments: list[str], workbook: Path) -> None:
    with pytest.raises(SystemExit) as raised:
        command_main([value.format(file=workbook) for value in arguments])
    assert raised.value.code == 2


def test_sandbox_installs_the_declared_packages_including_numpy(tmp_path: Path) -> None:
    def packages(file: Path) -> list[str]:
        command = sandbox_command("uv", file, ["edit", str(file)])
        options = command[:command.index("--")]
        return [options[i + 1] for i, value in enumerate(options) if value == "--with"]

    uses_numpy = tmp_path / "arrays.workbook.py"
    SheetDocument(name="arrays", packages=("pandas>=2",), cells=(
        CellDefinition("A1", "formula", "np.arange(3)", name="values"),)).save(uses_numpy)
    assert '"numpy",' in uses_numpy.read_text()
    assert {"numpy", "pandas>=2"} <= set(packages(uses_numpy))
    plain = tmp_path / "plain.workbook.py"
    SheetDocument(name="plain", cells=(CellDefinition("A1", "formula", "1 + 1", name="two"),)).save(plain)
    assert "numpy" not in plain.read_text()
    assert not any(value.startswith(("numpy", "mcp")) for value in packages(plain))


def test_an_editor_session_restarts_in_a_sandbox_with_its_packages(
        workbook: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The first child (the editor session) hands over its workbook with a new package and asks
    to restart; the launcher starts the next one sandboxed for that workbook, on the same port
    with the same token, without opening another browser tab."""
    record = tmp_path / "uv-calls.jsonl"
    script = tmp_path / "uv"
    script.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "from reaktiv_workbook import SheetDocument\n"
        f"calls = open({str(record)!r}, 'a+')\n"
        "calls.seek(0); first = not calls.read()\n"
        "calls.write(json.dumps({'args': sys.argv[1:], 'token': os.environ['REAKTIV_WORKBOOK_SESSION_TOKEN']}) + '\\n')\n"
        "calls.close()\n"
        "if first:\n"
        "    SheetDocument(name='Declared', packages=('tabulate',)).save(os.environ['REAKTIV_WORKBOOK_HANDOFF'])\n"
        "    raise SystemExit(75)\n"
        "raise SystemExit(0)\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("REAKTIV_UV", str(script))
    assert sandbox.run_sandboxed(workbook, ["edit", str(workbook), "--port", "0", "--host", "127.0.0.1"]) == 0
    first, second = [json.loads(line) for line in record.read_text().splitlines()]
    assert first["token"] == second["token"]
    child = lambda call: call["args"][call["args"].index("--") + 1:]  # noqa: E731
    port = child(first)[child(first).index("--port") + 1]
    assert port != "0" and child(second)[child(second).index("--port") + 1] == port
    assert "--headless" not in child(first) and "--headless" in child(second)
    assert "--resume" not in child(first) and child(second)[child(second).index("--resume") + 1].endswith("resume.workbook.py")
    assert "tabulate" in second["args"] and "pandas>=2" not in second["args"]  # the handed-over packages


def test_the_session_restart_request_hands_over_the_editor_workbook(workbook: Path) -> None:
    from reaktiv_workbook.session import WorkbookSession
    with WorkbookSession(workbook) as session:
        received: list[SheetDocument] = []
        with pytest.raises(RuntimeError, match="restart this script yourself"):
            session._runtime.dispatch("/v1/session-restart", {"document": session.document.to_dict()})
        session.restart = received.append
        edited = SheetDocument(name="Declared", packages=("tabulate",),
                               cells=(CellDefinition("A1", "formula", "2 + 2", name="four"),))
        assert session._runtime.dispatch("/v1/session-restart", {"document": edited.to_dict()}) == {"restarting": True}
        assert received[0].packages == ("tabulate",) and received[0].cells[0].source == "2 + 2"
        environment = session.state()["environment"]
        assert environment["missing"] == ["schemdraw"] or "schemdraw" in environment["missing"]
        assert environment["sandboxed"] is False
