# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import asyncio

from reaktiv import computed, field, resource
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)

env = {"DELAY_SECONDS": "0.1"}


class Sheet1Worksheet(Worksheet["AsyncResourceWorkbook"]):
    filename = cell("A1", field("quarterly-report.csv"), label="filename")

    @cell("B1", label="loaded_data", resource_mode="simple")
    @resource
    def loaded_data(self):
        return {"filename": self.filename()}

    @loaded_data.loader
    async def _loaded_data_loader(self, resource_params):
        delay = float(env.get('DELAY_SECONDS', '0.1'))
        await asyncio.sleep(delay)
        print(f'Loaded {resource_params.params["filename"]} after {delay}s')
        return {'file': resource_params.params["filename"], 'rows': 128, 'status': 'ready'}

    @cell("C1", label="summary")
    @markdown
    def summary(self):
        return """# Async data load

        Resource **{{ self.loaded_data.value()['file'] }}** is **{{ self.loaded_data.value()['status'] }}** with {{ self.loaded_data.value()['rows'] }} rows.

        Projected annual rows: **{{ self.annual_rows() }}**.

        Change `A1` or `DELAY_SECONDS` and apply the environment to reload the Resource."""

    @cell("B2", label="annual_rows")
    @computed
    def annual_rows(self):
        return self.loaded_data.value()['rows'] * 4


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Async resource",
        "environment": {"variables": {"DELAY_SECONDS": "0.1"}},
    }
)
class AsyncResourceWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        layout={
            "columnWidths": {"A": 210, "B": 230, "C": 280},
            "rowHeights": {"1": 72},
        },
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
