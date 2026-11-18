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
    action,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["RefactoredLabelLayoutWorkbook"]):
    voltage = cell("A1", field(10), label="voltage")

    @cell("B1")
    @computed
    def b1(self):
        return self.voltage() * 2

    @cell("C1", view={"page": False})
    @markdown
    def c1(self):
        return """Voltage: {{ self.voltage() }}"""


class OtherWorksheet(Worksheet["RefactoredLabelLayoutWorkbook"]):
    @cell("B1")
    @computed
    def b1(self):
        return self.workbook.Sheet1.voltage() + 1


@workbook_config({"formatVersion": 2, "name": "refactored-label-layout"})
class RefactoredLabelLayoutWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet, layout={"columnWidths": {"B": 300}, "rowHeights": {"2": 64}}
    )
    Other = worksheet(
        OtherWorksheet, layout={"columnWidths": {"A": 236}, "rowHeights": {"1": 180}}
    )

    @action
    def adjust(self):
        self.Sheet1.voltage.set(self.Sheet1.voltage() + 1)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
