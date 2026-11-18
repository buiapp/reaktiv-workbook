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

@sheet({"name":"sheet-local-labels","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0},"sheetName":"Main","sheets":[{"name":"Budget","grid":{"columns":10,"rows":16},"layout":{"columnWidths":{},"rowHeights":{}}}]})
class SheetLocalLabelsSheet(ReactiveModel):

    amount = cell("A1", field(10), label="amount")

    @cell("B1", label="total")
    @computed
    def total(self):
        return self.amount() + self.cell_budget_a1()

    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return """Main {{ self.total() }} / budget {{ self.cell_budget_b1() }}"""

    cell_budget_a1 = cell("Budget!A1", field(20), label="amount")

    @cell("Budget!B1", label="total")
    @computed
    def cell_budget_b1(self):
        return self.cell_budget_a1() * 2 + self.amount()

    @cell("Budget!C1", label="summary")
    @markdown
    def cell_budget_c1(self):
        return """Budget {{ self.cell_budget_b1() }} / main {{ self.total() }}"""

    @cell("Budget!D1")
    @computed
    def budget_d1(self):
        amount = 3
        return amount + self.amount()


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
