"""Passive editor intelligence. The virtual module is analyzed, never executed."""

from __future__ import annotations

import ast
from dataclasses import replace
import importlib.util
import json
import os
import re
from pathlib import Path
from queue import Queue, Empty
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from threading import Lock, Thread
from typing import Any, Mapping

from .analysis_document import analysis_document
from .model import SheetDocument
from .narrowing import as_list, as_mapping
from .sheets import split_cell_id
from .typecheck import PYRIGHT_VERSION


def virtual_source(document: SheetDocument, sheet: str, source: str) -> tuple[str, int]:
    """Alias typed model members into the editor's sheet scope, then append raw code.

    No rewriting of the dirty buffer: incomplete Python and UTF-16 cursor positions
    survive unchanged. Namespace properties expose values rather than signal wrappers.
    """
    sheet = sheet or document.sheet_name
    generated = replace(analysis_document(document), snapshot=None).dumps()
    module = ast.parse(generated)
    model = next(
        node
        for node in module.body
        if isinstance(node, ast.ClassDef)
        and any(
            isinstance(base, ast.Name) and base.id == "Workbook"
            for base in node.bases
        )
    )
    from .workbook_format import workbook_member_names
    members = workbook_member_names(document.cells, document.sheet_name)
    lines = [
        generated.rstrip(),
        "",
        "from reaktiv_workbook.html_output import HTML",
        "from reaktiv_workbook.resample import resampled",
        f"_reaktiv_editor_book = {model.name}()",
    ]
    aliases: list[str] = []
    for index, sheet_name in enumerate(document.sheet_names):
        lines.extend(["", f"class _ReaktivEditorSheet{index}:"])
        properties = 0
        for cell in document.cells:
            prefix, coordinate = split_cell_id(cell.id)
            if (prefix or document.sheet_name) != sheet_name or cell.id not in members:
                continue
            read = f"_reaktiv_editor_book.{members[cell.id]}" + (
                ".value()" if cell.kind == "resource" else "()"
            )
            for name in dict.fromkeys(
                [coordinate, *([cell.name] if cell.name else [])]
            ):
                lines.extend(
                    [
                        "    @property",
                        f"    def {name}(self):",
                        f"        return {read}",
                    ]
                )
                properties += 1
                if sheet_name == sheet:
                    aliases.append(f"    {name} = {read}")
        if not properties:
            lines.append("    pass")
        aliases.append(f"    {sheet_name} = _ReaktivEditorSheet{index}()")
    lines.append("from reaktiv_workbook import CellRef")
    for index, sheet_name in enumerate(document.sheet_names):
        lines.extend(["", f"class _ReaktivEditorRefs{index}:"])
        count = 0
        for cell in document.cells:
            prefix, coordinate = split_cell_id(cell.id)
            if (
                (prefix or document.sheet_name) != sheet_name
                or cell.id not in members
                or cell.kind == "effect"
            ):
                continue
            signal = f"_reaktiv_editor_book.{members[cell.id]}"
            read = signal + ".value" if cell.kind == "resource" else signal
            write = ", " + signal + ".set" if cell.kind in ("input", "linked") else ""
            for name in dict.fromkeys(
                [coordinate, *([cell.name] if cell.name else [])]
            ):
                lines.extend(
                    [
                        "    @property",
                        f"    def {name}(self):",
                        f"        return CellRef({read}{write})",
                    ]
                )
                count += 1
        if not count:
            lines.append("    pass")
    current = document.sheet_names.index(sheet)
    lines.extend(["", f"class _ReaktivEditorCells(_ReaktivEditorRefs{current}):"])
    lines.extend(
        [
            "    def batch(self):",
            "        from reaktiv import batch",
            "        return batch()",
        ]
    )
    for index, sheet_name in enumerate(document.sheet_names):
        lines.extend(
            [
                "    @property",
                f"    def {sheet_name}(self):",
                f"        return _ReaktivEditorRefs{index}()",
            ]
        )
    aliases.append("    cells = _ReaktivEditorCells()")
    if re.match(r"\s*(?:async\s+)?def\s+\w+\s*\(\s*self\b", source):
        # Analyze a method in its native model context. Incomplete buffers remain
        # untouched and inherit typed cell handles and other action signatures.
        lines.extend([
            "", f"class _ReaktivEditorAction({model.name}):",
            "    @property", "    def cells(self):", "        return _ReaktivEditorCells()",
        ])
    else:
        lines.extend(["", "def __reaktiv_editor():", *aliases])
    offset = len("\n".join(lines).splitlines())
    # Every raw source line gets exactly four spaces, including a final empty line.
    return "\n".join(lines) + "\n" + "\n".join(
        "    " + line for line in source.split("\n")
    ) + "\n", offset


