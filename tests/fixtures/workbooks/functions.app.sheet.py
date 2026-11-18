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


# Shared code: functions, classes, and constants available to every cell.
def double(x):
    return x * 2


class Sheet1Worksheet(Worksheet["FunctionsWorkbook"]):
    base = cell("A1", field(3), label="base")

    @cell("A2", label="triple")
    @computed
    def triple(self):
        def triple(x):
            return x * 3

        return triple

    @cell("A3", label="result")
    @computed
    def result(self):
        return self.triple()(double(self.base()))


@workbook_config({"formatVersion": 2, "name": "functions"})
class FunctionsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
