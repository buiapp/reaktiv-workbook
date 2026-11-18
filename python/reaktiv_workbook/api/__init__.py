"""The kernel's HTTP interface: FastAPI on Uvicorn.

Only CPython hosts import this package (CLI sessions, embedded ``WorkbookSession`` editors,
remote kernels); the browser's Pyodide runtime never does. The workbook itself runs in
:class:`~reaktiv_workbook.runtime.RuntimeServer`; this package is transport: validation,
authentication, CORS, error replies, static files, and the server's lifecycle.
"""

from .app import create_app
from .config import KernelSettings

__all__ = ["KernelSettings", "create_app"]
