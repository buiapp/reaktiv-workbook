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

class Sheet1Worksheet(Worksheet["ReactiveColorsWorkbook"]):
    temperature = cell("A1", field(90), label="temperature")


    @cell("B1", color="#eeeeee", view={'color': lambda self: ('#ffcccc' if self.temperature() > 80 else '#ccffcc')})
    @computed
    def b1(self):
        return self.temperature() * 2




@workbook({'name': 'reactive-colors', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class ReactiveColorsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
