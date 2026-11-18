# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, cell, workbook_config, worksheet


class Sheet1Worksheet(Worksheet["MultilineFunctionCellWorkbook"]):
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


@workbook_config({"formatVersion": 2, "name": "multiline-function-cell"})
class MultilineFunctionCellWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
