# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import field
from reaktiv_workbook import Workbook, Worksheet, cell, workbook_config, worksheet


class Sheet1Worksheet(Worksheet["ReactiveWidgetStateWorkbook"]):
    running = cell("A1", field(False), label="running")

    toggle = cell(
        "B1",
        field(False),
        label="toggle",
        view={
            "display": "rendered",
            "widget": {
                "type": "button",
                "label": lambda self: "Stop" if self.running() else "Start",
                "placeholder": "running is literal text",
                "disabled": lambda self: not self.ready(),
                "visible": lambda self: self.ready(),
                "loading": lambda self: self.running(),
                "pressed": lambda self: self.running(),
                "buttonMode": "toggle",
            },
        },
    )

    ready = cell("A2", field(True), label="ready")

    b2 = cell(
        "B2",
        field("Guest"),
        view={
            "widget": {
                "type": "text",
                "label": "Name",
                "placeholder": lambda self: "Busy" if self.running() else "Your name",
            }
        },
    )


@workbook_config({"formatVersion": 2, "name": "reactive-widget-state"})
class ReactiveWidgetStateWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
