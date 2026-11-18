"""Resampled Plotly charts: long signals in the browser."""

import base64
import json

import numpy as np
import pytest

go = pytest.importorskip("plotly.graph_objects")

from reaktiv_workbook import ReactiveWorkbook  # noqa: E402
from reaktiv_workbook.model import CellDefinition  # noqa: E402
from reaktiv_workbook.resample import AUTO_POINTS, minmax_indices, resampled, should_resample, view  # noqa: E402
from reaktiv_workbook.runtime import RuntimeServer  # noqa: E402


def spec_of(snapshot, cell_id):
    cell = next(cell for cell in snapshot.cells if cell["id"] == cell_id)
    return json.loads(base64.b64decode(cell["richOutput"]["dataBase64"]))


def test_minmax_keeps_the_shape_and_every_peak():
    y = np.zeros(1_000_000)
    y[123_457] = 9.0
    y[654_321] = -7.0
    ids = minmax_indices(y, 0, len(y), 1000)
    assert len(ids) <= 2002 and ids[0] == 0 and ids[-1] == len(y) - 1
    assert 123_457 in ids and 654_321 in ids
    assert np.all(np.diff(ids) > 0)
    # Short ranges are shown whole.
    assert list(minmax_indices(y, 10, 30, 1000)) == list(range(10, 30))
    # NaN gaps do not hide the real values.
    y[:500] = np.nan
    assert 123_457 in minmax_indices(y, 0, len(y), 1000)


def test_long_traces_are_resampled_automatically_and_zoom_returns_real_samples():
    workbook = ReactiveWorkbook({"np": np, "go": go})
    snapshot = workbook.apply(
        [
            CellDefinition(
                "A1",
                "formula",
                "t = np.arange(2_000_000) / 1e6\ny = np.sin(t)\ny[1_500_000] = 5\n"
                "go.Figure([go.Scattergl(x=t, y=y, marker=dict(color=np.arange(2_000_000))), go.Bar(x=[1], y=[2])])",
            ),
            CellDefinition("A2", "formula", "go.Figure(go.Scatter(y=np.arange(1000)))"),
        ]
    )
    spec = spec_of(snapshot, "A1")
    meta = spec["layout"]["meta"]["reaktivResample"]
    assert meta["total"] == 2_000_000 and meta["axes"] == ["x"]
    line = spec["data"][0]
    assert len(line["x"]) <= 4000 and len(line["marker"]["color"]) == len(line["x"])
    assert spec["data"][1]["type"] == "bar"  # other traces stay as they are
    assert len(json.dumps(spec)) < 500_000  # instead of ~60 MB

    # Zoom into 300 µs around the glitch: every real sample of the window.
    zoom = workbook.resample_view(meta["token"], {"x": [1.4999, 1.5002]})
    trace = zoom["traces"][0]
    assert trace["index"] == 0 and trace["inRange"] <= trace["shown"] <= 303
    assert max(trace["data"]["y"]) == 5
    assert trace["data"]["marker.color"] == [int(x * 1e6 + 0.5) for x in trace["data"]["x"]]
    # Back to the whole axis.
    assert workbook.resample_view(meta["token"], {"x": None})["traces"][0]["shown"] <= 4000

    # Small figures are not resampled.
    assert "meta" not in spec_of(snapshot, "A2")["layout"]
    assert not should_resample(go.Figure(go.Scatter(y=np.arange(AUTO_POINTS))))


def test_resampled_helper_dates_unsorted_x_and_stale_tokens():
    times = np.datetime64("2026-10-08T00:00:00") + np.arange(100_000) * np.timedelta64(1, "ms")
    chart = resampled(go.Figure(go.Scatter(x=times, y=np.cos(np.arange(100_000) / 100))), points=200)
    spec = json.loads(chart.spec())
    assert spec["layout"]["meta"]["reaktivResample"]["shown"] == 400
    window = view(chart.token, {"x": ["2026-10-08 00:00:10", "2026-10-08 00:00:10.050"]})["traces"][0]
    # 51 points inside, plus one beyond each edge so the line reaches the chart's edges.
    assert window["inRange"] == 51 and window["shown"] == 53
    assert window["data"]["x"][1].startswith("2026-10-08T00:00:10.000")

    # Unsorted x: the points inside the range, in their order.
    x = np.random.default_rng(1).permutation(10_000).astype(float)
    shuffled = resampled(go.Figure(go.Scatter(x=x, y=x * 2, mode="markers")), points=100)
    inside = view(shuffled.token, {"x": [100, 199]})["traces"][0]
    assert inside["inRange"] == 100 and all(100 <= value <= 199 for value in inside["data"]["x"])

    # A chart whose cell re-ran is gone: the old view says so.
    token = shuffled.token
    del shuffled
    import gc

    gc.collect()
    with pytest.raises(KeyError):
        view(token, {})


def test_http_kernels_serve_the_visible_range():
    server = RuntimeServer()
    snapshot = server.dispatch(
        "/v1/apply",
        {
            "cells": [
                CellDefinition(
                    "A1",
                    "formula",
                    "import numpy as np\nimport plotly.graph_objects as go\ngo.Figure(go.Scattergl(y=np.arange(300_000) % 7))",
                ).to_dict()
            ]
        },
    )
    spec = json.loads(base64.b64decode(snapshot["cells"][0]["richOutput"]["dataBase64"]))
    token = spec["layout"]["meta"]["reaktivResample"]["token"]
    result = server.dispatch("/v1/resample", {"token": token, "ranges": {"x": [1000, 1100]}})
    assert result["traces"][0]["data"]["x"] == list(range(999, 1102))
    assert "revision" not in result  # zooming runs no cells
    server.close()


def test_malformed_ranges_show_the_whole_axis():
    chart = resampled(go.Figure(go.Scatter(y=np.arange(10_000))), points=100)
    whole = view(chart.token, {"x": None})["traces"][0]["shown"]
    for broken in ([1], [1, 2, 3], "1,2", 5):
        assert view(chart.token, {"x": broken})["traces"][0]["shown"] == whole
