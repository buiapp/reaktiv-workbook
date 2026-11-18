"""Dependencies of the kernel routes: the runtime the app serves, and the bearer token."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status

from ..runtime import RuntimeServer
from .config import KernelSettings


async def get_settings(request: Request) -> KernelSettings:
    settings: KernelSettings = request.app.state.settings
    return settings


async def get_runtime(request: Request) -> RuntimeServer:
    runtime: RuntimeServer = request.app.state.runtime
    return runtime


SettingsDep = Annotated[KernelSettings, Depends(get_settings)]
RuntimeDep = Annotated[RuntimeServer, Depends(get_runtime)]


async def require_token(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """With a token configured, every request must carry ``Authorization: Bearer <token>``."""
    if settings.token is None:
        return
    supplied = (authorization or "").encode()
    if not hmac.compare_digest(supplied, f"Bearer {settings.token}".encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid kernel token")
