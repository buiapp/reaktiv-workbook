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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"coordinates","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class CoordinatesSheet(ReactiveModel):

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


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
