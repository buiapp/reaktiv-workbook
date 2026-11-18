"""Output ownership regressions: reuse, tracing and release without graph reads."""
import weakref

from reaktiv_workbook.cell_outputs import CellOutputs
from reaktiv_workbook.update_trace import UpdateTrace


def test_output_cache_reuses_identity_and_releases_changed_cells(monkeypatch):
    import reaktiv_workbook.cell_outputs as module

    class Value:
        pass

    value = Value()
    reference = weakref.ref(value)
    calls = []

    def prepare(_):
        calls.append(True)
        return {"mimeType": "image/png", "dataBase64": "abc"}

    monkeypatch.setattr(module, "rich_output_payload", prepare)
    trace = UpdateTrace()
    outputs = CellOutputs(trace, lambda _: None)
    first = outputs.rich("A1", value)
    assert outputs.rich("A1", value) is first
    assert trace.outputs["A1"] == "prepared"
    trace.outputs.clear()
    assert outputs.rich("A1", value) is first
    assert trace.outputs["A1"] == "reused"
    assert len(calls) == 1
    del value
    assert reference() is not None
    outputs.discard("A1")
    assert reference() is None


def test_closing_workbook_releases_prepared_output_cache():
    from reaktiv_workbook import ReactiveWorkbook

    workbook = ReactiveWorkbook()
    class Value:
        pass
    value = Value()
    reference = weakref.ref(value)
    workbook._outputs.rich("A1", value)
    del value
    assert reference() is not None
    workbook.close()
    assert reference() is None
