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


class Sheet1Worksheet(Worksheet["EmbeddedPricingWorkbook"]):
    price = cell("A1", field(20.0), label="price")

    @cell("B1", label="total")
    @computed
    def total(self) -> float:
        return self.price() * self.quantity()

    quantity = cell("A2", field(3), label="quantity")


@workbook_config({"formatVersion": 2, "name": "Embedded pricing"})
class EmbeddedPricingWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={"columns": 4, "rows": 8})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
