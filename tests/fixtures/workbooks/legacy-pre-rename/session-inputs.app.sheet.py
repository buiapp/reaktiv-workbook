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

from reaktiv import ReactiveModel, computed, effect, field, resource
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, input_cell

env = {}

@sheet({"name":"session-inputs","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class SessionInputsSheet(ReactiveModel):

    # Acquired data
    samples = cell("A1", field([]), save_value=False, label="samples")

    @cell("B1")
    @computed
    def b1(self):
        return len(self.samples()) + sum(self.seed())

    @cell("A2", save_value=False, label="seed")
    @input_cell
    def seed(self):
        return list(range(3))


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
