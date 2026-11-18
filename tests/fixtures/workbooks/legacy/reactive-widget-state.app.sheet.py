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

@sheet({"name":"reactive-widget-state","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class ReactiveWidgetStateSheet(ReactiveModel):

    running = cell("A1", field(False), label="running")

    toggle = cell("B1", field(False), label="toggle", view={'display': 'rendered', 'widget': {'type': 'button', 'label': lambda self: ("Stop" if self.running() else "Start"), 'placeholder': 'running is literal text', 'disabled': lambda self: (not self.ready()), 'visible': lambda self: (self.ready()), 'loading': lambda self: (self.running()), 'pressed': lambda self: (self.running()), 'buttonMode': 'toggle'}})

    ready = cell("A2", field(True), label="ready")

    b2 = cell("B2", field("Guest"), view={'widget': {'type': 'text', 'label': 'Name', 'placeholder': lambda self: ("Busy" if self.running() else "Your name")}})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
