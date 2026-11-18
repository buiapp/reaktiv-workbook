"""Local authenticated rendezvous for already-open app windows; owns no workbook/kernel."""
from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
import hmac
from threading import Event, RLock
import time
from typing import Annotated, Any, Literal
from uuid import uuid4
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field


class CellContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    kind: str
    title: str | None = None


class PaneContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int
    view: Literal['notes', 'sheet', 'graph']
    worksheet: str
    note: CellContext | None


class ViewContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    windowFocused: bool
    lastFocusedAt: str
    view: Literal['notes', 'sheet', 'graph', 'split']
    activePane: int
    panes: list[PaneContext] = Field(max_length=2)
    selectedCell: CellContext | None
    selectedCellIds: list[str]
    inspectedCell: CellContext | None
    focusedCellId: str | None
    editorCellId: str | None
    notesEditing: bool
    actionsOpen: bool
    consoleOpen: bool


class WorkbookPresence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(max_length=500)
    kernelRunning: bool
    context: ViewContext | None = None


class CommandReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workbook: str
    id: str
    result: dict[str, Any] | None = None
    error: str | None = None


class WorkbookHandle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workbook: str


class IdentifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nonce: str = Field(min_length=16, max_length=128)


@dataclass
class PendingCommand:
    workbook: str
    message: dict[str, Any]
    delivered: bool = False
    ready: Event = field(default_factory=Event)
    result: dict[str, Any] | None = None
    error: str | None = None


class LiveWorkbookBridge:
    """Commands deliver once. Disconnect/timeouts never replay an uncertain mutation."""

    def __init__(self, *, lease_seconds: float = 15, timeout_seconds: float = 60) -> None:
        self.lease_seconds = lease_seconds
        self.timeout_seconds = timeout_seconds
        self.lock = RLock()
        self.windows: dict[str, tuple[WorkbookPresence, float]] = {}
        self.pending: dict[str, PendingCommand] = {}
        self.revoked: set[str] = set()
        self.closed = False

    def expire(self) -> None:
        for workbook, (_, seen) in list(self.windows.items()):
            if time.monotonic() - seen > self.lease_seconds:
                self.remove(workbook, "Workbook disconnected; command outcome may be unknown. Read before retrying")

    def list_workbooks(self) -> dict[str, Any]:
        with self.lock:
            self.expire()
            return {"open": [{"workbook": presence.id, "name": presence.name,
                              "kernelRunning": presence.kernelRunning, "context": presence.context.model_dump() if presence.context else None}
                             for presence, _ in self.windows.values()]}

    def poll(self, presence: WorkbookPresence) -> dict[str, Any]:
        with self.lock:
            if self.closed or presence.id in self.revoked:
                raise ValueError("Workbook sharing was revoked")
            self.expire()
            self.windows[presence.id] = (presence, time.monotonic())
            messages: list[dict[str, Any]] = []
            for command in self.pending.values():
                if command.workbook == presence.id and not command.delivered:
                    command.delivered = True
                    messages.append(command.message)
            return {"commands": messages}

    def enqueue(self, workbook: str, operation: str, payload: dict[str, Any]) -> tuple[str, PendingCommand]:
        with self.lock:
            self.expire()
            if self.closed or workbook not in self.windows:
                raise ValueError("Workbook is not shared or has disconnected")
            command_id = uuid4().hex
            command = PendingCommand(workbook, {"id": command_id, "operation": operation,
                "payload": payload, "expiresAt": time.time() * 1000 + self.timeout_seconds * 1000})
            self.pending[command_id] = command
            return command_id, command

    def result(self, command: PendingCommand) -> dict[str, Any]:
        if command.error:
            raise RuntimeError(command.error)
        if command.result is None:
            raise RuntimeError("App returned no command result")
        return {"workbook": command.workbook, **command.result}

    def discard(self, command_id: str, command: PendingCommand) -> None:
        with self.lock:
            self.pending.pop(command_id, None)
            command.ready.set()

    def request(self, workbook: str, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        command_id, command = self.enqueue(workbook, operation, payload)
        try:
            if not command.ready.wait(self.timeout_seconds):
                raise TimeoutError("App did not finish the command. Its outcome may be unknown; read before retrying")
            return self.result(command)
        finally:
            self.discard(command_id, command)

    async def request_async(self, workbook: str, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        command_id, command = self.enqueue(workbook, operation, payload)
        try:
            if not await asyncio.to_thread(command.ready.wait, self.timeout_seconds):
                raise TimeoutError("App did not finish the command. Its outcome may be unknown; read before retrying")
            return self.result(command)
        finally:
            # SDK cancellation removes undelivered requests and wakes the waiting thread.
            # Already executing edits still require read/reconcile; they cannot be rolled back here.
            self.discard(command_id, command)

    def reply(self, reply: CommandReply) -> None:
        with self.lock:
            command = self.pending.get(reply.id)
            if command is None:
                return  # A timed-out command is never retried or re-created.
            if command.ready.is_set():
                return  # Revocation/first reply is terminal, even if a late reply arrives.
            if command.workbook != reply.workbook or not command.delivered:
                raise ValueError("Reply does not match a delivered workbook command")
            command.result, command.error = reply.result, reply.error
            command.ready.set()

    def remove(self, workbook: str, reason: str, *, revoke: bool = False) -> None:
        with self.lock:
            self.windows.pop(workbook, None)
            if revoke:
                self.revoked.add(workbook)
            for command in self.pending.values():
                if command.workbook == workbook:
                    command.error = reason
                    command.ready.set()

    def close(self) -> None:
        with self.lock:
            self.closed = True
            for workbook in list(self.windows):
                self.remove(workbook, "MCP bridge closed; command outcome may be unknown")


def create_bridge_app(bridge: LiveWorkbookBridge, token: str, app_origin: str | None = None) -> FastAPI:
    if len(token) < 32:
        raise ValueError("Use a pairing token of at least 32 characters")
    if app_origin is not None:
        origin = urlsplit(app_origin)
        if origin.scheme not in ("http", "https") or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username:
            raise ValueError("App origin must be an HTTP(S) origin without a path or credentials")

    async def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
        if not hmac.compare_digest((authorization or "").encode(), f"Bearer {token}".encode()):
            raise HTTPException(401, "Missing or invalid agent pairing token")

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    authorized = [Depends(authorize)]
    app.add_middleware(CORSMiddleware,
        allow_origins=[app_origin] if app_origin else [],
        allow_origin_regex=r"^https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$",
        allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"])

    @app.post("/bridge/identify")
    def identify(request: IdentifyRequest) -> dict[str, str]:
        # Unauthenticated on purpose: lets a starting editor recognise this bridge and
        # check it holds the same token without sending the token (agent_bridge.probe).
        from .agent_bridge import SERVICE, proof
        return {"service": SERVICE, "proof": proof(token, request.nonce)}

    @app.post("/bridge/poll", dependencies=authorized)
    def poll(presence: WorkbookPresence) -> dict[str, Any]:
        try:
            return bridge.poll(presence)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @app.post("/bridge/reply", dependencies=authorized)
    def reply(message: CommandReply) -> dict[str, bool]:
        try:
            bridge.reply(message)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        return {"accepted": True}

    @app.post("/bridge/unshare", dependencies=authorized)
    def unshare(handle: WorkbookHandle) -> dict[str, bool]:
        bridge.remove(handle.workbook, "User stopped sharing the workbook", revoke=True)
        return {"shared": False}

    return app
