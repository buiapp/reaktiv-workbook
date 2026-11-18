# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.25.0a1",
#   "reaktiv-workbook>=0.1.0a1",
# ]
# ///
"""Executable ReactiveModel workbook for Reaktiv Workbook."""

import asyncio
import math
import statistics
import numpy as np

from reaktiv import ReactiveModel, computed, effect, field, resource
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, action

env = {}

@sheet({"name":"refactored-label-layout","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{"B":300},"rowHeights":{"2":64},"zoom":1.0,"noteZoom":1.0},"sheets":[{"name":"Other","grid":{"columns":10,"rows":16},"layout":{"columnWidths":{"A":236},"rowHeights":{"1":180}}}]})
class RefactoredLabelLayoutSheet(ReactiveModel):

    voltage = cell("A1", field(10), label="voltage")

    @cell("B1")
    @computed
    def b1(self):
        return self.voltage() * 2

    @cell("C1", view={'page': False})
    @markdown
    def c1(self):
        return """Voltage: {{ self.voltage() }}"""

    @cell("Other!B1")
    @computed
    def other_b1(self):
        return self.voltage() + 1

    @action
    def adjust(self):
        self.cells.Sheet1.voltage.set(self.voltage() + 1)


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
