"""Git for workbooks opened with the CLI.

Runs the user's own ``git``, so SSH keys, credential helpers and signing work as in
the terminal. A narrow pipe: a fixed set of subcommands, no options that run other
programs or change where git works, and the workbook's folder as working directory.
Parsing (status, diff by cell) lives in the frontend (``git.service.ts``).
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
from typing import Sequence

# Subcommands the app may run.
SUBCOMMANDS = frozenset({
    "status", "diff", "show", "log", "add", "commit", "push", "pull", "rev-parse", "remote",
})
# Options that would run other programs or change where git works.
REFUSED_OPTIONS = (
    "-c", "--config-env", "--exec-path", "--upload-pack", "--receive-pack", "--exec",
    "--git-dir", "--work-tree", "--output",
)
# Network commands may wait on a slow remote, never forever.
TIMEOUT_SECONDS = 300


class GitRefused(ValueError):
    """The command is not one the app may run."""


def valid_arguments(args: Sequence[str]) -> None:
    """Raise :class:`GitRefused` unless ``args`` is an allowed git command."""
    if not args:
        raise GitRefused("No git command")
    if args[0] not in SUBCOMMANDS:
        raise GitRefused(f"git {args[0]} is not available here")
    for argument in args:
        if argument == "--":
            break  # paths follow
        if any(argument == option or argument.startswith(f"{option}=") for option in REFUSED_OPTIONS):
            raise GitRefused(f"The option {argument} is not available here")


def find_git() -> str | None:
    """git from ``PATH`` or the usual install locations."""
    found = shutil.which("git")
    if found:
        return found
    for folder in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
        candidate = Path(folder) / "git"
        if candidate.is_file():
            return str(candidate)
    return None


def run_git(folder: Path, args: Sequence[str]) -> dict[str, object]:
    """Run an allowed git command in ``folder``; returns code, stdout and stderr."""
    valid_arguments(args)
    git = find_git()
    if git is None:
        raise RuntimeError("git was not found. Install git to commit and push workbooks.")
    environment = {
        **os.environ,
        # Never wait for a password prompt nobody can answer: credentials come from
        # the user's helpers and SSH agent, as in the terminal.
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_OPTIONAL_LOCKS": "0",
    }
    try:
        completed = subprocess.run(
            [git, "-c", "core.quotepath=off", "-c", "color.ui=never", *args],
            cwd=folder, env=environment, capture_output=True, timeout=TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"git {args[0]} did not finish within {TIMEOUT_SECONDS} seconds") from error
    return {
        "code": completed.returncode,
        "stdout": completed.stdout.decode("utf-8", "replace"),
        "stderr": completed.stderr.decode("utf-8", "replace"),
    }
