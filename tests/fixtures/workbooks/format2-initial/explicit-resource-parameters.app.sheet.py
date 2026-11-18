# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.25.0a1",
#   "reaktiv-workbook>=0.1.0a1",
# ]
# ///
"""Executable ReactiveModel workbook for Reaktiv Workbook."""

import asyncio
import math
import statistics
import numpy as np

from reaktiv import ReactiveModel, computed, effect, field, resource
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, Workbook, Worksheet, worksheet

from reaktiv_workbook.composition import workbook

env = {}

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




@workbook({'name': 'explicit-resource-parameters', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class ExplicitResourceParametersWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
