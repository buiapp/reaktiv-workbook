"""Own the lifetime of prepared cell outputs, independently of graph execution."""
from __future__ import annotations

import base64
import json
from collections.abc import Callable, Mapping
from time import perf_counter
from typing import Any

from .artifact import Artifact
from .rich_output import ANYWIDGET_MIME_TYPE, is_anywidget, rich_output_payload
from .tables import table_payload
from .update_trace import UpdateTrace
from .value_encoding import snapshot_value
from .widgets import model_id_of

type Payload = dict[str, Any]
type CachedOutput = tuple[Any, Payload | None]


class CellOutputs:
    """Cache by value identity; widget state is mutable and always refreshed.

    The workbook calls ``discard`` when a cell changes or fails. No cache method
    reads a signal, executes code or retains a history of prior values.
    """

    def __init__(
        self,
        trace: UpdateTrace,
        bindings: Callable[[str], Mapping[str, str] | None],
    ) -> None:
        self._trace = trace
        self._bindings = bindings
        self._rich: dict[str, CachedOutput] = {}
        self._tables: dict[str, CachedOutput] = {}

    def discard(self, cell_id: str) -> None:
        self._rich.pop(cell_id, None)
        self._tables.pop(cell_id, None)

    def clear(self) -> None:
        self._rich.clear()
        self._tables.clear()

    def rich(self, cell_id: str, value: Any) -> Payload | None:
        cached = self._rich.get(cell_id)
        if cached is not None and cached[0] is value and not is_anywidget(value):
            if cached[1] is not None and self._trace.enabled:
                # Preparation in a note earlier in this update wins over reuse.
                self._trace.outputs.setdefault(cell_id, "reused")
            return cached[1]
        payload = None if isinstance(value, Artifact) else rich_output_payload(value)
        if payload is not None and payload["mimeType"] == ANYWIDGET_MIME_TYPE:
            bindings = self._bindings(model_id_of(value) or "")
            if bindings:
                spec = json.loads(base64.b64decode(payload["dataBase64"]))
                spec["bindings"] = bindings
                payload = {
                    **payload,
                    "dataBase64": base64.b64encode(json.dumps(spec, default=str).encode()).decode(),
                }
        self._rich[cell_id] = (value, payload)
        if payload is not None and self._trace.enabled:
            self._trace.outputs[cell_id] = "prepared"
        return payload

    def table(self, cell_id: str, value: Any) -> Payload | None:
        cached = self._tables.get(cell_id)
        if cached is not None and cached[0] is value:
            return cached[1]
        payload = None if isinstance(value, (Artifact, str)) else table_payload(value)
        self._tables[cell_id] = (value, payload)
        return payload

    def snapshot(
        self,
        cell_id: str,
        value: Any,
        *,
        value_type: str | None = None,
        resource_status: str | None = None,
        duration_ms: float | None = None,
    ) -> Payload:
        # Deliberately excludes the graph read; this measures output preparation.
        started = perf_counter()
        result = snapshot_value(
            cell_id, value, value_type=value_type,
            resource_status=resource_status, duration_ms=duration_ms,
            rich_output=self.rich(cell_id, value), table=self.table(cell_id, value),
        )
        result["outputPreparationMs"] = round((perf_counter() - started) * 1000, 3)
        return result
