"""Safe rich-display extraction for cell values."""

from __future__ import annotations

import base64
import io
import json
from typing import Any, Optional, cast

from . import widgets as _widgets
from .narrowing import as_dict


_IMAGE_MIME_TYPES = ("image/svg+xml", "image/png", "image/jpeg", "image/webp")
# Plotly figures travel as their JSON spec and are drawn interactively by the app
# (plotly.js); static images would need kaleido, which is not available everywhere.
PLOTLY_MIME_TYPE = "application/vnd.plotly.v1+json"
# anywidget (https://anywidget.dev) instances: their ES module, CSS, and synced state; the
# app hosts them like Jupyter does.
ANYWIDGET_MIME_TYPE = "application/vnd.anywidget+json"
# HTML (`html(...)` or any `_repr_html_`): sanitised and shown in a shadow root by the app.
# DataFrames keep their table rendering.
HTML_MIME_TYPE = "text/html"
_WIDGET_INTERNAL_TRAITS = frozenset(
    {"_anywidget_id", "_esm", "_css", "_dom_classes", "layout", "tabbable", "tooltip", "comm", "keys", "log"}
)



def is_anywidget(value: Any) -> bool:
    """An anywidget instance (duck-typed: an ipywidget with an `_esm` module). The class
    itself (a cell that defines the widget class) is not a widget."""
    if isinstance(value, type):
        return False
    if _widgets.is_widget(value):
        return True
    return hasattr(value, "_esm") and callable(getattr(value, "get_state", None)) and callable(
        getattr(value, "trait_names", None)
    )


def anywidget_state_keys(value: Any) -> list[str]:
    return [
        name
        for name in value.trait_names(sync=True)
        if name not in _WIDGET_INTERNAL_TRAITS and not name.startswith(("_model_", "_view_"))
    ]


def _anywidget_json(value: Any) -> Optional[str]:
    model_id = _widgets.model_id_of(value)
    if model_id is not None and "_esm" in _widgets.registry.models[model_id].state:
        return json.dumps(_widgets.payload(model_id), default=str)
    if not is_anywidget(value):
        return None
    css = getattr(value, "_css", None)
    return json.dumps(
        {
            "esm": str(value._esm),
            "css": "" if css is None else str(css),
            "state": value.get_state(anywidget_state_keys(value)),
        },
        default=str,
    )
_MAX_RICH_OUTPUT_BYTES = 20 * 1024 * 1024


def rich_output_payload(value: Any) -> Optional[dict[str, Any]]:
    """Return a transportable image representation when ``value`` provides one."""

    if isinstance(value, type):
        return None  # a class (e.g. a widget class cell), not something to display
    widget = _anywidget_json(value)
    if widget is not None:
        return _image_payload(ANYWIDGET_MIME_TYPE, widget.encode("utf-8"), encoded=False)

    plotly = _resampled_json(value) or _plotly_json(value)
    if plotly is not None:
        return _image_payload(PLOTLY_MIME_TYPE, plotly.encode("utf-8"), encoded=False)

    bundle = _mime_bundle(value)
    if PLOTLY_MIME_TYPE in bundle:
        return _image_payload(PLOTLY_MIME_TYPE, json.dumps(bundle[PLOTLY_MIME_TYPE]).encode("utf-8"), encoded=False)
    for mime_type in _IMAGE_MIME_TYPES:
        if mime_type in bundle:
            return _image_payload(mime_type, bundle[mime_type], encoded=True)

    for method_name, mime_type in (
        ("_repr_svg_", "image/svg+xml"),
        ("_repr_png_", "image/png"),
        ("_repr_jpeg_", "image/jpeg"),
    ):
        method = getattr(value, method_name, None)
        if callable(method):
            rendered = method()
            if rendered is not None:
                return _image_payload(mime_type, rendered, encoded=False)

    figure = _matplotlib_figure(value)
    if figure is not None:
        output = io.BytesIO()
        figure.savefig(output, format="png", dpi=144, bbox_inches="tight")
        return _image_payload("image/png", output.getvalue(), encoded=False)

    markup = bundle.get(HTML_MIME_TYPE) if isinstance(bundle.get(HTML_MIME_TYPE), str) else _html_markup(value)
    if markup is not None:
        return _image_payload(HTML_MIME_TYPE, markup.encode("utf-8"), encoded=False)
    return None


