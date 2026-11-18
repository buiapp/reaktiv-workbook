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

from reaktiv import ReactiveModel, computed, effect, field, resource, action
from reactive_sheet import Artifact, artifact, at, bind, cell, every, html, markdown, sheet

env = {}

@sheet({'name': 'model-actions', 'actionBindings': {'add': {'quantity': {'value': 3}, 'confirm': {'value': True}, 'extra': {'value': None}}}, 'grid': {'columns': 10, 'rows': 16}, 'environment': {'packages': [], 'variables': {}}, 'layout': {'columnWidths': {}, 'rowHeights': {}, 'zoom': 1.0, 'noteZoom': 1.0}})
class ModelActionsSheet(ReactiveModel):

    count = cell("A1", field(1), label="count", view={'widget': {'type': 'number', 'label': lambda self: ('Working' if self.add.running() else 'Count')}})

    @cell("B1", label="last_result")
    @computed
    def last_result(self):
        return self.add.result()

    @cell("C1")
    @markdown
    def c1(self):
        return """Last result: {{ self.add.result() }}

        [Add](#sheet-action:add)"""

    run_command = cell("D1", field(0), label="run_command", view={'widget': {'type': 'button', 'label': 'Add one batch', 'buttonMode': 'action', 'action': 'add', 'actionArguments': {'quantity': {'cell': 'A1'}, 'confirm': {'value': False}, 'extra': {'default': True}}}})

    @action(label='Add')
    def add(self, quantity: int = 2, confirm: bool = False, extra=None):
        # Preserve self.count in comments.
        self.count.set(self.count() + quantity)
        return self.count()


if __name__ == '__main__':
    from reactive_sheet.cli import main
    raise SystemExit(main([__file__]))
