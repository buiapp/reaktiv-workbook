"""One MCP endpoint for every workbook opened with ``reaktiv-workbook edit --mcp``.

Agents are configured once: the pairing token is saved in the user's configuration
folder and reused, and all editors share the endpoint on the same port. The first
editor serves it; later editors join it, and when the serving editor quits, one of
the others takes the port over (editors re-register within a second, so the URL and
token stay valid).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sys
from threading import Event, Thread
import time
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .api.serving import BackgroundServer
from .narrowing import as_mapping

TOKEN_ENVIRONMENT = ("REAKTIV_WORKBOOK_MCP_TOKEN",)
# Identifies the bridge in /bridge/identify answers.
SERVICE = "reaktiv-workbook-mcp"
# How long a starting editor waits for a busy port to answer (another editor may be starting).
JOIN_WAIT_SECONDS = 5.0
# How often a joined editor checks that the serving editor is still there.
WATCH_SECONDS = 1.0

Probe = Literal["ours", "other-token", "foreign", "absent"]


def config_dir() -> Path:
    """The user's Reaktiv Workbook configuration folder (``REAKTIV_WORKBOOK_CONFIG_DIR`` overrides)."""
    override = os.environ.get("REAKTIV_WORKBOOK_CONFIG_DIR")
    if override:
        return Path(override)
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData/Roaming") / "reaktiv-workbook"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/reaktiv-workbook"
    return Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "reaktiv-workbook"


def token_path() -> Path:
    return config_dir() / "mcp-token"


def pairing_token() -> tuple[str, bool]:
    """The agent pairing token and whether it was just created.

    ``REAKTIV_WORKBOOK_MCP_TOKEN`` wins; otherwise the saved token, created once
    (readable by this user only). Delete the file to issue a new token.
    """
    for name in TOKEN_ENVIRONMENT:
        value = os.environ.get(name, "").strip()
        if value:
            return _valid(value, f"${name}"), False
    path = token_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write(secrets.token_urlsafe(32) + "\n")
        created = True
    for _ in range(20):  # a simultaneous first start may still be writing it
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return _valid(value, str(path)), created
        time.sleep(0.05)
    return _valid("", str(path)), created


def _valid(token: str, source: str) -> str:
    if len(token) < 32:
        raise RuntimeError(f"The MCP pairing token in {source} is shorter than 32 characters. "
                           "Delete the file (or unset the variable) to create a new one.")
    return token


def proof(token: str, nonce: str) -> str:
    """Shows that a bridge knows ``token`` without sending it."""
    return hmac.new(token.encode(), nonce.encode(), hashlib.sha256).hexdigest()


def probe(port: int, token: str, timeout: float = 2.0) -> Probe:
    """Who listens on the loopback ``port``. Never sends the token itself."""
    nonce = secrets.token_hex(16)
    request = Request(f"http://127.0.0.1:{port}/bridge/identify", data=json.dumps({"nonce": nonce}).encode(),
                      headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            answer = json.load(response)
    except HTTPError:
        return "foreign"
    except (URLError, OSError) as error:
        reason = getattr(error, "reason", error)
        return "absent" if isinstance(reason, ConnectionRefusedError) else "foreign"
    except ValueError:
        return "foreign"
    reply = as_mapping(answer)
    if reply is None or reply.get("service") != SERVICE:
        return "foreign"
    return "ours" if hmac.compare_digest(str(reply.get("proof", "")), proof(token, nonce)) else "other-token"


class AgentBridge:
    """Serves or joins the shared MCP endpoint on ``port``; ``stop`` releases it."""

    def __init__(self, port: int, editor_origin: str) -> None:
        from .mcp_server import create_live_http_app
        self.token, self.token_created = pairing_token()
        self._create = lambda: create_live_http_app(self.token, editor_origin, host="127.0.0.1")
        self._server: BackgroundServer | None = None
        self._stopped = Event()
        self._watcher: Thread | None = None
        self.shared = port != 0
        if port == 0:  # a private endpoint on a free port (tests, scripts)
            self._server = BackgroundServer(self._create(), host="127.0.0.1", port=0)
            self.port = self._server.port
            return
        self.port = port
        deadline = time.monotonic() + JOIN_WAIT_SECONDS
        while True:
            if self._serve():
                break
            found = probe(port, self.token)
            if found == "ours":
                break
            if found == "other-token":
                raise RuntimeError(f"Port {port} serves Reaktiv Workbook MCP with a different pairing token "
                                   "(another user, or REAKTIV_WORKBOOK_MCP_TOKEN differs). Use --mcp-port.")
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Port {port} is used by another program. Choose a free port with --mcp-port.")
            time.sleep(0.2)
        self._watcher = Thread(target=self._watch, name="reaktiv-workbook-mcp-watch", daemon=True)
        self._watcher.start()

    @property
    def endpoint(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def serving(self) -> bool:
        """Whether this process serves the endpoint (rather than having joined it)."""
        return self._server is not None

    def _serve(self) -> bool:
        try:
            self._server = BackgroundServer(self._create(), host="127.0.0.1", port=self.port)
        except OSError:
            return False
        return True

    def _watch(self) -> None:
        # The serving editor may quit; then one of the others serves the same URL and token.
        while not self._stopped.wait(WATCH_SECONDS):
            if self._server is None and probe(self.port, self.token) == "absent":
                self._serve()

    def stop(self) -> None:
        self._stopped.set()
        if self._watcher is not None:
            self._watcher.join(timeout=5)
        if self._server is not None:
            self._server.stop()
            self._server = None
