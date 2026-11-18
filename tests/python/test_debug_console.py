"""Console commands and opt-in value estimates must not change cell evaluation policy."""

import sys
import threading
import time

import numpy as np
import pandas as pd

from reaktiv_workbook.cell_memory import value_memory
from reaktiv_workbook.model import CellDefinition
from reaktiv_workbook.runtime import RuntimeServer
from reaktiv_workbook.workbook import ReactiveWorkbook


def test_console_uses_sheet_scoped_values_and_persists_debug_variables():
    calls = []
    workbook = ReactiveWorkbook(globals={"calls": calls})
    cells = [CellDefinition("A1", "formula", "calls.append(1) or 2", name="rate"), CellDefinition("Budget!A1", "input", "20", name="rate")]
    workbook.apply(cells, sheets=["Sheet1", "Budget"])
    assert workbook.run_console("print(rate)\nBudget.rate + A1")["display"] == "22"
    assert workbook.run_console("rate", "Budget")["display"] == "20"
    assert workbook.run_console("x = 1\ndef f():\n    return x")["error"] is None
    assert workbook.run_console("x = 3\nf()")["display"] == "3"
    assert workbook.run_console("_ + 2")["display"] == "5"
    assert workbook.run_console("print('before')\n1 / 0")["output"] == "before\n"
    assert "ZeroDivisionError" in workbook.run_console("1 / 0")["error"]
    assert "SystemExit" in workbook.run_console("exit()")["error"]
    assert len(workbook.run_console("print('x' * 100000)")["output"]) == 16000
    assert calls == [1]
    assert workbook.document.cells == tuple(cells)
    workbook.close()


def test_memory_uses_current_values_without_rerunning_cells():
    calls = []
    workbook = ReactiveWorkbook(globals={"calls": calls})
    workbook.apply([CellDefinition("A1", "formula", "calls.append(1) or np.arange(1000)")])
    memory = workbook.cell_memory()["A1"]
    assert memory["bytes"] >= 8000 and not memory["limited"]
    assert workbook.run_console("A1.size")["display"] == "1000"
    assert calls == [1]
    workbook.apply([])
    assert workbook.cell_memory() == {}
    workbook.close()


def test_memory_handles_cycles_shared_values_arrays_and_tables():
    cyclic = []
    cyclic.append(cyclic)
    assert value_memory(cyclic) == {"bytes": sys.getsizeof(cyclic), "limited": False}
    array = np.arange(1000)
    assert value_memory([array, array])["bytes"] == sys.getsizeof([array, array]) + value_memory(array)["bytes"]
    assert value_memory(array[10:20])["bytes"] >= 80
    frame = pd.DataFrame({"name": ["hello" * 20] * 20})
    assert value_memory(frame)["bytes"] == int(frame.memory_usage(index=True, deep=False).sum())
    assert value_memory(frame)["limited"]
    assert value_memory(list(range(10000)))["limited"]
    assert value_memory(np.array([object()], dtype=object))["limited"]
    class Custom:
        def __sizeof__(self):
            raise AssertionError("Profiling invoked user code")
    assert value_memory(Custom())["limited"]


def test_console_can_be_interrupted_without_a_running_cell():
    server = RuntimeServer()
    outcome = {}
    def execute():
        outcome["result"] = server.dispatch("/v1/console", {"source": "while True: pass", "sheet": ""})
    thread = threading.Thread(target=execute, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server._console_running:
                break
            time.sleep(0.01)
        assert not server.progress.running()
        assert server.interrupt()
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert "CellInterrupted" in outcome["result"]["error"]
        assert server.dispatch("/v1/console", {"source": "6 * 7", "sheet": ""})["display"] == "42"
    finally:
        if thread.is_alive(): server.interrupt()
        thread.join(timeout=5)
        server.close()
