# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["NestedNotesWorkbook"]):
    @cell("A1")
    @markdown
    def a1(self):
        return """# Planning"""

    @cell("A2")
    @markdown
    def a2(self):
        return """# Work"""

    @cell("A3")
    @markdown
    def a3(self):
        return """# Project"""


@workbook_config(
    {
        "formatVersion": 2,
        "name": "nested-notes",
        "layout": {
            "noteOrder": ["A1", "A2", "A3"],
            "noteParents": {"A2": "A1", "A3": "A2"},
        },
    }
)
class NestedNotesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