def _html_markup(value: Any) -> Optional[str]:
    """``_repr_html_`` of a value, except tables (DataFrame, Series), which notes render
    from their table payload."""
    if type(value).__module__.startswith("pandas") and type(value).__name__ in ("DataFrame", "Series"):
        return None  # the same test as tables.table_payload
    method = getattr(value, "_repr_html_", None)
    if not callable(method):
        return None
    rendered = method()
    return rendered if isinstance(rendered, str) else None


def rich_output_markdown(value: Any) -> Optional[str]:
    """Render a rich image value as self-contained Markdown."""

    if isinstance(value, type):
        return None  # a class (e.g. a widget class cell), not something to display
    payload = rich_output_payload(value)
    if payload is None:
        return None
    if payload["mimeType"] == ANYWIDGET_MIME_TYPE:
        return "*Interactive widget*"
    if payload["mimeType"] == HTML_MIME_TYPE:
        # Markdown allows HTML: self-contained notes (CLI --note, --export) carry it as is.
        return base64.b64decode(payload["dataBase64"]).decode("utf-8")
    if payload["mimeType"] == PLOTLY_MIME_TYPE:
        # The app draws this interactively in notes and turns it into PNG for exports.
        return f"![Chart](data:{PLOTLY_MIME_TYPE};base64,{payload['dataBase64']})"
    return (
        f"![Plot](data:{payload['mimeType']};base64,{payload['dataBase64']})"
    )


def _resampled_json(value: Any) -> Optional[str]:
    """A figure shown resampled (resample.py): ``resampled(fig)``, or a plotly figure with a
    trace too long to send whole (ADC captures) — zooming fetches the real samples."""
    from .resample import ResampledFigure, resampled, should_resample

    if isinstance(value, ResampledFigure):
        return value.spec()
    if type(value).__module__.startswith("plotly.") and should_resample(value):
        existing = getattr(value, "_reaktiv_resampled", None)
        return (existing if isinstance(existing, ResampledFigure) else resampled(value)).spec()
    return None


def _plotly_json(value: Any) -> Optional[str]:
    """The JSON spec of a plotly Figure (plotly's encoder handles numpy and dates)."""
    if not type(value).__module__.startswith("plotly."):
        return None
    to_json = getattr(value, "to_json", None)
    spec: object = to_json() if callable(to_json) else None
    return spec if isinstance(spec, str) else None  # anything else is not a spec we can send


def _mime_bundle(value: Any) -> dict[str, Any]:
    method = getattr(value, "_repr_mimebundle_", None)
    if not callable(method):
        return {}
    rendered: object = method()
    if isinstance(rendered, tuple):
        rendered = cast(tuple[object, ...], rendered)[0]
    return as_dict(rendered) or {}


def _image_payload(mime_type: str, data: Any, *, encoded: bool) -> dict[str, Any]:
    if mime_type == "image/svg+xml":
        raw = data.encode("utf-8") if isinstance(data, str) else bytes(data)
    elif encoded and isinstance(data, str):
        raw = base64.b64decode(data, validate=True)
    else:
        raw = bytes(data)
    if len(raw) > _MAX_RICH_OUTPUT_BYTES:
        raise ValueError("Rich display output is larger than the 20 MiB limit")
    return {
        "mimeType": mime_type,
        "dataBase64": base64.b64encode(raw).decode("ascii"),
    }


def _matplotlib_figure(value: Any) -> Any:
    module = type(value).__module__
    if module.startswith("matplotlib.figure") and callable(
        getattr(value, "savefig", None)
    ):
        return value
    if module.startswith("matplotlib.axes"):
        figure = getattr(value, "figure", None)
        if callable(getattr(figure, "savefig", None)):
            return figure
    return None
