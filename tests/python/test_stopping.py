"""Stopping cells that run too long."""

import threading
import time

import pytest

from reaktiv_workbook import ActionDefinition, ReactiveWorkbook, SheetDocument
from reaktiv_workbook.model import CellDefinition
from reaktiv_workbook.runtime import RuntimeServer


def result(snapshot, cell_id):
    return next(cell for cell in snapshot["cells"] if cell["id"] == cell_id)


def test_stopped_cells_do_not_run_until_released():
    runs = []
    workbook = ReactiveWorkbook({"record": runs.append})
    cells = [
        CellDefinition("A1", "input", "2", name="n"),
        CellDefinition("A2", "formula", "record('A2')\nreturn n * 10", name="slow"),
        CellDefinition("A3", "formula", "slow + 1"),
        CellDefinition("A4", "formula", "n + 1"),
    ]
    snapshot = workbook.apply(cells, stopped=["A2"]).to_dict()
    assert runs == []
    assert "Stopped" in result(snapshot, "A2")["error"]
    assert result(snapshot, "A3")["error"]  # reads the stopped cell
    assert result(snapshot, "A4")["value"] == 3  # the rest of the workbook works
    assert snapshot["stopped"] == ["A2"]

    # Other changes keep it stopped; releasing it runs it again (also with the same code).
    workbook.apply([CellDefinition("A1", "input", "3", name="n"), *cells[1:]], stopped=["A2"])
    assert runs == []
    snapshot = workbook.apply([CellDefinition("A1", "input", "3", name="n"), *cells[1:]], stopped=[]).to_dict()
    assert runs == ["A2"] and result(snapshot, "A3")["value"] == 31
    assert "stopped" not in snapshot
    workbook.close()


def test_an_endless_loop_is_interrupted_and_stays_stopped():
    server = RuntimeServer()
    cells = [
        CellDefinition("A1", "input", "1", name="n").to_dict(),
        CellDefinition("A2", "formula", "while True:\n    n * 2", name="spin").to_dict(),
        CellDefinition("A3", "formula", "spin + 1").to_dict(),
        CellDefinition("A4", "formula", "spin + 2").to_dict(),  # reads it again: must not loop again
        CellDefinition("B1", "formula", "n + 41").to_dict(),
    ]
    outcome = {}
    thread = threading.Thread(
        target=lambda: outcome.setdefault("snapshot", server.dispatch("/v1/apply", {"cells": cells})),
        daemon=True,
    )
    thread.start()
    for _ in range(200):
        if server.progress.running():
            break
        time.sleep(0.01)
    time.sleep(0.1)
    assert server.dispatch("/v1/interrupt", {}) == {"interrupted": True}
    thread.join(timeout=10)
    assert not thread.is_alive(), "the loop was not interrupted"

    snapshot = outcome["snapshot"]
    assert snapshot["stopped"] == ["A2"]  # where it ran, not the cells that read it
    assert "Stopped" in result(snapshot, "A2")["error"]
    assert result(snapshot, "A3")["error"] and result(snapshot, "A4")["error"]
    assert result(snapshot, "B1")["value"] == 42
    # Nothing runs now: interrupting is a no-op.
    assert server.dispatch("/v1/interrupt", {}) == {"interrupted": False}

    # The app sends it back as stopped: the next update finishes at once.
    snapshot = server.dispatch("/v1/apply", {"cells": cells, "stopped": ["A2"]})
    assert result(snapshot, "B1")["value"] == 42
    # Fixed and released: it runs.
    fixed = [*cells[:1], CellDefinition("A2", "formula", "n * 2", name="spin").to_dict(), *cells[2:]]
    snapshot = server.dispatch("/v1/apply", {"cells": fixed, "stopped": []})
    assert result(snapshot, "A3")["value"] == 3 and "stopped" not in snapshot
    server.close()


@pytest.mark.parametrize("asynchronous", [False, True])
def test_toolbar_interrupt_stops_actions_and_keeps_kernel_usable(asynchronous):
    server = RuntimeServer()
    source = (
        "async def wait(self):\n    import asyncio\n    await asyncio.sleep(3600)"
        if asynchronous else "def wait(self):\n    while True:\n        pass"
    )
    document = SheetDocument(actions=(ActionDefinition("wait", source),))
    server.workbook.load_document(document)
    outcome = {}
    def execute():
        outcome["snapshot"] = server.dispatch("/v1/run-action", {"name": "wait", "arguments": {}})
    thread = threading.Thread(target=execute, daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if server.workbook.action_running("wait"):
                break
            time.sleep(.01)
        assert server.workbook.action_running("wait")
        assert server.interrupt()
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert outcome["snapshot"]["actions"][0]["status"] == ("cancelled" if asynchronous else "failed")
        assert server.dispatch("/v1/console", {"source": "6 * 7", "sheet": ""})["display"] == "42"
        assert not server.interrupt()
    finally:
        if thread.is_alive():
            server.interrupt()
            thread.join(timeout=5)
        server.close()
