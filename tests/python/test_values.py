"""Raw cell values travel as strict JSON (the kernel and the Pyodide worker refuse NaN)."""

import json

import numpy as np

from reaktiv_workbook import ReactiveWorkbook
from reaktiv_workbook.model import CellDefinition


def test_complex_numbers_and_nan_reach_the_app_as_text():
    """A pandapower network (a dict with NumPy complex numbers) once stopped the whole update:
    "Object of type complex is not JSON serializable"."""
    workbook = ReactiveWorkbook({"np": np})
    snapshot = workbook.apply(
        [
            CellDefinition("A1", "formula", "np.array([1 + 2j, 3j])"),
            CellDefinition("A2", "formula", "np.complex128(1 + 1j)"),
            CellDefinition("A3", "formula", "np.array([1.0, float('nan'), float('inf')])"),
            CellDefinition("A4", "formula", "{'z': 1 + 1j, 'loss': np.float64('nan'), 'n': np.int64(3)}"),
            CellDefinition("A5", "formula", "np.array([1, 2])"),
            CellDefinition("A6", "formula", "abs(A2)"),
        ]
    )
    json.dumps(snapshot.to_dict(), allow_nan=False)  # the whole update encodes
    values = {cell["id"]: cell["value"] for cell in snapshot.cells}
    assert values["A1"] == ["(1+2j)", "3j"]
    assert values["A2"] == "(1+1j)"
    assert values["A3"] == [1.0, "nan", "inf"]
    assert values["A4"] == {"z": "(1+1j)", "loss": "nan", "n": 3}
    assert values["A5"] == [1, 2]
    # Only the copy for the app is text: cells still compute with the numbers.
    assert values["A6"] == abs(1 + 1j)
