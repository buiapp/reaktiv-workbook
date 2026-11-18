# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, effect, field, linked
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    cell_refs,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["EffectInputWritesWorkbook"]):
    limit = cell("A1", field(5), label="limit")

    @cell("B1", label="price")
    @linked
    def price(self):
        return self.counter() * 2

    @cell("C1", enabled=True, trigger="auto")
    @effect
    def c1(self):
        cells = cell_refs(self, "Sheet1")
        self.limit()
        with cells.batch():
            cells.counter.update(lambda counter: self.limit())
            cells.price.set(7)

    @cell("D1", enabled=True, trigger="manual")
    @effect
    def d1(self):
        cells = cell_refs(self, "Sheet1")
        cells.price.reset()

    # Counter
    counter = cell("A2", field(0), label="counter")

    @cell("B2")
    @computed
    def b2(self):
        return self.counter() + self.price()


@workbook_config({"formatVersion": 2, "name": "effect-input-writes"})
class EffectInputWritesWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet)


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
