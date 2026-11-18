"""The FastAPI application of one kernel (one workbook)."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from ..runtime import RuntimeServer
from .config import KernelSettings
from .errors import BodyLimit, ErrorBoundary, install_error_handlers
from .router import router


def create_app(
    runtime: RuntimeServer,
    settings: KernelSettings,
    *,
    owns_runtime: bool,
    static_root: Path | None = None,
) -> FastAPI:
    """The HTTP interface of ``runtime``.

    ``owns_runtime``: a standalone kernel closes its runtime when the server stops; an embedded
    session's runtime belongs to the script and outlives any editor connection. ``static_root``
    serves a built app next to the API (embedded editors). Run it in **one** process: the
    workbook lives in this process's memory, so several workers would be several workbooks.
    """

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        try:
            yield
        finally:
            if owns_runtime:
                await run_in_threadpool(runtime.close)

    app = FastAPI(
        title="Reaktiv Workbook kernel",
        summary="One reactive workbook: evaluate cells, check types, and follow progress.",
        version="1",
        lifespan=lifespan,
        openapi_url="/openapi.json" if settings.docs else None,
        docs_url="/docs" if settings.docs else None,
        redoc_url=None,
    )
    app.state.runtime = runtime
    app.state.settings = settings
    install_error_handlers(app)
    app.include_router(router)
    if static_root is not None:
        app.mount("/", StaticFiles(directory=static_root, html=True), name="app")
    # Added innermost first: CORS is outermost, so every reply (errors too) carries its headers.
    app.add_middleware(ErrorBoundary)
    app.add_middleware(BodyLimit, limit=settings.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.allow_origin],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    return app
