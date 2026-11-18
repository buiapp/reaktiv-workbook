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
from reaktiv_workbook import Artifact, artifact, at, bind, cell, every, html, markdown, sheet, Workbook, Worksheet, worksheet, action

from reaktiv_workbook.composition import workbook

env = {}

class Sheet1Worksheet(Worksheet["ModelActionsWorkbook"]):
    count = cell("A1", field(1), label="count", view={'widget': {'type': 'number', 'label': lambda self: ('Working' if self.workbook.add.running() else 'Count')}})


    @cell("B1", label="last_result")
    @computed
    def last_result(self):
        return self.workbook.add.result()


    @cell("C1")
    @markdown
    def c1(self):
        return 'Last result: {{ self.workbook.add.result() }}\n\n    [Add](#sheet-action:add)'


    run_command = cell("D1", field(0), label="run_command", view={'widget': {'type': 'button', 'label': 'Add one batch', 'buttonMode': 'action', 'action': 'add', 'actionArguments': {'quantity': {'cell': 'A1'}, 'confirm': {'value': False}, 'extra': {'default': True}}, 'cancelWhileRunning': True}})



@workbook({'name': 'model-actions', 'actionBindings': {'add': {'quantity': {'value': 3}, 'confirm': {'value': True}, 'extra': {'value': None}}}, 'environment': {'variables': {}}, 'layout': {}, 'formatVersion': 2})
class ModelActionsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={'columns': 10, 'rows': 16}, layout={'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0})

    @action(label='Add')
    def add(self, quantity: int = 2, confirm: bool = False, extra=None):
        # Preserve self.count in comments.
        self.Sheet1.count.set(self.Sheet1.count() + quantity)
        return self.Sheet1.count()


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
