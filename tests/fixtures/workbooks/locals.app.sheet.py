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


class Sheet1Worksheet(Worksheet["LocalsWorkbook"]):
    rate = cell("A1", field(2), label="rate")

    @cell("B1")
    @computed
    def b1(self):
        rate = 5
        return rate + self.rate()

    items = cell("A2", field([1, 2]), label="items")

    @cell("B2")
    @computed
    def b2(self):
        return [rate for rate in range(3)]

    @cell("B3")
    @computed
    def b3(self):
        def helper(values):
            return len(values)
        return helper(self.items()) * self.rate()

    @cell("B4")
    @computed
    def b4(self):
        for index, value in enumerate(self.items()):
            print(index, value)
        return self.rate()

    @cell("B5")
    @computed
    def b5(self):
        return (total := self.rate() * 2) + total


@workbook_config({"formatVersion": 2, "name": "locals"})
class LocalsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
