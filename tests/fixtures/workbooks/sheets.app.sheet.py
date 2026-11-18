# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


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
        return """Left: {{ self.workbook.Budget.left() }} of {{ self.workbook.Main.income() }}"""

    @cell("A2")
    @markdown
    def a2(self):
        return """# Report

        {{ self.overview() }}"""


@workbook_config({"formatVersion": 2, "name": "sheets"})
class SheetsWorkbook(Workbook):
    Main = worksheet(MainWorksheet)
    Budget = worksheet(BudgetWorksheet, grid={"columns": 4, "rows": 4})
    Notes = worksheet(NotesWorksheet, grid={"columns": 4, "rows": 4})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
