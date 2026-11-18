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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, Workbook, Worksheet, worksheet, input_cell

from reaktiv_workbook.composition import workbook

env = {}

class Sheet1Worksheet(Worksheet["SessionInputsWorkbook"]):
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




@workbook({'name': 'session-inputs', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class SessionInputsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
