"""Process readings and their independence from workbook evaluation."""

import threading
import time
from types import SimpleNamespace

import psutil

from reaktiv_workbook.resource_usage import ProcessUsage
from reaktiv_workbook.runtime import RuntimeServer


def test_cpu_samples_are_cached_and_can_exceed_one_core(monkeypatch):
    clock = [10.0]
    calls = []
    process = SimpleNamespace(
        cpu_percent=lambda interval: calls.append(interval) or 175.5,
        memory_info=lambda: SimpleNamespace(rss=250 * 1024 ** 2),
    )
    monkeypatch.setattr(psutil, "Process", lambda pid: process)
    sampler = ProcessUsage(123, clock=lambda: clock[0])
    first = sampler.sample()
    assert first == {"cpuPercent": None, "memoryBytes": 250 * 1024 ** 2, "memoryKind": "resident"}
    first["memoryBytes"] = 0
    clock[0] += 0.5
    assert sampler.sample()["memoryBytes"] == 250 * 1024 ** 2
    assert len(calls) == 1
    clock[0] += 1.5
    assert sampler.sample()["cpuPercent"] == 175.5
    assert len(calls) == 2


def test_a_process_that_exits_has_unavailable_readings(monkeypatch):
    def gone(interval):
        raise psutil.NoSuchProcess(123)
    monkeypatch.setattr(psutil, "Process", lambda pid: SimpleNamespace(cpu_percent=gone))
    assert ProcessUsage(123).sample() == {"cpuPercent": None, "memoryBytes": None, "memoryKind": "resident"}


def test_usage_is_answered_while_a_cell_is_running():
    runtime = RuntimeServer()
    outcome = {}
    def run():
        outcome["value"] = runtime.dispatch("/v1/apply", {"cells": [{"id": "A1", "kind": "formula", "source": "while True: pass"}]})
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        for _ in range(200):
            if runtime.progress.running():
                break
            time.sleep(0.01)
        assert runtime.progress.running()
        started = time.monotonic()
        first = runtime.dispatch("/v1/usage", {})
        assert first["memoryBytes"] > 0 and first["cpuPercent"] is None
        assert time.monotonic() - started < 1
        time.sleep(1.1)
        second = runtime.dispatch("/v1/usage", {})
        assert second["cpuPercent"] > 0
    finally:
        runtime.interrupt()
        thread.join(timeout=5)
        assert not thread.is_alive()
        runtime.close()