def language_server_command() -> list[str] | None:
    explicit = os.environ.get("REAKTIV_PYRIGHT_LANGSERVER")
    if explicit:
        import shlex

        return shlex.split(explicit)
    if importlib.util.find_spec("pyright") is not None:
        return [
            sys.executable,
            "-c",
            "from pyright.langserver import entrypoint; entrypoint()",
            "--stdio",
        ]
    uv = os.environ.get("REAKTIV_UV") or shutil.which("uv")
    if uv:
        return [
            uv,
            "tool",
            "run",
            "--quiet",
            "--from",
            f"pyright[nodejs]=={PYRIGHT_VERSION}",
            "pyright-langserver",
            "--stdio",
        ]
    executable = shutil.which("pyright-langserver")
    return [executable, "--stdio"] if executable else None


class EditorService:
    """One lazy, persistent Pyright process per HTTP kernel; independent of cell execution."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._write_lock = Lock()
        self._process: subprocess.Popen[bytes] | None = None
        self._folder: tempfile.TemporaryDirectory[str] | None = None
        self._responses: Queue[Mapping[str, Any]] = Queue()
        self._sequence = 0
        self._version = 0
        self._uri = ""
        self._text = ""
        self._items: dict[str, Mapping[str, Any]] = {}
        self._retry_after = 0.0
        self._context: tuple[SheetDocument, str, bool] | None = None
        self._prefix = ""
        self._offset = 0
        self._model_name = ""

    def _write(self, message: Mapping[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise OSError("Language server is unavailable")
        content = json.dumps({"jsonrpc": "2.0", **message}).encode("utf-8")
        with self._write_lock:
            process.stdin.write(
                f"Content-Length: {len(content)}\r\n\r\n".encode() + content
            )
            process.stdin.flush()

    def _read(
        self, process: subprocess.Popen[bytes], responses: Queue[Mapping[str, Any]]
    ) -> None:
        stream = process.stdout
        if stream is None:
            return
        try:
            while True:
                length = 0
                while (line := stream.readline()) not in (b"\r\n", b"\n", b""):
                    if line.lower().startswith(b"content-length:"):
                        length = int(line.split(b":", 1)[1])
                if not line or not length:
                    break
                message = as_mapping(json.loads(stream.read(length)))
                if message is None:
                    continue
                if "method" in message and "id" in message:
                    # No dynamic registrations or configuration callbacks are needed:
                    # configuration is pushed in initialized/didChangeConfiguration.
                    self._write({"id": message["id"], "result": None})
                elif "id" in message:
                    responses.put(message)
        except (OSError, ValueError):
            pass
        finally:
            responses.put({"error": {"message": "Language server stopped"}})

    def _request(
        self, method: str, params: Mapping[str, Any], timeout: float = 12
    ) -> Any:
        self._sequence += 1
        request_id = self._sequence
        self._write({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            response = self._responses.get(
                timeout=max(0.01, deadline - time.monotonic())
            )
            if response.get("id") != request_id and "id" in response:
                continue
            if "error" in response:
                raise OSError(str(response["error"]))
            return response.get("result")

    def _start(self) -> None:
        if self._process is not None:
            return
        command = language_server_command()
        if command is None:
            raise OSError("Install uv or pyright to enable typed completion")
        self._folder = tempfile.TemporaryDirectory(prefix="reaktiv-editor-")
        root = Path(self._folder.name)
        self._uri = (root / "editor.py").as_uri()
        self._process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=root,
            start_new_session=os.name == "posix",
        )
        Thread(
            target=self._read, args=(self._process, self._responses), daemon=True
        ).start()
        self._request(
            "initialize",
            {
                "processId": os.getpid(),
                "rootUri": root.as_uri(),
                "capabilities": {
                    "textDocument": {
                        "completion": {"completionItem": {"snippetSupport": False}}
                    }
                },
            },
            timeout=45,
        )
        self._write({"method": "initialized", "params": {}})
        self._write(
            {
                "method": "workspace/didChangeConfiguration",
                "params": {
                    "settings": {
                        "python": {
                            "pythonPath": sys.executable,
                            "analysis": {
                                "extraPaths": [
                                    path
                                    for path in sys.path
                                    if path and os.path.isdir(path)
                                ],
                                "typeCheckingMode": "basic",
                                "autoImportCompletions": False,
                            },
                        }
                    }
                },
            }
        )

    def query(
        self,
        document: SheetDocument,
        sheet: str,
        source: str,
        position: Mapping[str, Any],
        action: str,
        completion_key: str = "",
    ) -> dict[str, Any]:
        if action not in ("completion", "hover", "signatureHelp", "completionResolve"):
            raise ValueError("Unknown editor action")
        # Canceled browser queries keep running on the server. Never queue them
        # behind Pyright and occupy all HTTP worker threads with stale requests.
        if not self._lock.acquire(blocking=False):
            return {"available": True, "result": None}
        try:
            if time.monotonic() < self._retry_after:
                return {"available": False}
            try:
                method_context = bool(re.match(
                    r"\s*(?:async\s+)?def\s+\w+\s*\(\s*self\b", source
                ))
                if self._context != (document, sheet, method_context):
                    probe = "def __reaktiv_probe(self):" if method_context else ""
                    template, self._offset = virtual_source(document, sheet, probe)
                    # Remove only the probe, retaining the wrapper and cursor offset.
                    self._prefix = template[:-(len(probe) + 5)]
                    model_match = re.search(
                        r"^class (\w+)\(ReactiveModel\):", template, re.MULTILINE
                    )
                    self._model_name = model_match.group(1) if model_match else ""
                    self._context = (document, sheet, method_context)
                text = (
                    self._prefix
                    + "\n".join("    " + line for line in source.split("\n"))
                    + "\n"
                )
                offset = self._offset
                self._start()
                if action == "completionResolve":
                    item = self._items.get(completion_key)
                    if item is None or text != self._text:
                        return {"available": True, "result": None}
                    resolved = self._request("completionItem/resolve", item)
                    return {"available": True, "result": resolved}
                if text != self._text:
                    self._items.clear()
                    self._version += 1
                    if self._version == 1:
                        self._write(
                            {
                                "method": "textDocument/didOpen",
                                "params": {
                                    "textDocument": {
                                        "uri": self._uri,
                                        "languageId": "python",
                                        "version": self._version,
                                        "text": text,
                                    }
                                },
                            }
                        )
                    else:
                        self._write(
                            {
                                "method": "textDocument/didChange",
                                "params": {
                                    "textDocument": {
                                        "uri": self._uri,
                                        "version": self._version,
                                    },
                                    "contentChanges": [{"text": text}],
                                },
                            }
                        )
                    self._text = text
                result = self._request(
                    f"textDocument/{action}",
                    {
                        "textDocument": {"uri": self._uri},
                        "position": {
                            "line": int(position.get("line", 0)) + offset,
                            "character": int(position.get("character", 0)) + 4,
                        },
                    },
                )
                if action == "completion":
                    items = (
                        as_list(result)
                        or as_list((as_mapping(result) or {}).get("items"))
                        or []
                    )
                    self._items.clear()
                    completions: list[dict[str, Any]] = []
                    for raw in items[:2000]:
                        item = as_mapping(raw) or {}
                        label = str(item.get("label", ""))
                        if label == self._model_name or (
                            label
                            in {
                                "ReactiveModel",
                                "computed",
                                "effect",
                                "field",
                                "resource",
                                "linked",
                                "cell",
                                "markdown",
                                "sheet",
                                "CellRef",
                                "cell_refs",
                            }
                            and not re.search(
                                r"\b" + re.escape(label) + r"\b",
                                "\n".join([*document.imports, document.code, source]),
                            )
                        ):
                            continue
                        if not label or label.startswith(
                            ("__reaktiv", "_reaktiv_editor", "_ReaktivEditor")
                        ):
                            continue
                        key = f"{self._version}:{self._sequence}:{len(self._items)}"
                        self._items[key] = item
                        edit = as_mapping(item.get("textEdit")) or {}
                        completions.append(
                            {
                                "key": key,
                                "label": label,
                                "detail": str(item.get("detail", "")),
                                "kind": item.get("kind"),
                                "apply": edit.get(
                                    "newText", item.get("insertText", label)
                                ),
                            }
                        )
                    return {"available": True, "completions": completions}
                return {"available": True, "result": result}
            except (OSError, Empty, ValueError, SyntaxError) as error:
                self.close()
                self._retry_after = time.monotonic() + 30
                return {"available": False, "reason": str(error)}

        finally:
            self._lock.release()

    def close(self) -> None:
        process, self._process = self._process, None
        if process is not None:
            # Closing stdin normally lets Pyright and its Python/uv wrapper exit.
            if process.stdin is not None:
                process.stdin.close()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                if os.name == "posix":
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                else:
                    process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    if os.name == "posix":
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    else:
                        process.kill()
                    process.wait(timeout=2)
            if process.stdout is not None:
                process.stdout.close()
        if self._folder is not None:
            self._folder.cleanup()
            self._folder = None
        self._version = 0
        self._text = ""
        self._responses = Queue()
