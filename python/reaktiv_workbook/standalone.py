"""CLI-owned local IDE lifecycle and packaged frontend discovery."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import signal
from threading import Event, Timer
from types import FrameType
from typing import Literal
import webbrowser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .agent_bridge import AgentBridge, token_path
from .model import WORKBOOK_SUFFIX, CellDefinition, SheetDocument, is_workbook_filename, workbook_stem
from .session import WorkbookSession


def frontend_root() -> Path:
    packaged = Path(__file__).resolve().parent / 'web'
    checkout = Path(__file__).resolve().parents[2] / 'dist/reaktiv-workbook/browser'
    for root in (packaged, checkout):
        if (root / 'index.html').is_file():
            return root
    raise RuntimeError('The browser IDE is missing. Install an official reaktiv-workbook wheel, or build this checkout with npm run build.')


def wait_for_shutdown(stopped: Event | None = None) -> None:
    stopped = stopped or Event()
    def stop(_signal: int, _frame: FrameType | None) -> None:
        stopped.set()
    previous = signal.signal(signal.SIGTERM, stop)
    try:
        stopped.wait()
    finally:
        signal.signal(signal.SIGTERM, previous)


# Default port of the agent (MCP) bridge; fixed so agent configurations keep working.
DEFAULT_MCP_PORT = 8766


def agent_instructions(bridge: AgentBridge) -> str:
    """What to tell the user: the full token only when it is new, else where it lives."""
    shared = 'shared by all workbooks opened with --mcp' if bridge.shared else 'this workbook only'
    lines = [f'MCP for agents: {bridge.endpoint}/mcp ({shared})']
    if bridge.token_created or not bridge.shared:
        lines += [f'  Header: Authorization: Bearer {bridge.token}',
                  '  Add it to your agent once; the URL and token stay the same on every start.']
    else:
        lines.append(f'  Same URL and token as before (token in {token_path()}).')
    return '\n'.join(lines) + '\n'


def remote_warning(host: str, mode: Literal['edit', 'run'], allow_remote: bool) -> str:
    """Said when the session is shared beyond this computer (``--allow-remote``)."""
    from .session import LOOPBACK_HOSTS
    if not allow_remote:
        return ''
    access = ('edit the workbook and run Python as you' if mode == 'edit' else
              'change its inputs and run its exposed actions')
    if host in LOOPBACK_HOSTS:
        return (f'Shared through your proxy or tunnel: anyone who reaches this link can {access}.\n'
                "  File and folder inputs accept only paths inside the workbook's folder.\n")
    return (f'Listening on the network: anyone with this link can {access}.\n'
            '  The link travels as plain HTTP; on an untrusted network, put HTTPS in front (a reverse proxy or\n'
            '  `tailscale serve`) and share that address instead. Through a proxy, change only the address.\n')


def with_query(url: str, *parameters: tuple[str, str]) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(query=urlencode([*parse_qsl(parts.query), *parameters])))


def with_agent_bridge(editor_url: str, endpoint: str, token: str) -> str:
    """The editor link that also shares the workbook with the bridge (token in the fragment)."""
    parts = urlsplit(with_query(editor_url, ('mcp', endpoint)))
    fragment = urlencode([*parse_qsl(parts.fragment), ('mcpToken', token)])
    return urlunsplit(parts._replace(fragment=fragment))


STARTER_NOTE = """# New workbook

Cells hold values and calculations. Move the slider: everything that uses it updates.

