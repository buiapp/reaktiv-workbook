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


class Sheet1Worksheet(Worksheet["WaveLaboratoryWorkbook"]):
    @cell("A1", label="overview")
    @markdown
    def overview(self):
        return """# New workbook

        Cells hold values and calculations. Move the slider: everything that uses it updates.

        [Quantity: {{ self.quantity() }}](#sheet-input:quantity?type=range&min=0&max=20&step=1)

        [Price: {{ self.price() }}](#sheet-input:price?type=number&min=0&step=0.5)

        **Total: {{ self.total() }}**

        Open **Cells** to see the Python behind these values and add your own. Save with Ctrl+S:
        everything is written to this one Python file.

        New here? Open **Getting started** in the ⋯ menu, or copy a guided example next to this file
        with `reaktiv-workbook new --from welcome`."""

    quantity = cell(
        "B1",
        field(3),
        label="quantity",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 20,
                "step": 1,
                "label": "Quantity",
            }
        },
    )

    price = cell(
        "B2",
        field(4.5),
        label="price",
        view={"widget": {"type": "number", "min": 0, "step": 0.5, "label": "Price"}},
    )

    @cell("B3", label="total")
    @computed
    def total(self):
        return self.quantity() * self.price()


@workbook_config({"formatVersion": 2, "name": "wave-laboratory"})
class WaveLaboratoryWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
