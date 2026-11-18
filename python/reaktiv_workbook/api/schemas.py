"""Request and response models of the kernel API.

JSON keys are camelCase (the app's convention); unknown keys are refused so a misspelt field is
an error, not a silently ignored setting. Workbook shapes (cells, documents) stay plain objects
here: the engine validates them (``CellDefinition`` / ``SheetDocument.from_dict``) and is the one
place that knows them, so the two can never drift apart.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

#: A cell definition or a workbook document as the app sends it (checked by the engine).
WorkbookObject = dict[str, Any]


class RequestModel(BaseModel):
    """Every request may carry the revision of an embedded session it was made against."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    session_revision: int | None = None
    known_outputs: list[str] | None = Field(default=None, max_length=128)

    def payload(self) -> dict[str, Any]:
        """The request as the runtime reads it: camelCase keys, only the fields that were sent
        (a missing ``stopped`` or ``ranges`` means "unchanged", unlike an empty one)."""
        return self.model_dump(by_alias=True, exclude_unset=True, exclude={"known_outputs"})


class EmptyRequest(RequestModel):
    pass


class ProgressRequest(RequestModel):
    #: The last event number the client has; without it only the current number is returned.
    after: int | None = None


class ConsoleRequest(RequestModel):
    source: str
    sheet: str


class EditorPosition(BaseModel):
    line: int = Field(ge=0)
    character: int = Field(ge=0)


class EditorRequest(RequestModel):
    document: WorkbookObject
    sheet: str
    source: str
    position: EditorPosition
    action: Literal["completion", "hover", "signatureHelp", "completionResolve"]
    completion_key: str = ""


class CheckRequest(RequestModel):
    document: WorkbookObject
    mode: Literal["standard", "strict"] = "standard"


class InspectRequest(RequestModel):
    source: str


class VerifyRequest(RequestModel):
    source: str
    document: WorkbookObject


class UpdateActionRequest(RequestModel):
    definition: WorkbookObject
    expected_revision: str


class ApplyRequest(RequestModel):
    enable_update_tracing: bool = False
    #: The cells to apply (a standalone kernel needs them; an embedded session takes ``document``).
    cells: list[WorkbookObject] | None = None
    actions: list[WorkbookObject] = Field(default_factory=list[WorkbookObject])
    #: The whole workbook (embedded sessions load it as the script's document).
    document: WorkbookObject | None = None
    sheets: list[str] | None = None
    allow_cell_writes: bool = True
    variables: dict[str, str] = Field(default_factory=dict[str, str])
    imports: list[str] = Field(default_factory=list[str])
    code: str | None = None
    #: Cells kept stopped; missing: unchanged.
    stopped: list[str] | None = None


class CellRequest(RequestModel):
    cell_id: str


class GitRequest(RequestModel):
    #: A git command (subcommand first); the server allows a fixed set and runs it in
    #: the workbook's folder.
    args: list[str] = Field(min_length=1, max_length=256)


class FilesRequest(RequestModel):
    #: Folder to list (a file lists its folder); default: the workbook's folder.
    path: str | None = Field(default=None, max_length=4096)
    #: Include dot files and folders.
    hidden: bool = False


class WidgetUpdateRequest(RequestModel):
    cell_id: str
    state: dict[str, Any]
    model_id: str | None = None


class WidgetMessageRequest(RequestModel):
    cell_id: str
    content: Any = None
    buffers: list[Any] = Field(default_factory=list[Any])
    model_id: str | None = None


class ResampleRequest(RequestModel):
    token: str
    #: Axis -> [low, high] or None for the whole axis.
    ranges: dict[str, Any] | None = None


class MoveCellsRequest(RequestModel):
    cells: list[WorkbookObject]
    source_id: str
    target_id: str
    #: Several cells moved together by the offset source -> target.
    source_ids: list[str] | None = None
    sheets: list[str] | None = None


class MoveWorkbookRequest(RequestModel):
    expected_revision: str
    source_id: str
    target_id: str
    source_ids: list[str] | None = None


class SessionRequest(RequestModel):
    #: The revision the client has; unchanged sessions answer ``null``.
    after: int | None = None


class SessionSaveRequest(RequestModel):
    document: WorkbookObject
    save_outputs: bool = True
    assets: dict[str, str] = Field(default_factory=dict[str, str])


class Health(BaseModel):
    status: Literal["ok"]
    runtime: Literal["reaktiv-workbook"]
    pid: int


class InterruptResult(BaseModel):
    interrupted: bool


class ProgressEvent(BaseModel):
    seq: int
    event: Literal["start", "end"]
    cell_id: str = Field(alias="cellId")


class Progress(BaseModel):
    seq: int
    events: list[ProgressEvent]
    logs: list[dict[str, Any]] = Field(default_factory=list[dict[str, Any]])
    snapshot: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    """Every failure: ``{"error": "..."}`` (the app shows the message)."""

    error: str


class ActionInputsRequest(RequestModel):
    run_id: str = Field(min_length=1, max_length=128)
    sources: dict[str, str]


class ActionRequest(RequestModel):
    run_id: str | None = None
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict[str, Any])


class SetInputsRequest(RequestModel):
    sources: dict[str, str]
