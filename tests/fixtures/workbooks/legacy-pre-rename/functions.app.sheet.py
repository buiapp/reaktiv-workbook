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

# Shared code: functions, classes, and constants available to every cell.
def double(x):
    return x * 2


@sheet({"name":"functions","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class FunctionsSheet(ReactiveModel):

    base = cell("A1", field(3), label="base")

    @cell("A2", label="triple")
    @computed
    def triple(self):
        def triple(x):
            return x * 3
        return triple

    @cell("A3", label="result")
    @computed
    def result(self):
        return self.triple()(double(self.base()))


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
