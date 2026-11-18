"""User-facing commands. Workbook entry points use the evaluator, never this dispatcher."""
from __future__ import annotations

import argparse
from importlib.metadata import version
from pathlib import Path
import sys
from typing import Sequence

from .cli import main as evaluate_workbook

COMMANDS = frozenset({'new', 'edit', 'run', 'evaluate', 'check', 'export'})
# `edit` without a file: the default from before the rename if it exists, else a new name.
LEGACY_DEFAULT_WORKBOOK = Path('workbook.sheet.py')
DEFAULT_WORKBOOK = Path('untitled.workbook.py')
SANDBOX_HELP = ("Run in an isolated uv environment with the workbook's declared packages "
                "(cached by uv; requires uv)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='reaktiv-workbook', description='Reactive Python workbooks: edit, serve, or evaluate.')
    parser.add_argument('--version', action='version', version=f'%(prog)s {version("reaktiv-workbook")}')
    commands = parser.add_subparsers(dest='command', required=True)
    for command, description in [('new', 'Create a workbook, blank or from an example, and open it'),
                                 ('edit', 'Open a workbook in the browser IDE'),
                                 ('run', 'Serve an interactive workbook without authoring controls')]:
        child = commands.add_parser(command, help=description, description=description)
        if command == 'new':
            child.add_argument('file', type=Path, nargs='?', default=None,
                               help=f'Workbook to create (default: the example name, or {DEFAULT_WORKBOOK})')
            child.add_argument('--from', dest='example', metavar='EXAMPLE',
                               help='Start from a bundled example, e.g. welcome, budget or education/motion')
        elif command == 'edit':
            child.add_argument('file', type=Path, nargs='?', default=None,
                               help=f'Workbook to open or create (default: {DEFAULT_WORKBOOK})')
        else:
            child.add_argument('file', type=Path)
        child.add_argument('--port', type=int, default=0, help='Local HTTP port (default: choose a free port)')
        child.add_argument('--host', choices=['127.0.0.1', 'localhost', '::1'], default='127.0.0.1', help='Loopback listen address')
        child.add_argument('--headless', '--no-browser', action='store_true', help='Print the URL without opening a browser')
        child.add_argument('--sandbox', action='store_true', help=SANDBOX_HELP)
        if command in ('new', 'edit'):
            child.add_argument('--mcp', action='store_true',
                               help='Also share the workbook on the MCP endpoint for coding agents; one endpoint and saved '
                                    'token for all workbooks, so agents are configured once')
            child.add_argument('--mcp-port', type=int, default=8766, help='Port of the MCP endpoint (default: 8766)')
    child = commands.add_parser('evaluate', help='Evaluate cells, inspect values, or watch timers', add_help=False)
    child.add_argument('arguments', nargs=argparse.REMAINDER)
    child = commands.add_parser('check', help='Evaluate a workbook and fail on cell errors')
    child.add_argument('file', type=Path)
    child.add_argument('--sandbox', action='store_true', help=SANDBOX_HELP)
    child = commands.add_parser('export', help='Export plots, artifacts and Markdown notes')
    child.add_argument('file', type=Path)
    child.add_argument('directory', type=Path)
    child.add_argument('--sandbox', action='store_true', help=SANDBOX_HELP)
    return parser


def sandbox_arguments(args: argparse.Namespace) -> list[str]:
    """The same command without --sandbox, rebuilt from the parsed arguments."""
    if args.command == 'check':
        return ['check', str(args.file)]
    if args.command == 'export':
        return ['export', str(args.file), str(args.directory)]
    arguments = [args.command, str(args.file), '--port', str(args.port), '--host', args.host]
    if args.headless:
        arguments.append('--headless')
    if getattr(args, 'mcp', False):
        arguments += ['--mcp', '--mcp-port', str(args.mcp_port)]
    return arguments


def create_new(args: argparse.Namespace) -> int:
    """`new`: write the workbook (never over an existing file); it then opens like `edit`."""
    from .model import WORKBOOK_SUFFIX, workbook_stem
    from .standalone import create_workbook
    if args.file is None:
        args.file = Path(workbook_stem(Path(args.example).name) + WORKBOOK_SUFFIX) if args.example else DEFAULT_WORKBOOK
    if args.file.exists():
        print(f'{args.file} already exists. Open it with: reaktiv-workbook edit {args.file}', file=sys.stderr)
        return 2
    try:
        create_workbook(args.file, args.example)
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Could not create workbook: {error}', file=sys.stderr)
        return 2
    print(f'Created {args.file}', flush=True)
    return 0


def evaluate(arguments: Sequence[str]) -> int:
    try:
        return evaluate_workbook(arguments)
    except (OSError, ValueError, RuntimeError, SyntaxError) as error:
        print(f'Could not evaluate workbook: {error}', file=sys.stderr)
        return 2


def command_main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    # Retain the published evaluator syntax and its options. Only explicit command
    # words can launch a server; passing a workbook path always evaluates it.
    if arguments and arguments[0] == 'evaluate':
        return evaluate(arguments[1:])
    if arguments and arguments[0] not in COMMANDS and arguments[0] not in ('-h', '--help', '--version'):
        return evaluate(arguments)
    parser = build_parser()
    if not arguments:
        parser.print_help()
        return 0
    args = parser.parse_args(arguments)
    if args.command == 'edit' and args.file is None:
        args.file = LEGACY_DEFAULT_WORKBOOK if LEGACY_DEFAULT_WORKBOOK.is_file() else DEFAULT_WORKBOOK
    if args.command in ('new', 'edit', 'run') and not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    if args.command in ('new', 'edit') and not 0 <= args.mcp_port <= 65535:
        parser.error('--mcp-port must be between 0 and 65535')
    if args.command == 'new':
        status = create_new(args)
        if status:
            return status
        args.command = 'edit'
    if not getattr(args, 'sandbox', True):
        # Missing declared packages: in a terminal with uv, offer a sandbox (like marimo).
        from .sandbox import offer_sandbox
        try:
            args.sandbox = offer_sandbox(args.file)
        except (OSError, ValueError, SyntaxError):
            pass  # an unreadable workbook reports its error when it is opened
    if getattr(args, 'sandbox', False):
        from .sandbox import SandboxError, run_sandboxed
        try:
            return run_sandboxed(args.file, sandbox_arguments(args))
        except (OSError, ValueError, SandboxError, SyntaxError) as error:
            print(f'Could not prepare sandbox: {error}', file=sys.stderr)
            return 2
    if args.command == 'check':
        return evaluate([str(args.file), '--check'])
    if args.command == 'export':
        return evaluate([str(args.file), '--export', str(args.directory)])
    from .standalone import serve_workbook
    try:
        return serve_workbook(args.file, mode=args.command, host=args.host,
                              port=args.port, open_browser=not args.headless,
                              mcp_port=args.mcp_port if getattr(args, 'mcp', False) else None)
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, RuntimeError, SyntaxError) as error:
        print(f'Could not {args.command} workbook: {error}', file=sys.stderr)
        return 2
