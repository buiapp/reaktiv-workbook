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


class Sheet1Worksheet(Worksheet["ReactiveWidgetControlsWorkbook"]):
    environment = cell(
        "A1",
        field("Development"),
        label="environment",
        view={
            "widget": {
                "type": "select",
                "options": ["Development", "Production"],
                "label": "Environment",
                "disabled": lambda self: self.running(),
            }
        },
    )

    target = cell(
        "B1",
        field("Sandbox A"),
        label="target",
        view={
            "widget": {
                "type": "select",
                "options": lambda self: self.targets(),
                "label": lambda self: self.environment() + " target",
                "disabled": lambda self: self.running(),
            }
        },
    )

    running = cell(
        "C1",
        field(False),
        label="running",
        view={
            "widget": {
                "type": "button",
                "label": lambda self: (
                    "Working…" if self.busy() else "Stop" if self.running() else "Start"
                ),
                "disabled": lambda self: self.target() not in self.targets(),
                "loading": lambda self: self.busy(),
                "buttonMode": "toggle",
            }
        },
    )

    advanced = cell(
        "D1",
        field(False),
        label="advanced",
        view={"widget": {"type": "checkbox", "label": "Show advanced settings"}},
    )

    @cell("E1", label="status")
    @computed
    def status(self):
        return "Choose an available target" if self.target() not in self.targets() else ("Running on " if self.running() else "Ready for ") + self.target()

    @cell("F1", label="controls")
    @markdown
    def controls(self):
        return """# Reactive app controls

        This is a local form demonstration; it does not start a service.

        ## Configuration

        [Environment](#sheet-input:environment)

        [Target](#sheet-input:target)

        [Features](#sheet-input:features)

        ## Action and state

        [Run](#sheet-input:running)

        [Busy](#sheet-input:busy)

        **{{ self.status() }}**

        ## Advanced

        [Advanced settings](#sheet-input:advanced)

        [Operator](#sheet-input:operator)

        Changing environment updates both option lists. An unavailable selection stays visible until you choose or remove it. Busy disables the action button. Labels, placeholders and visibility are Python computations configured on the cells; notes inherit them."""

    @cell("A2", label="targets")
    @computed
    def targets(self):
        return ["Sandbox A", "Sandbox B"] if self.environment() == "Development" else ["Live EU", "Live US"]

    features = cell(
        "B2",
        field(["Logs"]),
        label="features",
        view={
            "widget": {
                "type": "multiselect",
                "options": lambda self: (
                    ["Logs", "Tracing"] if self.environment() == "Development" else ["Logs", "Metrics"]
                ),
                "label": "Features",
                "disabled": lambda self: self.running(),
            }
        },
    )

    busy = cell(
        "C2",
        field(False),
        label="busy",
        view={"widget": {"type": "checkbox", "label": "Simulate busy state"}},
    )

    operator = cell(
        "D2",
        field("Guest"),
        label="operator",
        view={
            "widget": {
                "type": "text",
                "label": "Operator",
                "placeholder": lambda self: (
                    "Production contact" if self.environment() == "Production" else "Developer name"
                ),
                "disabled": lambda self: self.running(),
                "visible": lambda self: self.advanced(),
            }
        },
    )


@workbook_config({"formatVersion": 2, "name": "Reactive widget controls"})
class ReactiveWidgetControlsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={"columns": 6, "rows": 6})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
