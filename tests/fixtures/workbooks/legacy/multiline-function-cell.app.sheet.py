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

@sheet({"name":"multiline-function-cell","grid":{"columns":10,"rows":16},"environment":{"packages":[],"variables":{}},"layout":{"columnWidths":{},"rowHeights":{},"zoom":1.0,"noteZoom":1.0}})
class MultilineFunctionCellSheet(ReactiveModel):

    freq = cell("A1", field(50), label="freq")

    num_samples = cell("A2", field(4), label="num_samples")

    fs = cell("A3", field(1000), label="fs")

    @cell("A5", label="generate_switching_pattern")
    @computed
    def generate_switching_pattern(self):
        def generate_toggle_on_negative(
            freq: float,
            num_samples: int,
            fs: float,
            enable_inversion: bool = True,
        ) -> float:
            """A helper with a multiline signature."""
            return freq * num_samples / fs
        return generate_toggle_on_negative

    @cell("B7", label="pulse_pattern_no_inversion")
    @computed
    def pulse_pattern_no_inversion(self):
        return self.generate_switching_pattern()(
            self.freq(),
            self.num_samples(),
            self.fs(),
            enable_inversion=False
        )


if __name__ == '__main__':
    from reaktiv_workbook.cli import main
    raise SystemExit(main([__file__]))
