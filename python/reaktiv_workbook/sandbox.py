"""Run a command in an isolated uv environment built from the workbook's packages.

``reaktiv-workbook edit FILE --sandbox`` restarts the same command through
``uv run --isolated --no-project``, so the workbook's declared packages are
installed into a cached environment of their own instead of the one that launched
the CLI (like ``marimo edit --sandbox``). The workbook distributions are installed
from wherever the running copies came from (editable checkout, local wheel or
index), so the sandbox runs the same versions. CPython only; imported lazily.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
from importlib.metadata import PackageNotFoundError, distribution
from typing import Any, Sequence, cast
from urllib.parse import unquote, urlparse

from .model import SheetDocument, read_script_metadata
from .narrowing import as_mapping

# One argument per requirement, and nothing that uv would read as an option.
_PYTHON_VERSION = re.compile(r"3(\.\d{1,2}){1,2}")


# After Ctrl+C, how long the child may take to stop on its own before the launcher
# forwards the interrupt (seconds).
_INTERRUPT_GRACE = 3.0


class SandboxError(RuntimeError):
    """The sandbox cannot be prepared (uv missing, invalid requirement, ...)."""


def find_uv() -> str | None:
    """uv from ``REAKTIV_UV`` or ``PATH``."""
    return os.environ.get("REAKTIV_UV") or shutil.which("uv")


def normalize_packages(packages: Sequence[str]) -> list[str]:
    """Trimmed, de-duplicated, sorted requirements; rejects option-like entries."""
    normalized: list[str] = []
    for package in (package.strip() for package in packages):
        if not package:
            continue
        if package.startswith("-") or "\n" in package or "\0" in package:
            raise SandboxError(f"Invalid package requirement: {package!r}")
        if package not in normalized:
            normalized.append(package)
    return sorted(normalized)


_DISTRIBUTION_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


def missing_packages(packages: Sequence[str]) -> list[str]:
    """Declared packages without an installed distribution here (names only, in order)."""
    missing: list[str] = []
    for package in packages:
        match = _DISTRIBUTION_NAME.match(package.strip())
        if match is None or match.group() in missing:
            continue
        try:
            distribution(match.group())
        except PackageNotFoundError:
            missing.append(match.group())
    return missing


def sandbox_python(document: SheetDocument | None) -> str:
    """The workbook's exact Python pin, else the launching interpreter's version.

    A range such as ``>=3.9`` could select an interpreter the workbook package does
    not support, so only exact pins (``==3.12``) are honoured.
    """
    pinned = document.python if document is not None else ""
    if pinned and _PYTHON_VERSION.fullmatch(pinned):
        return pinned
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def install_arguments(name: str) -> list[str]:
    """uv arguments that install distribution ``name`` from where it is installed now."""
    try:
        installed = distribution(name)
    except PackageNotFoundError as error:
        raise SandboxError(f"{name} is not installed") from error
    origin_text = installed.read_text("direct_url.json")
    if not origin_text:
        return ["--with", f"{name}=={installed.version}"]
    origin = as_mapping(json.loads(origin_text)) or {}
    url = str(origin.get("url", ""))
    if not url.startswith("file:"):
        # VCS or remote archive: reinstall from the same URL.
        vcs = as_mapping(origin.get("vcs_info"))
        if vcs is not None and vcs.get("commit_id"):
            return ["--with", f"{name} @ {vcs.get('vcs', 'git')}+{url}@{vcs['commit_id']}"]
        return ["--with", f"{name} @ {url}"]
    path = Path(unquote(urlparse(url).path)).resolve()
    if not path.exists():
        raise SandboxError(f"{name} was installed from {path}, which no longer exists")
    dir_info = as_mapping(origin.get("dir_info"))
    if dir_info is not None and dir_info.get("editable"):
        return ["--with-editable", str(path)]
    return ["--with", str(path)]


# Set in the sandboxed child process.
SANDBOXED = "REAKTIV_WORKBOOK_SANDBOXED"
# Where a sandboxed session writes its workbook when the editor asks to restart it.
HANDOFF = "REAKTIV_WORKBOOK_HANDOFF"
# The access token a restarted session keeps, so the browser stays attached.
SESSION_TOKEN = "REAKTIV_WORKBOOK_SESSION_TOKEN"


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stderr.isatty()


def offer_sandbox(file: Path) -> bool:
    """True to rerun sandboxed: the workbook declares packages missing here, and the user,
    asked in a terminal with uv available, agrees. Otherwise names what is missing."""
    if os.environ.get(SANDBOXED) or not file.is_file():
        return False
    missing = missing_packages(declared_packages(file, SheetDocument.load(file)))
    if not missing:
        return False
    names = " ".join(missing)
    print(f"{file.name} uses packages that are not installed here: {names}", file=sys.stderr, flush=True)
    if find_uv() is not None and interactive():
        try:
            answer = input("Run it in a sandbox with its packages (uv installs them)? [Y/n] ")
        except EOFError:
            answer = "n"
        if answer.strip().lower() in ("", "y", "yes"):
            return True
    print(f"  Install them (pip install {names}), or add --sandbox to run it in an environment\n"
          "  with its packages (needs uv).", file=sys.stderr, flush=True)
    return False


_OWN_DISTRIBUTIONS = frozenset({"reaktiv", "reaktiv-workbook"})


def declared_packages(file: Path, document: SheetDocument) -> list[str]:
    """What the workbook needs besides reaktiv: its PEP 723 dependencies (numpy included when
    its code imports it), else the document's packages."""
    metadata = read_script_metadata(file.read_text(encoding="utf-8"))
    dependencies = metadata.get("dependencies") if metadata is not None else None
    if not isinstance(dependencies, list):
        return list(document.packages)
    # Anything else is kept, so option-like entries reach `normalize_packages` and are refused.
    return [dependency for dependency in cast(list[Any], dependencies) if isinstance(dependency, str)
            and ((match := _DISTRIBUTION_NAME.match(dependency.strip())) is None
                 or match.group().lower().replace("_", "-") not in _OWN_DISTRIBUTIONS)]


