"""One MCP endpoint and one saved token for all workbooks opened with `edit --mcp`."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import socket
import stat
import sys
from threading import Thread
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

pytest.importorskip('mcp')
from reaktiv_workbook import agent_bridge
from reaktiv_workbook.agent_bridge import AgentBridge, pairing_token, probe, token_path

ORIGIN = 'http://127.0.0.1:4321'


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def post(port: int, path: str, body: dict[str, object], token: str | None = None) -> int:
    headers = {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})}
    with urlopen(Request(f'http://127.0.0.1:{port}{path}', data=json.dumps(body).encode(), headers=headers), timeout=5) as response:
        return response.status


def test_token_is_created_once_private_and_reused() -> None:
    token, created = pairing_token()
    assert created and len(token) >= 32
    assert pairing_token() == (token, False)
    if sys.platform != 'win32':
        assert stat.S_IMODE(os.stat(token_path()).st_mode) == 0o600


def test_environment_token_wins_and_short_tokens_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', 'x' * 40)
    assert pairing_token() == ('x' * 40, False)
    assert not token_path().exists()
    monkeypatch.delenv('REAKTIV_WORKBOOK_MCP_TOKEN')
    token_path().parent.mkdir(parents=True, exist_ok=True)
    token_path().write_text('short\n')
    with pytest.raises(RuntimeError, match='shorter than 32'):
        pairing_token()


def test_identify_needs_no_token_but_everything_else_does() -> None:
    bridge = AgentBridge(0, ORIGIN)
    try:
        assert probe(bridge.port, bridge.token) == 'ours'
        assert probe(bridge.port, 'y' * 40) == 'other-token'
        with pytest.raises(HTTPError) as refused:
            post(bridge.port, '/bridge/poll', {'id': 'w', 'name': 'x', 'kernelRunning': True})
        assert refused.value.code == 401
    finally:
        bridge.stop()
    assert probe(bridge.port, bridge.token) == 'absent'


def test_editors_share_one_endpoint_and_a_survivor_takes_it_over(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_bridge, 'WATCH_SECONDS', 0.2)
    port = free_port()
    first = AgentBridge(port, ORIGIN)
    second = AgentBridge(port, 'http://127.0.0.1:5432')
    try:
        assert first.serving and not second.serving
        assert (first.endpoint, first.token) == (second.endpoint, second.token)
        first.stop()
        deadline = time.monotonic() + 10
        while not second.serving and time.monotonic() < deadline:
            time.sleep(0.1)
        assert second.serving and probe(port, second.token) == 'ours'
        # Editors keep polling with the same token and are registered again.
        assert post(port, '/bridge/poll', {'id': 'w', 'name': 'x', 'kernelRunning': True}, second.token) == 200
    finally:
        first.stop()
        second.stop()


def test_another_token_or_program_on_the_port_is_reported_without_sending_the_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_bridge, 'JOIN_WAIT_SECONDS', 0.5)
    port = free_port()
    monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', 'a' * 40)
    other = AgentBridge(port, ORIGIN)
    try:
        monkeypatch.setenv('REAKTIV_WORKBOOK_MCP_TOKEN', 'b' * 40)
        with pytest.raises(RuntimeError, match='different pairing token'):
            AgentBridge(port, ORIGIN)
    finally:
        other.stop()

    seen: list[str] = []

    class Foreign(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            seen.append(json.dumps(dict(self.headers)) + self.rfile.read(int(self.headers['Content-Length'])).decode())
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"hello": "world"}')

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(('127.0.0.1', 0), Foreign)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with pytest.raises(RuntimeError, match='another program'):
            AgentBridge(server.server_port, ORIGIN)
        assert seen and not any('b' * 40 in request for request in seen)
    finally:
        server.shutdown()
