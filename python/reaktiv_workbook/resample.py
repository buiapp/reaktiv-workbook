"""Plotly figures with more points than a browser can take.

A figure whose scatter traces are long (ADC captures, high sample rates) keeps its full data in
Python; the chart receives at most about ``2 * points`` points per trace — the first and last
point and the minimum and maximum of each bucket, so peaks and glitches stay visible. When the
user zooms or pans, the chart asks for the visible range (``view``) and gets the real samples of
it, down to every single one.

- ``resampled(fig, points=2000)`` makes any figure behave like this.
- Figures with a trace longer than ``AUTO_POINTS`` are resampled automatically
  (``rich_output.py``), so ``px.line(x=t, y=signal)`` just works.

The resampled figure lives as long as the cell's value (it is attached to the plotly figure), and
is found by a token the chart sends back (``view``).
"""

from __future__ import annotations

import uuid
import weakref
from typing import TYPE_CHECKING, Any, Callable, Mapping, Optional, cast

if TYPE_CHECKING:
    import numpy as np
else:  # imported on first use: numpy is optional (optional.py)
    from .optional import numpy as np

from .narrowing import as_dict, as_sequence

#: Buckets per trace: the chart shows up to about twice as many points.
DISPLAY_POINTS = 2000
#: Traces longer than this are resampled automatically.
AUTO_POINTS = 50_000
_RESAMPLED_TYPES = {"scatter", "scattergl"}
_registry: "weakref.WeakValueDictionary[str, ResampledFigure]" = weakref.WeakValueDictionary()


def resampled(figure: Any, points: int = DISPLAY_POINTS) -> "ResampledFigure":
    """``figure`` (a plotly Figure) with its long traces resampled for display; zooming shows
    the full data of the visible range."""
    return ResampledFigure(figure, points)


def should_resample(figure: Any) -> bool:
    """A plotly figure with a scatter trace longer than ``AUTO_POINTS``."""
    for trace in getattr(figure, "data", ()):
        if getattr(trace, "type", None) in _RESAMPLED_TYPES and _length(getattr(trace, "y", None)) > AUTO_POINTS:
            return True
    return False


