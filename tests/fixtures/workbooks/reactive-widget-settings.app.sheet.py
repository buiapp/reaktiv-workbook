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


class Sheet1Worksheet(Worksheet["ReactiveWidgetSettingsWorkbook"]):
    limit = cell("A1", field(20), label="limit")

    @cell("B1")
    @markdown
    def b1(self):
        return """[Amount: {{ self.amount() }}](#sheet-input:amount?type=range&min=0&max={{ self.upper() }}&step={{ self.limit() / 10 }})"""

    @cell("A2", label="upper")
    @computed
    def upper(self):
        return self.limit() * 2

    amount = cell(
        "A3",
        field(5),
        label="amount",
        view={
            "display": "rendered",
            "widget": {
                "type": "range",
                "min": 0,
                "max": lambda self: self.upper(),
                "step": lambda self: self.limit() / 10,
            },
        },
    )

    choices = cell("A4", field(["Small", "Large"]), label="choices")

    choice = cell(
        "A5",
        field("Small"),
        label="choice",
        view={"widget": {"type": "select", "options": lambda self: self.choices()}},
    )


@workbook_config({"formatVersion": 2, "name": "reactive-widget-settings"})
class ReactiveWidgetSettingsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
