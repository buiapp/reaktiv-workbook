# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, cell, workbook_config, worksheet


class Sheet1Worksheet(Worksheet["ReactiveColorsWorkbook"]):
    temperature = cell("A1", field(90), label="temperature")

    @cell(
        "B1",
        color="#eeeeee",
        view={
            "color": lambda self: '#ffcccc' if self.temperature() > 80 else '#ccffcc'
        },
    )
    @computed
    def b1(self):
        return self.temperature() * 2


@workbook_config({"formatVersion": 2, "name": "reactive-colors"})
class ReactiveColorsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
