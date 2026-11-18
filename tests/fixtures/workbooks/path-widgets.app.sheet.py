# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["PathWidgetsWorkbook"]):
    source_file = cell(
        "A1",
        field(""),
        label="source_file",
        view={
            "display": "rendered",
            "span": [3, 3],
            "widget": {
                "type": "file",
                "label": "Input file",
                "disabled": lambda self: self.busy(),
            },
        },
    )

    output_folder = cell(
        "D1",
        field(""),
        label="output_folder",
        view={
            "display": "rendered",
            "span": [3, 3],
            "widget": {"type": "folder", "label": "Output folder"},
        },
    )

    busy = cell("G1", field(False), label="busy")

    @cell("A5")
    @markdown
    def a5(self):
        return """# Paths

        [Input file](#sheet-input:source_file)

        [Output folder](#sheet-input:output_folder)"""


@workbook_config({"formatVersion": 2, "name": "path-widgets"})
class PathWidgetsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
