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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"labels","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class LabelsSheet(ReactiveModel):

    revenue = cell("A1", field(125000), label="revenue")

    @cell("B1", label="tax")
    @computed
    def tax(self):
        return self.revenue() * self.tax_rate()

    @cell("C1", enabled=True, trigger="manual")
    @effect
    def c1(self):
        print(f"net: {self.net()}")

    @cell("D1", label="summary")
    @markdown
    def summary(self):
        return """# Summary

        Net: **{{ self.net() }}** of {{ self.revenue() }}

        [Rate: {{ self.tax_rate() }}](#sheet-input:tax_rate?type=range&min=0&max=1&step=0.01)"""

    @cell("E1", label="loaded", resource_mode="simple")
    @resource
    def loaded(self):
        return {'tax_rate': self.tax_rate()}

    @loaded.loader
    async def _loaded_loader(self, resource_params):
        await asyncio.sleep(0)
        return {"rate": resource_params.params['tax_rate']}

    tax_rate = cell("A2", field(0.18), label="tax_rate")

    @cell("B2", label="net")
    @computed
    def net(self):
        return self.revenue() - self.tax()

    @cell("E2", label="from_resource")
    @computed
    def from_resource(self):
        return self.loaded.value()["rate"] * 2

    data = cell("A3", field([3, 5, 8]), label="data")

    @cell("B3", label="net_text")
    @computed
    def net_text(self):
        return f"{self.net():,.2f} of {self.revenue():,}"

    @cell("B4", label="scaled")
    @computed
    def scaled(self):
        return [x * self.tax_rate() for x in self.data()]

    @cell("B5", label="ranked")
    @computed
    def ranked(self):
        return sorted(self.data(), key=lambda value: -value * self.tax_rate())

    @cell("B6", label="average")
    @computed
    def average(self):
        # Average with a floor
        total = sum(self.data())
        if total < self.tax_rate():
            return 0
        return total / len(self.data())

    @cell("B7", label="params")
    @computed
    def params(self):
        return dict(revenue=self.revenue(), rate=self.tax_rate())

    @cell("B8", label="labelled_text")
    @computed
    def labelled_text(self):
        return "revenue" + str(self.revenue())  # revenue in a comment

    @cell("B9", label="parts")
    @computed
    def parts(self):
        return self.revenue().real + self.data()[0]


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
