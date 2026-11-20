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

from reaktiv import ReactiveModel, computed, effect, field, resource, linked
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, Workbook, Worksheet, worksheet, cell_refs

from reaktiv_workbook.composition import workbook

env = {}

class Sheet1Worksheet(Worksheet["EffectInputWritesWorkbook"]):
    limit = cell("A1", field(5), label="limit")


    @cell("B1", label="price")
    @linked
    def price(self):
        return self.counter() * 2


    @cell("C1", enabled=True, trigger="auto")
    @effect
    def c1(self):
        cells = cell_refs(self, "Sheet1")
        self.limit()
        with cells.batch():
            cells.counter.update(lambda counter: self.limit())
            cells.price.set(7)


    @cell("D1", enabled=True, trigger="auto")
    @effect
    def d1(self):
        cells = cell_refs(self, "Sheet1")
        cells.price.reset()


    # Counter
    counter = cell("A2", field(0), label="counter")


    @cell("B2")
    @computed
    def b2(self):
        return self.counter() + self.price()




@workbook({'name': 'effect-input-writes', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class EffectInputWritesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
