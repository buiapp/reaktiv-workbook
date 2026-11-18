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


class MainWorksheet(Worksheet["SheetLocalLabelsWorkbook"]):
    amount = cell("A1", field(10), label="amount")

    @cell("B1", label="total")
    @computed
    def total(self):
        return self.amount() + self.workbook.Budget.amount()

    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return """Main {{ self.total() }} / budget {{ self.workbook.Budget.total() }}"""


class BudgetWorksheet(Worksheet["SheetLocalLabelsWorkbook"]):
    amount = cell("A1", field(20), label="amount")

    @cell("B1", label="total")
    @computed
    def total(self):
        return self.amount() * 2 + self.workbook.Main.amount()

    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return """Budget {{ self.total() }} / main {{ self.workbook.Main.total() }}"""

    @cell("D1")
    @computed
    def d1(self):
        amount = 3
        return amount + self.workbook.Main.amount()


@workbook_config({"formatVersion": 2, "name": "sheet-local-labels"})
class SheetLocalLabelsWorkbook(Workbook):
    Main = worksheet(MainWorksheet)
    Budget = worksheet(BudgetWorksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
