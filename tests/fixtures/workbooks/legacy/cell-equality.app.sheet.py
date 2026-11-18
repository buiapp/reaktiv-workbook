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

from reaktiv import ReactiveModel, computed, effect, field, resource, linked
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"cell-equality","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class CellEqualitySheet(ReactiveModel):

    amount = cell("A1", field(1), label="amount", equal='lambda previous, current: abs(previous - current) < 0.01')

    @cell("B1", equal='lambda previous, current: previous is current')
    @computed
    def b1(self):
        return self.amount() * 2

    @cell("C1", equal='lambda previous, current: previous == current', resource_mode="simple")
    @resource
    def c1(self):
        return {'amount': self.amount()}

    @c1.loader
    async def _c1_loader(self, resource_params):
        await asyncio.sleep(0.01)
        return resource_params.params['amount']

    @cell("D1", equal='lambda previous, current: False')
    @markdown
    def d1(self):
        return """Amount: {{ self.amount() }}"""

    @cell("B2", override='5', equal='lambda previous, current: previous == current')
    @linked
    def b2(self):
        return self.amount() * 3


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
