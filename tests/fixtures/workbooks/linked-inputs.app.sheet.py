# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field, linked
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["LinkedInputsWorkbook"]):
    base = cell("A1", field(10), label="base")

    @cell(
        "B1",
        label="price",
        view={
            "display": "rendered",
            "widget": {"type": "number", "min": 0, "max": lambda self: self.base() * 4},
        },
        override="7",
    )
    @linked
    def price(self) -> float:
        return self.base() * 2

    @cell("C1")
    @computed
    def c1(self):
        return self.price() + 1

    @cell("D1")
    @markdown
    def d1(self):
        return """[Price: {{ self.price() }}](#sheet-input:price?type=number)"""

    @cell("B2", label="greeting", override='""')
    @linked
    def greeting(self):
        return "Hello"


@workbook_config({"formatVersion": 2, "name": "linked-inputs"})
class LinkedInputsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
