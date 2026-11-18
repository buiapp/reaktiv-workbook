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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, Workbook, Worksheet, worksheet

from reaktiv_workbook.composition import workbook

env = {}

class Sheet1Worksheet(Worksheet["CoordinatesWorkbook"]):
    a1 = cell("A1", field(10))


    @cell("B1")
    @markdown
    def b1(self):
        return """Total: {{ self.a3() }}"""


    @cell("A2")
    @computed
    def a2(self):
        return self.a1() * 2


    @cell("A3")
    @computed
    def a3(self):
        return self.a1() + self.a2()




@workbook({'name': 'coordinates', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class CoordinatesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
