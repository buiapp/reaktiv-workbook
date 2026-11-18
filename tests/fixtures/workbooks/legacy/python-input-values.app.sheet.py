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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, input_cell

env = {}

@sheet({"name":"python-input-values","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class PythonInputValuesSheet(ReactiveModel):

    @cell("A1", label="state")
    @input_cell
    def state(self):
        return self.make_value()()

    @cell("B1", label="make_value")
    @computed
    def make_value(self):
        def make():
            return np.array([1, 2, 3])
        return make

    @cell("C1")
    @computed
    def c1(self):
        return int(self.state().sum())

    @cell("D1")
    @markdown
    def d1(self):
        return """[Region](#sheet-input:choice)"""

    choice = cell("A2", field("EU"), label="choice", view={'widget': {'type': 'radio', 'options': lambda self: (self.regions()), 'label': 'Region'}})

    regions = cell("B2", field(["EU", "US"]), label="regions")


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