def view(token: str, ranges: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
    """The points of each resampled trace inside ``ranges`` (``{"x": [x0, x1], "x2": None}``,
    None: the whole axis), as Plotly restyle data."""
    figure = _registry.get(token)
    if figure is None:
        raise KeyError("This chart changed; its data is no longer here")
    return figure.view(ranges or {})


def _length(values: Any) -> int:
    try:
        return len(values) if values is not None else 0
    except TypeError:
        return 0


class _Trace:
    def __init__(self, index: int, trace: Any) -> None:
        self.index = index
        self.axis = str(getattr(trace, "xaxis", None) or "x")
        self.y = np.asarray(trace.y)
        self.x = np.asarray(trace.x) if trace.x is not None else np.arange(len(self.y))
        self.n = len(self.y)
        self.json = trace.to_plotly_json()
        numeric_x = np.issubdtype(self.x.dtype, np.number) or np.issubdtype(self.x.dtype, np.datetime64)
        self.sorted = numeric_x and len(self.x) == self.n and bool(np.all(self.x[1:] >= self.x[:-1]))
        self.numeric_y = np.issubdtype(self.y.dtype, np.number)

    def indices(self, value_range: Optional[Any], points: int) -> tuple[np.ndarray, int]:
        """The points to show for ``value_range`` and how many points the range holds."""
        bounds = as_sequence(value_range)
        if bounds is None or len(bounds) != 2:  # None, or not a [low, high] pair: the whole axis
            value_range = None
        if value_range is None or bounds is None:
            start, stop = 0, self.n
            window = None
            inside = self.n
        elif self.sorted:
            low, high = _coerce(bounds[0], self.x.dtype), _coerce(bounds[1], self.x.dtype)
            first = int(np.searchsorted(self.x, low, side="left"))
            last = int(np.searchsorted(self.x, high, side="right"))
            # One point beyond each edge, so lines run to the chart's edges.
            start, stop = max(0, first - 1), min(self.n, last + 1)
            window = None
            inside = last - first
        else:  # unsorted x: the points inside the range, in their order
            low, high = _coerce(bounds[0], self.x.dtype), _coerce(bounds[1], self.x.dtype)
            window = np.nonzero((self.x >= low) & (self.x <= high))[0]
            start, stop = 0, len(window)
            inside = len(window)
        if not self.numeric_y:
            chosen = np.linspace(start, stop - 1, min(stop - start, 2 * points)).astype(int) if stop > start else np.arange(0)
        else:
            values = self.y if window is None else self.y[window]
            chosen = minmax_indices(values, start, stop, points)
        return (chosen if window is None else window[chosen]), inside

    def patch(self, ids: np.ndarray) -> dict[str, Any]:
        """Every per-point array of the trace (x, y, colours, hover text, …) at ``ids``."""
        patch: dict[str, Any] = {}
        _collect(self.json, ids, self.n, "", patch)
        patch["x"] = self.x[ids]
        patch["y"] = self.y[ids]
        return patch


def minmax_indices(y: np.ndarray, start: int, stop: int, buckets: int) -> np.ndarray:
    """Indices in ``[start, stop)`` that keep the shape of ``y``: the first and last point and the
    minimum and maximum of each of ``buckets`` equal buckets (NaN ignored)."""
    count = stop - start
    if count <= 2 * buckets:
        return np.arange(start, stop)
    size = count // buckets
    usable = size * buckets
    block = np.asarray(y[start : start + usable], dtype=float).reshape(buckets, size)
    nan = np.isnan(block)
    low = np.argmin(np.where(nan, np.inf, block), axis=1)
    high = np.argmax(np.where(nan, -np.inf, block), axis=1)
    base = start + np.arange(buckets) * size
    return np.unique(np.concatenate([[start], base + low, base + high, [stop - 1]]))


def _coerce(bound: Any, dtype: np.dtype[Any]) -> "float | np.datetime64":
    if np.issubdtype(dtype, np.datetime64):
        return np.datetime64(str(bound).replace(" ", "T"))
    return float(bound)


def _collect(value: Any, ids: np.ndarray, n: int, path: str, patch: dict[str, Any]) -> None:
    settings = as_dict(value)
    if settings is not None:
        for key, item in settings.items():
            if key not in ("x", "y") or path:
                _collect(item, ids, n, f"{path}.{key}" if path else key, patch)
        return
    if isinstance(value, np.ndarray):  # per-point arrays stay arrays (millions of points)
        array = cast("np.ndarray[Any, Any]", value)
        if len(array) == n and path:
            patch[path] = array[ids]
        return
    points = as_sequence(value)
    if points is not None and len(points) == n and path:
        patch[path] = np.asarray(points)[ids]


class ResampledFigure:
    """A plotly figure shown resampled (see the module docs). Displays as its resampled spec."""

    def __init__(self, figure: Any, points: int = DISPLAY_POINTS) -> None:
        self.figure = figure
        self.points = max(10, int(points))
        self.token = uuid.uuid4().hex
        self.traces = [
            _Trace(index, trace)
            for index, trace in enumerate(figure.data)
            if getattr(trace, "type", None) in _RESAMPLED_TYPES and trace.y is not None and _length(trace.y) > 2 * self.points
        ]
        _registry[self.token] = self
        try:  # alive as long as the figure (the cell's value) is
            figure._reaktiv_resampled = self
        except Exception:  # noqa: BLE001 - a figure that refuses attributes: kept by the caller
            pass

    def view(self, ranges: Mapping[str, Any]) -> dict[str, Any]:
        traces: list[dict[str, Any]] = []
        for trace in self.traces:
            ids, in_range = trace.indices(ranges.get(trace.axis), self.points)
            traces.append(
                {
                    "index": trace.index,
                    "shown": int(len(ids)),
                    "inRange": int(in_range),
                    "total": trace.n,
                    "data": _plain(trace.patch(ids)),
                }
            )
        return {"traces": traces}

    def spec(self) -> str:
        """The figure as Plotly JSON, with the resampled traces at their full range."""
        import plotly.io as pio

        resampled = {trace.index: trace for trace in self.traces}
        data: list[dict[str, Any]] = []
        for index, trace in enumerate(self.figure.data):
            source = resampled.get(index)
            if source is None:
                data.append(trace.to_plotly_json())
                continue
            ids, _ = source.indices(None, self.points)
            # Nested settings (marker, line) are copied: the stored trace keeps its full arrays.
            item = _copy_settings({key: value for key, value in source.json.items() if key not in ("x", "y")})
            for path, values in source.patch(ids).items():
                _set_path(item, path, values)
            data.append(item)
        layout: dict[str, Any] = self.figure.layout.to_plotly_json()
        meta = as_dict(layout.get("meta")) or {}
        layout["meta"] = {
            **meta,
            "reaktivResample": {
                "token": self.token,
                "axes": sorted({trace.axis for trace in self.traces}),
                "shown": sum(min(trace.n, 2 * self.points) for trace in self.traces),
                "total": sum(trace.n for trace in self.traces),
            },
        }
        to_json: Callable[..., object] = getattr(pio, "to_json")
        spec = to_json({"data": data, "layout": layout}, validate=False)
        if not isinstance(spec, str):
            raise TypeError("plotly returned no JSON for the figure")
        return spec


def _copy_settings(value: Any) -> Any:
    """Dicts copied all the way down; arrays and other values shared (they are not changed)."""
    settings = as_dict(value)
    return {key: _copy_settings(item) for key, item in settings.items()} if settings is not None else value


def _set_path(target: dict[str, Any], path: str, value: Any) -> None:
    keys = path.split(".")
    for key in keys[:-1]:
        target = target.setdefault(key, {})
    target[keys[-1]] = value


def _plain(patch: Mapping[str, Any]) -> dict[str, list[Any]]:
    """Restyle data as JSON-friendly lists (dates as ISO text, NaN as null)."""
    plain: dict[str, list[Any]] = {}
    for key, values in patch.items():
        array = np.asarray(values)
        if np.issubdtype(array.dtype, np.datetime64):
            plain[key] = list(np.datetime_as_string(array))
        elif np.issubdtype(array.dtype, np.floating):
            plain[key] = [None if value != value else float(value) for value in array.tolist()]
        else:
            plain[key] = array.tolist()
    return plain
