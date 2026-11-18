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
    input_cell,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["SessionInputsWorkbook"]):
    # Acquired data
    samples = cell("A1", field([]), save_value=False, label="samples")

    @cell("B1")
    @computed
    def b1(self):
        return len(self.samples()) + sum(self.seed())

    @cell("A2", save_value=False, label="seed")
    @input_cell
    def seed(self):
        return list(range(3))


@workbook_config({"formatVersion": 2, "name": "session-inputs"})
class SessionInputsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
