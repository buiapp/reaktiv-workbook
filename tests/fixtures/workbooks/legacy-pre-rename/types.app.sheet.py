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
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"types","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class TypesSheet(ReactiveModel):

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


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
