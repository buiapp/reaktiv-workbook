"""Generated file values that can flow through a reactive workbook."""

from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import io
import mimetypes
import re
from typing import Any, Optional, Union


MAX_ARTIFACT_BYTES = 20 * 1024 * 1024
_MEDIA_TYPE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$"
)


@dataclass(frozen=True)
class Artifact:
    """An immutable generated file stored as a cell value.

    Artifacts are runtime outputs. The workbook stores the Python that generates
    them rather than embedding their bytes in the ``.sheet.py`` source.
    """

    data: bytes
    filename: str
    media_type: str = "application/octet-stream"

    def __post_init__(self) -> None:
        data = bytes(self.data)
        filename = self.filename.strip()
        media_type = self.media_type.strip().lower()
        if (
            not filename
            or filename in {".", ".."}
            or "/" in filename
            or "\\" in filename
        ):
            raise ValueError("Artifact filename must be a plain non-empty filename")
        if not _MEDIA_TYPE.fullmatch(media_type):
            raise ValueError(f"Invalid artifact media type: {self.media_type!r}")
        if len(data) > MAX_ARTIFACT_BYTES:
            raise ValueError(
                f"Artifact {filename!r} is larger than the {MAX_ARTIFACT_BYTES // (1024 * 1024)} MiB limit"
            )
        object.__setattr__(self, "data", data)
        object.__setattr__(self, "filename", filename)
        object.__setattr__(self, "media_type", media_type)

    @property
    def size(self) -> int:
        return len(self.data)

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    @property
    def is_image(self) -> bool:
        return self.media_type.startswith("image/")

    def to_payload(self) -> dict[str, Any]:
        """Return the JSON transport representation used by GUI consumers."""

        return {
            "filename": self.filename,
            "mimeType": self.media_type,
            "size": self.size,
            "sha256": self.digest,
            "dataBase64": base64.b64encode(self.data).decode("ascii"),
        }

    def to_markdown(self, link: Optional[str] = None) -> str:
        """Render images inline when interpolated into a Markdown cell.

        With ``link`` the image points at that URL instead of embedding its bytes.
        """

        if not self.is_image:
            return self.filename
        if link is not None:
            return f"![{_escape_markdown(self.filename)}]({link})"
        encoded = base64.b64encode(self.data).decode("ascii")
        return f"![{_escape_markdown(self.filename)}](data:{self.media_type};base64,{encoded})"

    @classmethod
    def text(
        cls,
        text: str,
        filename: str,
        media_type: str = "text/plain",
        encoding: str = "utf-8",
    ) -> "Artifact":
        return cls(text.encode(encoding), filename, media_type)

    def __str__(self) -> str:
        return self.filename


def artifact(
    data: Union[bytes, bytearray, memoryview, io.BytesIO, str],
    filename: str,
    media_type: Optional[str] = None,
) -> Artifact:
    """Create an artifact from bytes, a byte buffer, or UTF-8 text."""

    if isinstance(data, str):
        raw = data.encode("utf-8")
        resolved_type = media_type or "text/plain"
    elif isinstance(data, io.BytesIO):
        raw = data.getvalue()
        resolved_type = media_type
    else:
        raw = bytes(data)
        resolved_type = media_type
    if resolved_type is None:
        resolved_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Artifact(raw, filename, resolved_type)


def _escape_markdown(value: str) -> str:
    return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
