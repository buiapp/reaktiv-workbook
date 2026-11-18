# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.24",
# ]
# ///
"""Executable ReactiveModel workbook for Reaktiv Sheet."""

import asyncio
import math
import statistics
import numpy as np

from reaktiv import ReactiveModel, computed, effect, field, resource, action
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"action-duplicate-labels","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0},"sheets":[{"name":"PLC","grid":{"columns":10,"rows":16},"layout":{"columnWidths":{},"rowHeights":{}}}]})
class ActionDuplicateLabelsSheet(ReactiveModel):

    pulse_signal = cell("A1", field(1), label="pulse_signal")

    cell_plc_b6 = cell("A2", field(0), label="cell_plc_b6")

    cell_plc_b6_2 = cell("PLC!B6", field(2), label="pulse_signal")

    @action
    async def capture(self):
        return self.cell_plc_b6_2()


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