def sandbox_command(uv: str, file: Path, child_arguments: Sequence[str]) -> list[str]:
    """The ``uv run`` command that runs ``reaktiv-workbook <child_arguments>`` sandboxed."""
    document: SheetDocument | None = None
    if file.is_file():
        document = SheetDocument.load(file)
    packages = normalize_packages(declared_packages(file, document) if document is not None else ())
    command = [uv, "run", "--isolated", "--no-project", "--python", sandbox_python(document)]
    command += install_arguments("reaktiv-workbook")
    command += install_arguments("reaktiv")
    for package in packages:
        command += ["--with", package]
    return [*command, "--", "reaktiv-workbook", *child_arguments]


def _free_port(host: str) -> int:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.bind((host, 0))
        return int(probe.getsockname()[1])


def _pin_port(arguments: list[str]) -> list[str]:
    """A restarted session must keep its address: choose the free port once, here."""
    if "--port" not in arguments:
        return arguments
    index = arguments.index("--port") + 1
    if arguments[index] != "0":
        return arguments
    host = arguments[arguments.index("--host") + 1] if "--host" in arguments else "127.0.0.1"
    return [*arguments[:index], str(_free_port(host)), *arguments[index + 1:]]


def _wait(child: subprocess.Popen[bytes]) -> int:
    """The child's exit code. On Ctrl+C the child normally receives the same signal from the
    terminal and shuts down on its own; if it is still running shortly afterwards (SIGINT
    was sent to this process only), it is forwarded."""
    while True:
        try:
            return child.wait()
        except KeyboardInterrupt:
            try:
                return child.wait(timeout=_INTERRUPT_GRACE)
            except subprocess.TimeoutExpired:
                child.send_signal(signal.SIGINT)
            except KeyboardInterrupt:
                continue


def run_sandboxed(file: Path, child_arguments: Sequence[str], *, resume: Path | None = None,
                  token: str | None = None) -> int:
    """Run the command sandboxed and return its exit code.

    An editor session can ask to restart with its workbook's packages: it writes the workbook
    (unsaved edits included) to the handoff file and exits with ``RESTART_EXIT``; the session
    then starts again in a sandbox built for that file, on the same address with the same
    access token, so the browser reconnects. ``resume``/``token`` continue a session that
    was not sandboxed yet. Forwards SIGTERM; stopping the launcher never orphans a server.
    """
    from .standalone import RESTART_EXIT
    uv = find_uv()
    if uv is None:
        raise SandboxError("--sandbox requires uv: https://docs.astral.sh/uv/getting-started/installation/")
    arguments = _pin_port(list(child_arguments))
    token = token or secrets.token_urlsafe(32)
    folder = Path(tempfile.mkdtemp(prefix="reaktiv-workbook-"))
    handoff = folder / "restart.workbook.py"
    child: subprocess.Popen[bytes] | None = None
    previous = None
    if hasattr(signal, "SIGTERM"):
        def forward(signum: int, _frame: Any) -> None:
            if child is not None:
                child.send_signal(signum)

        previous = signal.signal(signal.SIGTERM, forward)
    try:
        while True:
            source = file if resume is None else resume
            command = sandbox_command(uv, source, [*arguments, *(["--resume", str(resume)] if resume else [])])
            environment = {key: value for key, value in os.environ.items()
                           if key not in ("VIRTUAL_ENV", "UV_PROJECT_ENVIRONMENT")}
            environment[SANDBOXED] = "1"  # the child has the packages: it never offers a sandbox again
            environment[HANDOFF] = str(handoff)
            environment[SESSION_TOKEN] = token
            print(f"Preparing sandbox for {file} (uv caches it for later runs)…", file=sys.stderr, flush=True)
            child = subprocess.Popen(command, env=environment)
            code = _wait(child)
            if code != RESTART_EXIT or not handoff.is_file():
                return code
            # Restart: the next session starts from the handed-over workbook; the browser
            # tab is still open, so no new one.
            resume = folder / "resume.workbook.py"
            handoff.replace(resume)
            if "--headless" not in arguments:
                arguments.append("--headless")
            print("Restarting with the workbook's packages…", file=sys.stderr, flush=True)
    finally:
        if previous is not None:
            signal.signal(signal.SIGTERM, previous)
        shutil.rmtree(folder, ignore_errors=True)
