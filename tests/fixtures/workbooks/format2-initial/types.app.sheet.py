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

class Sheet1Worksheet(Worksheet["TypesWorkbook"]):
    revenue = cell("A1", field(125000), label="revenue")


    @cell("A2", label="tax")
    @computed
    def tax(self) -> float:
        return self.revenue() * 0.2


    @cell("A3", label="parts")
    @computed
    def parts(self) -> list[float]:
        return [self.revenue(), self.tax()]


    @cell("A4", label="values")
    @computed
    def values(self) -> np.ndarray:
        return np.array(self.parts())


    @cell("A5")
    @computed
    def a5(self):
        return len(self.parts())




@workbook({'name': 'types', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class TypesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
