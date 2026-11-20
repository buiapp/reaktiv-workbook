"""Failures as ``{"error": "..."}`` with a meaningful status, and the request size limit.

The app shows the message of a failed request, so every failure — validation, authentication,
a workbook the engine refuses, an unexpected bug — answers with the same shape. Errors from the
workbook keep their Python type in the message (``SyntaxError: …``), as users see them in cells.
"""

from __future__ import annotations

import sys
import traceback
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


def python_error(error: BaseException) -> str:
    return f"{type(error).__name__}: {error}"


def install_error_handlers(app: FastAPI) -> None:
    async def http_error(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, StarletteHTTPException)
        return error_response(error.status_code, str(error.detail))

    async def validation_error(_: Request, error: Exception) -> JSONResponse:
        assert isinstance(error, RequestValidationError)
        return error_response(status.HTTP_400_BAD_REQUEST, validation_message(error))

    async def not_found(_: Request, error: Exception) -> JSONResponse:
        # Unknown endpoints of a runtime, cells, sheets, chart tokens.
        return error_response(status.HTTP_404_NOT_FOUND, python_error(error))

    async def refused(_: Request, error: Exception) -> JSONResponse:
        # A request the engine refuses: a malformed workbook, a session conflict, …
        return error_response(status.HTTP_400_BAD_REQUEST, python_error(error))

    from ..moves import MoveConflict
    async def move_conflict(_: Request, error: Exception) -> JSONResponse:
        return error_response(status.HTTP_409_CONFLICT, python_error(error))
    app.add_exception_handler(MoveConflict, move_conflict)

    async def forbidden(_: Request, error: Exception) -> JSONResponse:
        # Refused by policy (a shared session's path limits): retrying another way cannot help.
        return error_response(status.HTTP_403_FORBIDDEN, python_error(error))
    app.add_exception_handler(PermissionError, forbidden)
    app.add_exception_handler(StarletteHTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(KeyError, not_found)
    for refusal in (ValueError, TypeError, SyntaxError, RuntimeError, IndexError):
        app.add_exception_handler(refusal, refused)


def validation_message(error: RequestValidationError) -> str:
    problems: list[str] = []
    for item in error.errors():
        location = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
        problems.append(f"{location}: {item.get('msg', 'invalid')}" if location else str(item.get("msg", "invalid")))
    return "Invalid request: " + "; ".join(problems)


class ErrorBoundary:
    """Unexpected exceptions become a JSON 500 *inside* the CORS middleware, so the browser can
    read the message (Starlette's own server-error response is outside it). The traceback goes
    to stderr, the kernel's log."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as error:  # noqa: BLE001 - the boundary of the whole application
            traceback.print_exception(error, file=sys.stderr)
            if started:
                raise
            await error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, python_error(error))(scope, receive, send)


class BodyLimit:
    """Refuse request bodies over ``limit`` bytes with 413 — also when the client sends no (or a
    false) ``Content-Length``. The body is read here, up to the limit, and then handed to the app
    unchanged: an error raised while FastAPI itself reads would become "error parsing the body"."""

    def __init__(self, app: ASGIApp, limit: int) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        too_large = error_response(status.HTTP_413_CONTENT_TOO_LARGE, f"Request exceeds the {self.limit / 1_000_000:g} MB limit")
        declared = dict(scope.get("headers", ())).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.limit:
            await too_large(scope, receive, send)
            return
        messages: list[Message] = []
        received = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break  # the client went away; let the app see it
            body: Any = message.get("body", b"")
            received += len(body)
            if received > self.limit:
                await too_large(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        async def replay() -> Message:
            return messages.pop(0) if messages else await receive()

        await self.app(scope, replay, send)
