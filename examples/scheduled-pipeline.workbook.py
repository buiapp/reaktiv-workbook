# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import asyncio
import math
import statistics

from reaktiv import computed, effect, field, resource
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    at,
    cell,
    every,
    markdown,
    workbook_config,
    worksheet,
)

# Shared code: functions, classes, and constants available to every cell.
from collections import deque

# State that must survive ticks lives here: cells are recomputed, shared code is not.
HISTORY = deque(maxlen=40)


class PipelineWorksheet(Worksheet["ScheduledPipelineWorkbook"]):
    # seconds between two readings
    refresh_seconds = cell(
        "A1",
        field(5),
        label="refresh_seconds",
        view={"widget": {"type": "range", "min": 2, "max": 60, "step": 1}},
    )

    @cell("B1", label="clock")
    @computed
    def clock(self):
        # the heartbeat of the pipeline: its value is the time of the last tick
        return every(self.refresh_seconds(), enabled=self.running())

    @cell("C1", label="report_clock")
    @computed
    def report_clock(self):
        # a schedule instead of an interval (local time)
        return at("08:00", "12:00", "17:30", days="mon-fri")

    @cell("D1", label="scheduled_pipelines")
    @markdown
    def scheduled_pipelines(self):
        return """# ⏱ Scheduled pipelines

        A **clock cell** makes a workbook run by itself. It is an ordinary formula that calls
        `every(...)` or `at(...)`; its value is the time of its last tick. Everything that
        references the clock re-runs on each tick — resources reload, formulas recompute,
        effects fire.

        ```python
        every(30)                                   # every 30 seconds
        every(minutes=5)                            # every 5 minutes
        at("08:00", "17:30", days="mon-fri")        # a schedule, local time
        every(refresh_seconds, enabled=running)     # configurable, with a pause switch
        ```

        ## Try it

        [Refresh every (s): {{ self.refresh_seconds() }}](#sheet-input:refresh_seconds?type=range&min=2&max=60&step=1)

        [Running: {{ self.running() }}](#sheet-input:running?type=checkbox)

        [Alert above (°C): {{ self.threshold() }}](#sheet-input:threshold?type=range&min=18&max=27&step=0.5)

        | What | Now |
        | --- | --- |
        | Last tick | **{{ f'{self.clock():%H:%M:%S}' }}** |
        | Latest reading | **{{ self.latest() }} °C** — {{ self.status() }} |
        | Mean of {{ len(self.history()) }} readings | {{ self.average() }} °C |
        | Trend | {{ self.trend() }} |
        | Last scheduled report | {{ self.report() }} |
        | Tariff (own 10 min timer) | {{ self.tariff.value()['price_ct_kwh'] }} ct/kWh, loaded {{ self.tariff.value()['loaded'] }} |

        ## How the pipeline is wired

        ```mermaid
        flowchart LR
            clock["clock<br/>every({{ self.refresh_seconds() }} s)"] --> reading["reading<br/>resource: fetch"]
            reading --> history["history<br/>collect"]
            history --> stats["latest · average · trend"]
            stats --> status["status<br/>{{ self.status() }}"]
            status --> alert["alert<br/>effect: notify"]
            schedule["report_clock<br/>at(08:00, 12:00, 17:30)"] --> report["report"]
        ```

        **A cell re-runs when something it references changes.** `reading` mentions `clock`, so
        it reloads on every tick. `report` mentions only `report_clock` (it reads `HISTORY` from
        shared code, which is not a cell), so it runs three times a day and not on every reading.

        ## When to use it

        - **Polling** — refresh prices, sensor values, a queue length, or an API status every few
          seconds or minutes (`reading`).
        - **Live dashboards** — a note or dashboard that stays current on a wall screen.
        - **Scheduled reports** — a summary at fixed times on working days (`report`), exported
          by an effect or by `--export`.
        - **Monitoring and alerts** — an effect that acts when a value crosses a limit (`alert`),
          or a heartbeat that proves the pipeline is alive (`heartbeat`).
        - **Slow reference data** — give one resource its own timer instead of the shared clock
          (`tariff` calls `every(minutes=10)` itself).
        - **Time-dependent values** — "days until the deadline", the age of the data.

        ## Good to know

        - Clocks tick **only while the workbook runs**: open in the app, or headless with
          `python -m reaktiv_workbook scheduled-pipeline.workbook.py --watch`. Missed ticks are not
          caught up. For unattended jobs, run the CLI under cron, systemd, or a container.
        - One shared clock keeps a pipeline consistent: every cell sees the same tick. Use a
          cell's own `every()` only when it has its own rhythm.
        - The shortest interval is one second. Schedules use the local time of the machine.
        - Keep the fetch in a **resource** (`~`), so a slow request never blocks the sheet.
        - Keep state that must survive ticks in **Shared code** (`HISTORY`); cells themselves
          stay functions of their inputs.
        - Ticks are not edits: they never mark the file as changed."""

    @cell("E1", label="read_sensor")
    @computed
    def read_sensor(self):
        import math

        def read_sensor(moment):
            """Stand-in for an HTTP request or a database query (offline, repeatable)."""
            seconds = moment.hour * 3600 + moment.minute * 60 + moment.second
            wave = 3.0 * math.sin(seconds / 45)
            ripple = 0.8 * math.sin(seconds * 1.7)
            return {"at": f"{moment:%H:%M:%S}", "temperature": round(22 + wave + ripple, 2)}

        return read_sensor

    running = cell(
        "A2", field(True), label="running", view={"widget": {"type": "checkbox"}}
    )

    @cell("B2", label="reading", resource_mode="simple")
    @resource
    def reading(self):
        return {"read_sensor": self.read_sensor(), "clock": self.clock()}

    @reading.loader
    async def _reading_loader(self, resource_params):
        # fetch: reloads on every tick, because it references `clock`
        await asyncio.sleep(0.05)
        return resource_params.params["read_sensor"](resource_params.params["clock"])

    @cell("C2", label="report")
    @computed
    def report(self):
        # runs only when report_clock ticks: HISTORY is shared code, not a cell reference
        return f"{self.report_clock():%a %H:%M} — " + self.summarize()(HISTORY)

    @cell("E2", label="sparkline")
    @computed
    def sparkline(self):
        def sparkline(values):
            """▁▂▃▅▇ — a chart that fits in a cell."""
            if not values:
                return ""
            low, high = min(values), max(values)
            bars = "▁▂▃▄▅▆▇█"
            return "".join(bars[round((value - low) / ((high - low) or 1) * (len(bars) - 1))] for value in values)

        return sparkline

    # alert when the temperature is above this (°C)
    threshold = cell(
        "A3",
        field(23.5),
        label="threshold",
        view={"widget": {"type": "range", "min": 18, "max": 27, "step": 0.5}},
    )

    @cell("B3", label="history")
    @computed
    def history(self):
        # collect: one entry per tick; the deque lives in shared code
        if not HISTORY or HISTORY[-1]["at"] != self.reading.value()["at"]:
            HISTORY.append(self.reading.value())
        return list(HISTORY)

    @cell("C3", label="tariff", resource_mode="simple")
    @resource
    def tariff(self):
        return {}

    @tariff.loader
    async def _tariff_loader(self, resource_params):
        # a resource with its own timer, independent of the shared clock
        loaded = every(minutes=10)
        await asyncio.sleep(0.05)
        return {"price_ct_kwh": 28.4 + loaded.minute % 5, "loaded": f"{loaded:%H:%M}"}

    @cell("E3", label="summarize")
    @computed
    def summarize(self):
        def summarize(readings):
            if not readings:
                return "no readings yet"
            values = [reading["temperature"] for reading in readings]
            return f"{len(values)} readings, min {min(values)} °C, mean {sum(values) / len(values):.2f} °C, max {max(values)} °C"

        return summarize

    @cell("B4", label="latest")
    @computed
    def latest(self):
        return self.reading.value()["temperature"]

    @cell("C4", enabled=True, trigger="auto", label="heartbeat")
    @effect
    def heartbeat(self):
        # an effect with its own timer: proof that the pipeline is alive
        beat = every(minutes=1)
        print(f"alive at {beat:%H:%M}")

    @cell("B5", label="average")
    @computed
    def average(self):
        return round(statistics.mean(item["temperature"] for item in self.history()), 2)

    @cell("B6", label="trend")
    @computed
    def trend(self):
        return self.sparkline()([item["temperature"] for item in self.history()])

    @cell("B7", label="status")
    @computed
    def status(self):
        return "HIGH" if self.latest() > self.threshold() else "ok"

    @cell("B8", enabled=True, trigger="auto", label="alert")
    @effect
    def alert(self):
        # act: send a mail, call a webhook, write a file …
        if self.status() == "HIGH":
            print(f"{self.clock():%H:%M:%S}  {self.latest()} °C is above {self.threshold()} °C")


@workbook_config({"formatVersion": 2, "name": "Scheduled pipeline"})
class ScheduledPipelineWorkbook(Workbook):
    Pipeline = worksheet(
        PipelineWorksheet,
        grid={"columns": 8, "rows": 16},
        layout={"columnWidths": {"A": 170, "B": 230, "C": 300, "D": 320, "E": 260}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
