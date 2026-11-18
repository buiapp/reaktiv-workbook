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

class MainWorksheet(Worksheet["SheetsWorkbook"]):
    income = cell("A1", field(100), label="income")


    @cell("A2")
    @computed
    def a2(self):
        return self.workbook.Budget.a1() + self.workbook.Budget.b1()



class BudgetWorksheet(Worksheet["SheetsWorkbook"]):
    a1 = cell("A1", field(30))


    @cell("B1")
    @computed
    def b1(self):
        return self.a1() * 2


    @cell("C1", label="left")
    @computed
    def left(self):
        return self.workbook.Main.income() - self.workbook.Main.a2()



class NotesWorksheet(Worksheet["SheetsWorkbook"]):
    @cell("A1", label="overview")
    @markdown
    def overview(self):
        return 'Left: {{ self.workbook.Budget.left() }} of {{ self.workbook.Main.income() }}'


    @cell("A2")
    @markdown
    def a2(self):
        return """# Report

        {{ self.overview() }}"""




@workbook({'name': 'sheets', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class SheetsWorkbook(Workbook):
    Main = worksheet(MainWorksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})
    Budget = worksheet(BudgetWorksheet, grid={'columns': 4, 'rows': 4}, layout={'columnWidths': {}, 'rowHeights': {}})
    Notes = worksheet(NotesWorksheet, grid={'columns': 4, 'rows': 4}, layout={'columnWidths': {}, 'rowHeights': {}})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
