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

class MainWorksheet(Worksheet["SheetLocalLabelsWorkbook"]):
    amount = cell("A1", field(10), label="amount")


    @cell("B1", label="total")
    @computed
    def total(self):
        return self.amount() + self.workbook.Budget.amount()


    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return 'Main {{ self.total() }} / budget {{ self.workbook.Budget.total() }}'



class BudgetWorksheet(Worksheet["SheetLocalLabelsWorkbook"]):
    amount = cell("A1", field(20), label="amount")


    @cell("B1", label="total")
    @computed
    def total(self):
        return self.amount() * 2 + self.workbook.Main.amount()


    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return 'Budget {{ self.total() }} / main {{ self.workbook.Main.total() }}'


    @cell("D1")
    @computed
    def d1(self):
        amount = 3
        return amount + self.workbook.Main.amount()




@workbook({'name': 'sheet-local-labels', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class SheetLocalLabelsWorkbook(Workbook):
    Main = worksheet(MainWorksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})
    Budget = worksheet(BudgetWorksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
