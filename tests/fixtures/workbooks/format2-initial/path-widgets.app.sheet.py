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

class Sheet1Worksheet(Worksheet["PathWidgetsWorkbook"]):
    source_file = cell("A1", field(""), label="source_file", view={'display': 'rendered', 'span': [3, 3], 'widget': {'type': 'file', 'label': 'Input file', 'disabled': lambda self: (self.busy())}})


    output_folder = cell("D1", field(""), label="output_folder", view={'display': 'rendered', 'span': [3, 3], 'widget': {'type': 'folder', 'label': 'Output folder'}})


    busy = cell("G1", field(False), label="busy")


    @cell("A5")
    @markdown
    def a5(self):
        return """# Paths

        [Input file](#sheet-input:source_file)

        [Output folder](#sheet-input:output_folder)"""




@workbook({'name': 'path-widgets', 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class PathWidgetsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