[Quantity: {{ quantity }}](#sheet-input:quantity?type=range&min=0&max=20&step=1)

[Price: {{ price }}](#sheet-input:price?type=number&min=0&step=0.5)

**Total: {{ total }}**

Open **Cells** to see the Python behind these values and add your own. Save with Ctrl+S:
everything is written to this one Python file.

New here? Open **Getting started** in the ⋯ menu, or copy a guided example next to this file
with `reaktiv-workbook new --from welcome`."""


def starter_document(name: str) -> SheetDocument:
    """A new workbook: a small working model that shows inputs, a formula and a note."""
    return SheetDocument(name=name, cells=(
        CellDefinition('A1', 'markdown', STARTER_NOTE, name='overview'),
        CellDefinition('B1', 'input', '3', name='quantity', view={
            'widget': {'type': 'range', 'min': 0, 'max': 20, 'step': 1, 'label': 'Quantity'}}),
        CellDefinition('B2', 'input', '4.5', name='price', view={
            'widget': {'type': 'number', 'min': 0, 'step': 0.5, 'label': 'Price'}}),
        CellDefinition('B3', 'formula', 'quantity * price', name='total'),
    ))


def is_untouched_starter(path: Path) -> bool:
    try:
        return path.read_text(encoding='utf-8') == starter_document(workbook_stem(path.name)).dumps()
    except (OSError, UnicodeDecodeError):
        return False


def example_files() -> dict[str, Path]:
    """Bundled examples by name: `welcome`, `education/motion`, …"""
    root = frontend_root() / 'examples'
    files = [file for file in root.rglob('*.py') if is_workbook_filename(file.name)] if root.is_dir() else []
    files.sort(key=lambda file: (len(file.relative_to(root).parts), file.as_posix()))
    return {workbook_stem(file.relative_to(root).as_posix()): file for file in files}


def create_workbook(path: Path, example: str | None = None) -> None:
    """Write a new workbook: the starter, or a copy of a bundled example. Never overwrites."""
    if not is_workbook_filename(path.name):
        raise ValueError(f'Use a {WORKBOOK_SUFFIX} filename for a new workbook')
    if example is None:
        source = starter_document(workbook_stem(path.name)).dumps()
    else:
        examples = example_files()
        name = workbook_stem(example)
        if name not in examples:
            raise ValueError(f'No example named {example!r}. Examples: {", ".join(examples)}')
        source = examples[name].read_text(encoding='utf-8')
    # Exclusive create also protects a concurrently created file.
    with path.open('x', encoding='utf-8') as output:
        output.write(source)


# A session that ended to restart Python with the workbook's packages exits with this code;
# the sandbox launcher then starts it again (sysexits EX_TEMPFAIL: try again).
RESTART_EXIT = 75


@dataclass(frozen=True)
class Restart:
    """The editor asked to restart Python: the workbook is in the handoff file; the new
    session keeps the address and access token, so the browser reconnects."""
    port: int
    token: str


def serve_workbook(path: Path, *, mode: Literal['edit', 'run'], host: str = '127.0.0.1',
                   port: int = 0, open_browser: bool = True, mcp_port: int | None = None,
                   resume: Path | None = None, handoff: Path | None = None,
                   allow_remote: bool = False) -> int | Restart:
    """Serve until Ctrl+C. ``resume`` starts from that workbook (a restart's unsaved state);
    with ``handoff`` the editor can restart Python: its workbook is written there."""
    # Check assets before creating a new file or running any workbook code.
    frontend_root()
    path = path.resolve()
    if not path.exists() and mode == 'edit':
        create_workbook(path)
    if not path.is_file():
        raise FileNotFoundError(f'Workbook not found: {path}')
    starter = resume is None and mode == 'edit' and is_untouched_starter(path)
    initial = SheetDocument.load(resume) if resume is not None else None
    stopped = Event()
    restarting: list[bool] = []
    with WorkbookSession(path, initial) as session:
        session.mode = mode
        if handoff is not None and mode == 'edit':
            def restart(document: SheetDocument) -> None:
                handoff.write_text(document.dumps(), encoding='utf-8')
                restarting.append(True)
                # A moment for the HTTP response to reach the editor before the server stops.
                Timer(0.3, stopped.set).start()
            session.restart = restart
        url = session.open_editor(host=host, port=port, open_browser=False, allow_remote=allow_remote)
        if starter:
            # The editor offers the getting-started guide and examples for a blank workbook.
            url = with_query(url, ('new', '1'))
        bridge: AgentBridge | None = None
        try:
            agents = ''
            if mcp_port is not None:
                parts = urlsplit(url)
                bridge = AgentBridge(mcp_port, f'{parts.scheme}://{parts.netloc}')
                url = with_agent_bridge(url, bridge.endpoint, bridge.token)
                agents = agent_instructions(bridge)
            print(f'Reaktiv Workbook · {mode} · {path}\n{url}\n{agents}{remote_warning(host, mode, allow_remote)}Press Ctrl+C to stop.',
                  flush=True)
            if open_browser:
                webbrowser.open(url)
            wait_for_shutdown(stopped)
            if restarting:
                return Restart(session.port or port, session.token)
        finally:
            if bridge is not None:
                bridge.stop()
    return 0
