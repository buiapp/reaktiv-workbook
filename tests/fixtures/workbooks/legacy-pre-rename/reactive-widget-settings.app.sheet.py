# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.24",
# ]
# ///
"""Executable ReactiveModel workbook for Reaktiv Sheet."""

import asyncio
import math
import statistics
import numpy as np

from reaktiv import ReactiveModel, computed, effect, field, resource
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({"name":"reactive-widget-settings","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class ReactiveWidgetSettingsSheet(ReactiveModel):

    limit = cell("A1", field(20), label="limit")

    @cell("B1")
    @markdown
    def b1(self):
        return """[Amount: {{ self.amount() }}](#sheet-input:amount?type=range&min=0&max={{ self.upper() }}&step={{ self.limit() / 10 }})"""

    @cell("A2", label="upper")
    @computed
    def upper(self):
        return self.limit() * 2

    amount = cell("A3", field(5), label="amount", view={'display': 'rendered', 'widget': {'type': 'range', 'min': 0, 'max': lambda self: (self.upper()), 'step': lambda self: (self.limit() / 10)}})

    choices = cell("A4", field(["Small", "Large"]), label="choices")

    choice = cell("A5", field("Small"), label="choice", view={'widget': {'type': 'select', 'options': lambda self: (self.choices())}})


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
