# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import numpy as np

from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, cell, workbook_config, worksheet


class Sheet1Worksheet(Worksheet["TypesWorkbook"]):
    revenue = cell("A1", field(125000), label="revenue")

    @cell("A2", label="tax")
    @computed
    def tax(self) -> float:
        return self.revenue() * 0.2

    @cell("A3", label="parts")
    @computed
    def parts(self) -> list[float]:
        return [self.revenue(), self.tax()]

    @cell("A4", label="values")
    @computed
    def values(self) -> np.ndarray:
        return np.array(self.parts())

    @cell("A5")
    @computed
    def a5(self):
        return len(self.parts())


@workbook_config({"formatVersion": 2, "name": "types"})
class TypesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
