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

@sheet({"name":"sheets","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0},"sheetName":"Main","sheets":[{"name":"Budget","grid":{"columns":4,"rows":4},"layout":{"columnWidths":{},"rowHeights":{}}},{"name":"Notes","grid":{"columns":4,"rows":4},"layout":{"columnWidths":{},"rowHeights":{}}}]})
class SheetsSheet(ReactiveModel):

    income = cell("A1", field(100), label="income")

    @cell("A2")
    @computed
    def a2(self):
        return self.budget_a1() + self.budget_b1()

    budget_a1 = cell("Budget!A1", field(30))

    @cell("Budget!B1")
    @computed
    def budget_b1(self):
        return self.budget_a1() * 2

    @cell("Budget!C1", label="left")
    @computed
    def left(self):
        return self.income() - self.a2()

    @cell("Notes!A1", label="overview")
    @markdown
    def overview(self):
        return """Left: {{ self.left() }} of {{ self.income() }}"""

    @cell("Notes!A2")
    @markdown
    def notes_a2(self):
        return """# Report

        {{ self.overview() }}"""


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
