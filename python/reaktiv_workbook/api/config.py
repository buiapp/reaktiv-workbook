"""Settings of one kernel HTTP server.

They come from the command line (``python -m reaktiv_workbook.server``) or from the embedding
script, not from the environment, so a frozen dataclass is enough; ``REAKTIV_KERNEL_TOKEN`` is
read by the command line where it is a flag default.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Bounded transport budget, including large input literals and JSON escaping.
#: Session applies may carry both cell definitions and workbook metadata.
MAX_BODY_BYTES = 64_000_000


@dataclass(frozen=True)
class KernelSettings:
    #: Every request must carry ``Authorization: Bearer <token>``; None allows all (loopback).
    token: str | None = None
    #: ``Access-Control-Allow-Origin`` for the app's origin.
    allow_origin: str = "*"
    max_body_bytes: int = MAX_BODY_BYTES
    #: Serve ``/docs`` and ``/openapi.json`` (off unless asked for).
    docs: bool = False
