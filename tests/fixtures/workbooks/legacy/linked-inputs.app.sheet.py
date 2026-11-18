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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"linked-inputs","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class LinkedInputsSheet(ReactiveModel):

    base = cell("A1", field(10), label="base")

    @cell("B1", label="price", view={'display': 'rendered', 'widget': {'type': 'number', 'min': 0, 'max': lambda self: (self.base() * 4)}}, override='7')
    @linked
    def price(self) -> float:
        return self.base() * 2

    @cell("C1")
    @computed
    def c1(self):
        return self.price() + 1

    @cell("D1")
    @markdown
    def d1(self):
        return """[Price: {{ self.price() }}](#sheet-input:price?type=number)"""

    @cell("B2", label="greeting", override='""')
    @linked
    def greeting(self):
        return "Hello"


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
