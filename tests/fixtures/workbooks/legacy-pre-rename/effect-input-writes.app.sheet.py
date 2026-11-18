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

from reaktiv import ReactiveModel, computed, effect, field, resource, linked
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, cell_refs

env = {}

@sheet({"name":"effect-input-writes","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class EffectInputWritesSheet(ReactiveModel):

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

    @cell("D1", enabled=True, trigger="manual")
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


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
