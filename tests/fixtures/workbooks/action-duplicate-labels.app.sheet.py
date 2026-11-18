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
    action,
    cell,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["ActionDuplicateLabelsWorkbook"]):
    pulse_signal = cell("A1", field(1), label="pulse_signal")

    cell_plc_b6 = cell("A2", field(0), label="cell_plc_b6")


class PLCWorksheet(Worksheet["ActionDuplicateLabelsWorkbook"]):
    pulse_signal = cell("B6", field(2), label="pulse_signal")


@workbook_config({"formatVersion": 2, "name": "action-duplicate-labels"})
class ActionDuplicateLabelsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)
    PLC = worksheet(PLCWorksheet)

    @action
    async def capture(self):
        return self.PLC.pulse_signal()


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
