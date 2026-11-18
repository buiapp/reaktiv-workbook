# The workbook file

A workbook is one Python file, `name.workbook.py`. The app writes it for you; you
rarely need to edit it by hand. It reads as ordinary Python in a code review and runs
as a plain Python model.

## Example

```python
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, action, cell, workbook_config, worksheet


# Shared code: functions, classes, and constants available to every cell.
def with_tax(amount: float) -> float:
    return amount * 1.19


class InputsWorksheet(Worksheet["OrderWorkbook"]):
    quantity = cell("A1", field(2), label="quantity")

    price = cell("B1", field(10.0), label="price")


class ResultsWorksheet(Worksheet["OrderWorkbook"]):
    @cell("A1", label="total")
    @computed
    def total(self) -> float:
        return with_tax(self.workbook.Inputs.quantity() * self.workbook.Inputs.price())


@workbook_config({"formatVersion": 2, "name": "Order"})
class OrderWorkbook(Workbook):
    Inputs = worksheet(InputsWorksheet, grid={"columns": 6, "rows": 12})
    Results = worksheet(ResultsWorksheet)

    @action(label="Add items")
    def add_items(self, amount: int = 1) -> float:
        self.Inputs.quantity.update(lambda value: value + amount)
        return self.Results.total()


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
```

## How it is organized

| Part | Holds |
| --- | --- |
| `# /// script` header | Python version and packages ([PEP 723](https://peps.python.org/pep-0723/)) |
| Imports and shared code | Everything before the first class |
| One `Worksheet` class per sheet | Its cells; the `@cell` decorator holds the address and settings |
| One `Workbook` class | The sheets, workbook settings and every action |

Cells by kind:

```python
deposit = cell("A1", field(200), label="deposit")       # input

@cell("B2", label="balance")                            # formula
@computed
def balance(self):
    return self.deposit() * 12

@cell("D1", label="plan")                               # note
@markdown
def plan(self):
    return """# Plan

    You save **{{ self.balance() }} €** a year."""
```

## Rules for editing by hand

- `@cell` is always the outermost decorator.
- Read another cell with `self.name()`; a resource's value with `self.name.value()`.
- On another sheet: `self.workbook.Inputs.quantity()` in a cell, `self.Inputs.quantity()`
  in an action.
- A resource is a pair: `@resource` returning what it depends on, plus `@name.loader`.
- Comments inside cells are kept.
- Saved outputs live in `name.workbook.py.snapshot.json` and images in `assets/`; the
  Python file never embeds them.

When in doubt, generate the file from Python instead ([Python API](python-api.md)), or
copy a pattern from the bundled examples.

## Use it as Python

```python
book = OrderWorkbook(Inputs={"quantity": 5})
book.add_items()
print(book.Results.total())
book.dispose()
```

Type checkers and editors understand the file: `Worksheet["OrderWorkbook"]` gives
completion for sheets, cells and actions.

## Older files

Older workbooks (format 1, `@sheet` classes, `.sheet.py` names) still open, with a
notice. Saving with `reaktiv-workbook edit` upgrades the file in place; in the browser
the upgrade downloads as a new file. Commit the old version first if older Reaktiv
Workbook versions still need it.
