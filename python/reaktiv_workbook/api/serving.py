"""Running a kernel app with Uvicorn.

The listening socket is bound before Uvicorn starts (port 0 picks a free port without a
choose/close/rebind race), and the caller learns the port from it. One process, one worker, no
reload: the workbook lives in this process's memory.
"""

from __future__ import annotations

import socket
from collections.abc import Callable
from threading import Event, Thread

import uvicorn
from fastapi import FastAPI

#: Seconds Uvicorn waits for running requests when it stops (a looping cell never finishes).
GRACEFUL_SHUTDOWN_SECONDS = 3


def bind_socket(host: str, port: int) -> socket.socket:
    """A listening TCP socket on ``host:port`` (``0``: a free port)."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    exclusive: int | None = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
    if exclusive is not None:
        # Windows: SO_REUSEADDR would let a second server bind the same port.
        sock.setsockopt(socket.SOL_SOCKET, exclusive, 1)
    else:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.listen(128)
    sock.set_inheritable(True)
    return sock


class KernelServer(uvicorn.Server):
    """Uvicorn, telling ``on_ready`` once it accepts requests."""

    def __init__(self, app: FastAPI, *, on_ready: Callable[[], None] | None = None) -> None:
        super().__init__(
            uvicorn.Config(
                app,
                log_level="warning",
                access_log=False,  # polled endpoints would flood the kernel log
                timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
                lifespan="on",
            )
        )
        self._on_ready = on_ready

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        if self.started and self._on_ready is not None:
            self._on_ready()


class BackgroundServer:
    """A kernel app served from a thread of an embedding script (``WorkbookSession`` editors). It
    installs no signal handlers and leaves the script's own event loop alone."""

    def __init__(self, app: FastAPI, host: str = "127.0.0.1", port: int = 0) -> None:
        self._socket = bind_socket(host, port)
        self.port: int = self._socket.getsockname()[1]
        ready = Event()
        self._server = KernelServer(app, on_ready=ready.set)
        self._thread = Thread(target=self._server.run, kwargs={"sockets": [self._socket]}, name="reaktiv-workbook-editor", daemon=True)
        self._thread.start()
        if not ready.wait(timeout=5):
            self.stop()
            raise RuntimeError('The workbook HTTP server did not start within five seconds')

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=GRACEFUL_SHUTDOWN_SECONDS + 2)
        self._socket.close()
