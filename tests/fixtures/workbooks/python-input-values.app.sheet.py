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
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    input_cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["PythonInputValuesWorkbook"]):
    @cell("A1", label="state")
    @input_cell
    def state(self):
        return self.make_value()()

    @cell("B1", label="make_value")
    @computed
    def make_value(self):
        def make():
            return np.array([1, 2, 3])

        return make

    @cell("C1")
    @computed
    def c1(self):
        return int(self.state().sum())

    @cell("D1")
    @markdown
    def d1(self):
        return """[Region](#sheet-input:choice)"""

    choice = cell(
        "A2",
        field("EU"),
        label="choice",
        view={
            "widget": {
                "type": "radio",
                "options": lambda self: self.regions(),
                "label": "Region",
            }
        },
    )

    regions = cell("B2", field(["EU", "US"]), label="regions")


@workbook_config({"formatVersion": 2, "name": "python-input-values"})
class PythonInputValuesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
