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

@sheet({"name":"nested-notes","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0,"noteOrder":["A1","A2","A3"],"noteParents":{"A2":"A1","A3":"A2"}}})
class NestedNotesSheet(ReactiveModel):

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


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
