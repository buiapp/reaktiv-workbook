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


class Sheet1Worksheet(Worksheet["CoordinatesWorkbook"]):
    a1 = cell("A1", field(10))

    @cell("B1")
    @markdown
    def b1(self):
        return """Total: {{ self.a3() }}"""

    @cell("A2")
    @computed
    def a2(self):
        return self.a1() * 2

    @cell("A3")
    @computed
    def a3(self):
        return self.a1() + self.a2()


@workbook_config({"formatVersion": 2, "name": "coordinates"})
class CoordinatesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
