"""The kernel process: ``python -m reaktiv_workbook.server`` (``reaktiv-workbook-server``).

A remote kernel for the browser app: a parent process
starts it with ``--port 0 --token <secret> --exit-on-stdin-eof``, reads the
``REAKTIV_KERNEL_READY {"port": ...}`` line from stdout, and sends the token as
``Authorization: Bearer <secret>`` on every request. The HTTP interface is ``api/`` (FastAPI on
Uvicorn); the workbook runs in :class:`~reaktiv_workbook.runtime.RuntimeServer`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from typing import Optional, Sequence

from .runtime import RuntimeServer

READY_PREFIX = "REAKTIV_KERNEL_READY "
#: After stdin closes (the app is gone), seconds before the process exits even if a cell runs.
FORCED_EXIT_SECONDS = 5


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    *,
    token: Optional[str] = None,
    allow_origin: str = "*",
    exit_on_stdin_eof: bool = False,
    docs: bool = False,
) -> None:
    from .api import KernelSettings, create_app
    from .api.serving import KernelServer, bind_socket

    sock = bind_socket(host, port)
    bound_port: int = sock.getsockname()[1]
    app = create_app(
        RuntimeServer(),
        KernelSettings(token=token, allow_origin=allow_origin, docs=docs),
        owns_runtime=True,
    )

    def announce() -> None:
        # Machine-readable line for the parent process (it starts us with --port 0).
        print(READY_PREFIX + json.dumps({"port": bound_port, "pid": os.getpid()}), flush=True)
        print(f"Reaktiv Workbook kernel listening on http://{host}:{bound_port}", file=sys.stderr, flush=True)

    server = KernelServer(app, on_ready=announce)
    if exit_on_stdin_eof:
        # The app holds our stdin open; when it exits or crashes the pipe closes and the kernel
        # stops, so no orphaned Python processes are left behind — also when a cell never ends.
        def watch_stdin() -> None:
            while sys.stdin.buffer.read(1):
                pass
            server.should_exit = True
            threading.Timer(FORCED_EXIT_SECONDS, os._exit, args=(0,)).start()

        threading.Thread(target=watch_stdin, name="parent-watchdog", daemon=True).start()
    server.run(sockets=[sock])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run a Reaktiv Workbook HTTP kernel")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int, help="0 picks a free port")
    parser.add_argument(
        "--token",
        default=os.environ.get("REAKTIV_KERNEL_TOKEN"),
        help="Require 'Authorization: Bearer <token>' (default: $REAKTIV_KERNEL_TOKEN)",
    )
    parser.add_argument("--allow-origin", default="*", help="CORS Access-Control-Allow-Origin")
    parser.add_argument(
        "--exit-on-stdin-eof",
        action="store_true",
        help="Stop when stdin closes (the launching app exited)",
    )
    parser.add_argument("--docs", action="store_true", help="Serve the API documentation at /docs")
    args = parser.parse_args(argv)
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not args.token:
        parser.error("--token is required when listening on a non-loopback host")
    serve(
        args.host,
        args.port,
        token=args.token,
        allow_origin=args.allow_origin,
        exit_on_stdin_eof=args.exit_on_stdin_eof,
        docs=args.docs,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
