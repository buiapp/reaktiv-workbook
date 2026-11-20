"""The kernel's endpoints.

Every route validates its request (``schemas``) and hands it to the runtime's single execution
boundary, :meth:`RuntimeServer.dispatch` — which serializes workbook updates, and in an embedded
session runs them on the script's own loop with its revision checks. Routes are grouped by how
they run:

- **control** (``async``): progress, usage, interrupt. Quick, never wait for the workbook, and run
  on the event loop, so they answer even when every worker thread waits for a long update.
- **analysis** (``def``, worker threads): type checks, editor queries, reading and checking files,
  moving cell sources. They never take the workbook lock, but may take a while (pyright).
- **workbook** (``def``, worker threads): submit to the graph owner loop. Structural
  changes wait for active invocations; async actions and literal input updates coexist.

Large results (graph snapshots with plots and tables) are returned as ``JSONResponse`` without a
response model, so they are serialized once, not validated and re-encoded first.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from ..output_transport import pack_outputs
from .dependencies import RuntimeDep, require_token
from .schemas import (
    ApplyRequest,
    UpdateActionRequest,
    ActionRequest,
    ActionInputsRequest,
    SetInputsRequest,
    CellRequest,
    CheckRequest,
    ConsoleRequest,
    EditorRequest,
    EmptyRequest,
    FilesRequest,
    GitRequest,
    ErrorResponse,
    Health,
    InspectRequest,
    InterruptResult,
    MoveCellsRequest,
    MoveWorkbookRequest,
    Progress,
    ProgressRequest,
    RequestModel,
    ResampleRequest,
    SessionRequest,
    SessionRestartRequest,
    SessionSaveRequest,
    VerifyRequest,
    WidgetMessageRequest,
    WidgetUpdateRequest,
)

ERRORS: dict[int | str, dict[str, Any]] = {
    status.HTTP_400_BAD_REQUEST: {"model": ErrorResponse, "description": "Invalid request, or refused by the engine"},
    status.HTTP_401_UNAUTHORIZED: {"model": ErrorResponse, "description": "Missing or invalid kernel token"},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse, "description": "Unknown cell, sheet, or chart"},
}
GRAPH = {"description": "The workbook's results (GraphResult: cells, dependencies, effects, logs, …)"}

router = APIRouter(dependencies=[Depends(require_token)], responses=ERRORS)
control = APIRouter(prefix="/v1", tags=["control"])
analysis = APIRouter(prefix="/v1", tags=["analysis"])
workbook = APIRouter(prefix="/v1", tags=["workbook"])
session = APIRouter(prefix="/v1", tags=["embedded session"])


def _run(runtime: RuntimeDep, path: str, request: RequestModel) -> JSONResponse:
    return JSONResponse(pack_outputs(runtime.dispatch(path, request.payload()), request.known_outputs))


@router.get("/health", tags=["control"], summary="The kernel answers")
async def health() -> Health:
    return Health(status="ok", runtime="reaktiv-workbook", pid=os.getpid())


# -- control ------------------------------------------------------------------------------


@control.post("/usage", summary="CPU and memory of the kernel process")
async def usage(runtime: RuntimeDep, request: EmptyRequest) -> dict[str, Any]:
    result: dict[str, Any] = runtime.dispatch("/v1/usage", request.payload())
    return result


@control.post("/progress", summary="Cells that started and finished since an event number")
async def progress(runtime: RuntimeDep, request: ProgressRequest) -> Progress:
    return Progress.model_validate(pack_outputs(runtime.dispatch("/v1/progress", request.payload()), request.known_outputs))


@control.post(
    "/interrupt",
    summary="Stop the cell that is running",
    description="Raises CellInterrupted in the running cell; it stays stopped until applied again.",
)
async def interrupt(runtime: RuntimeDep, request: EmptyRequest) -> InterruptResult:
    return InterruptResult.model_validate(runtime.dispatch("/v1/interrupt", request.payload()))


# -- analysis -----------------------------------------------------------------------------


@analysis.post("/check", summary="Type-check the workbook with pyright")
def check(runtime: RuntimeDep, request: CheckRequest) -> JSONResponse:
    return _run(runtime, "/v1/check", request)


@analysis.post("/editor", summary="Completion, hover, and signature help for a cell's code")
def editor(runtime: RuntimeDep, request: EditorRequest) -> JSONResponse:
    return _run(runtime, "/v1/editor", request)


@analysis.post("/inspect-document", summary="Read a .sheet.py file as a workbook document")
def inspect_document(runtime: RuntimeDep, request: InspectRequest) -> JSONResponse:
    return _run(runtime, "/v1/inspect-document", request)


@analysis.post("/verify-document", summary="Problems that would make a file differ from the workbook")
def verify_document(runtime: RuntimeDep, request: VerifyRequest) -> JSONResponse:
    return _run(runtime, "/v1/verify-document", request)


@analysis.post("/move-cells", summary="Cells with references rewritten for a move")
def move_cells(runtime: RuntimeDep, request: MoveCellsRequest) -> JSONResponse:
    return _run(runtime, "/v1/move-cells", request)


@workbook.post("/move-workbook", summary="Move live cells and evaluate once")
def move_workbook(runtime: RuntimeDep, request: MoveWorkbookRequest) -> JSONResponse:
    return _run(runtime, "/v1/move-workbook", request)


# -- workbook -----------------------------------------------------------------------------


@workbook.post("/apply", summary="Apply cell definitions and evaluate", responses={200: GRAPH})
def apply(runtime: RuntimeDep, request: ApplyRequest) -> JSONResponse:
    return _run(runtime, "/v1/apply", request)


@workbook.post("/update-action", summary="Validate and install one action without invoking it", responses={200: GRAPH})
def update_action(runtime: RuntimeDep, request: UpdateActionRequest) -> JSONResponse:
    return _run(runtime, "/v1/update-action", request)


@workbook.post('/run-action', summary='Invoke an exposed model method', responses={200: GRAPH})
def run_action(runtime: RuntimeDep, request: ActionRequest) -> JSONResponse:
    return _run(runtime, '/v1/run-action', request)


@control.post('/action-inputs', summary='Queue literal widget inputs for the running action owner')
async def action_inputs(runtime: RuntimeDep, request: ActionInputsRequest) -> JSONResponse:
    return _run(runtime, '/v1/action-inputs', request)


@control.post('/cancel-action', summary='Cancel an asynchronous action without waiting for the workbook lock')
async def cancel_action(runtime: RuntimeDep, request: ActionRequest) -> JSONResponse:
    return _run(runtime, '/v1/cancel-action', request)


@control.post('/cancel-resource', summary='Cancel one resource load without waiting for the workbook lock')
async def cancel_resource(runtime: RuntimeDep, request: CellRequest) -> JSONResponse:
    return _run(runtime, '/v1/cancel-resource', request)


@workbook.post("/run-effect", summary="Run an effect now", responses={200: GRAPH})
def run_effect(runtime: RuntimeDep, request: CellRequest) -> JSONResponse:
    return _run(runtime, "/v1/run-effect", request)


@workbook.post("/tick-timer", summary="Tick a clock cell", responses={200: GRAPH})
def tick_timer(runtime: RuntimeDep, request: CellRequest) -> JSONResponse:
    return _run(runtime, "/v1/tick-timer", request)


@workbook.post("/widget-update", summary="State changed in a widget's view", responses={200: GRAPH})
def widget_update(runtime: RuntimeDep, request: WidgetUpdateRequest) -> JSONResponse:
    return _run(runtime, "/v1/widget-update", request)


@workbook.post("/widget-message", summary="A custom message from a widget's view", responses={200: GRAPH})
def widget_message(runtime: RuntimeDep, request: WidgetMessageRequest) -> JSONResponse:
    return _run(runtime, "/v1/widget-message", request)


@workbook.post("/resample", summary="The points of a resampled chart in its visible range")
def resample(runtime: RuntimeDep, request: ResampleRequest) -> JSONResponse:
    return _run(runtime, "/v1/resample", request)


@workbook.post("/clear-logs", summary="Forget the logs", responses={200: GRAPH})
def clear_logs(runtime: RuntimeDep, request: EmptyRequest) -> JSONResponse:
    return _run(runtime, "/v1/clear-logs", request)


@workbook.post("/console", summary="Run temporary Python with the latest values")
def console(runtime: RuntimeDep, request: ConsoleRequest) -> JSONResponse:
    return _run(runtime, "/v1/console", request)


@workbook.post("/cell-memory", summary="Estimated memory of evaluated values")
def cell_memory(runtime: RuntimeDep, request: EmptyRequest) -> JSONResponse:
    return _run(runtime, "/v1/cell-memory", request)


@workbook.post("/restart", summary="Start over with an empty workbook")
def restart(runtime: RuntimeDep, request: EmptyRequest) -> JSONResponse:
    return _run(runtime, "/v1/restart", request)


# -- embedded session (WorkbookSession editors; other kernels answer 404) ---------------------


@session.post("/session", summary="The script's workbook, or null when the revision is current")
def session_state(runtime: RuntimeDep, request: SessionRequest) -> JSONResponse:
    return _run(runtime, "/v1/session", request)


@session.post("/session-save", summary="Apply the editor's workbook and save it to the script's file")
def session_save(runtime: RuntimeDep, request: SessionSaveRequest) -> JSONResponse:
    return _run(runtime, "/v1/session-save", request)


@session.post("/session-restart", summary="Restart the CLI session's Python with the editor's workbook and its packages")
def session_restart(runtime: RuntimeDep, request: SessionRestartRequest) -> JSONResponse:
    return _run(runtime, "/v1/session-restart", request)


@session.post('/git', summary="Run an allowed git command in the workbook's folder (CLI sessions)")
def git(runtime: RuntimeDep, request: GitRequest) -> JSONResponse:
    return _run(runtime, '/v1/git', request)


@session.post('/files', summary='List a folder for the file/folder picker (CLI sessions)')
def files(runtime: RuntimeDep, request: FilesRequest) -> JSONResponse:
    return _run(runtime, '/v1/files', request)


@session.post('/session-reset-input', summary='Reset a linked input in the live session')
def session_reset_input(runtime: RuntimeDep, request: CellRequest) -> JSONResponse:
    return _run(runtime, '/v1/session-reset-input', request)




@workbook.post('/set-inputs', summary='Update literal input values without recompiling the workbook', responses={200: GRAPH})
def set_inputs(runtime: RuntimeDep, request: SetInputsRequest) -> JSONResponse:
    return _run(runtime, '/v1/set-inputs', request)

for group in (control, analysis, workbook, session):
    router.include_router(group)
