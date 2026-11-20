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

from reaktiv import computed, effect, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["FinancialModelWorkbook"]):
    revenue = cell("A1", field(125000), label="revenue")

    @cell("B1", label="net_income")
    @computed
    def net_income(self):
        return self.revenue() - self.tax()

    @cell("C1", enabled=True, label="log_net_income")
    @effect
    def log_net_income(self):
        print(f"Net income updated: {self.net_income():,.2f}")

    @cell("D1", label="summary")
    @markdown
    def summary(self):
        return """# Financial snapshot

        Net income is **{{ self.net_income() }}**.

        Average revenue: `{{ self.average_revenue() }}`"""

    tax_rate = cell("A2", field(0.18), label="tax_rate")

    @cell("B2", label="average_revenue")
    @computed
    def average_revenue(self):
        return np.mean(np.array([118000, self.revenue(), 137500]))

    @cell("D2", label="assumptions")
    @markdown
    def assumptions(self):
        return """# Model assumptions

        Revenue starts at **{{ self.revenue() }}** and the tax rate is
        **{{ self.tax_rate() }}**.

        Edit the input cells to update this note and the financial snapshot."""

    @cell("A3", label="tax")
    @computed
    def tax(self):
        return self.revenue() * self.tax_rate()


@workbook_config({"formatVersion": 2, "name": "Financial model"})
class FinancialModelWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet, layout={"columnWidths": {"D": 240}, "rowHeights": {"1": 72}}
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
