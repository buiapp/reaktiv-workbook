# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import asyncio

from reaktiv import field, resource
from reaktiv_workbook import Workbook, Worksheet, cell, workbook_config, worksheet


class Sheet1Worksheet(Worksheet["ExplicitResourceParametersWorkbook"]):
    enabled = cell("A1", field(True), label="enabled")

    @cell("B1", label="loaded", resource_mode="explicit")
    @resource
    def loaded(self):
        # Capture only while enabled
        return self.amount() if self.enabled() else None

    @loaded.loader
    async def _loaded_loader(self, resource_params):
        params = resource_params.params
        await asyncio.sleep(0)
        return params * 2

    amount = cell("A2", field(3), label="amount")


@workbook_config({"formatVersion": 2, "name": "explicit-resource-parameters"})
class ExplicitResourceParametersWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
