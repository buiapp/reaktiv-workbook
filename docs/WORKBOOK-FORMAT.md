# Python workbook format 2

A workbook is one executable `.workbook.py` file (older files are named `.sheet.py`). Each worksheet owns its cells and
layout. One workbook class composes the worksheets and owns every action. Actions
have the same meaning regardless of which worksheet is selected in the UI.

The app reads legacy `@sheet` files and the structured `@workbook_config` format. Every
save writes format 2, including Save As, clipboard workbooks, the CLI and MCP.
There is no file write on Open. The app identifies legacy Python syntax statically
and displays a notice before execution.

- **CLI (`reaktiv-workbook edit`):** saving upgrades the file **in place**
  to format 2 (same path, so Git shows the upgrade as one diff). Opening never
  writes. Keep the old file through version control if older versions still need it.
- **Browser:** the upgraded workbook downloads under a new name chosen in the notice
  (default `<name>.workbook.py` for `<name>.workbook.py`); a download never replaces the
  opened file.

Native format-2 files open without this notice.

Python source format versions 1/2 are distinct from JSON/wire schema version 4.
The inspector returns `sourceFormatVersion` as opening provenance; it is not
written into Python source or used to change calculations. Python API save calls
(`SheetDocument.save`, `WorkbookSession.save`) remain explicit and write format 2 to
the path their caller supplies. Older
app versions cannot read format 2; keep the protected original for them.

## Complete example

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
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    action,
    cell,
    workbook_config,
    worksheet,
)


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

The generic `Worksheet["OrderWorkbook"]` gives Python language servers the owner's
type, including worksheet and action completions. `worksheet()` is a typed
descriptor, so an IDE also knows the cells behind `book.Inputs`.
Instantiate `OrderWorkbook()` in Python, call `book.add_items()`, and call
`book.dispose()` when finished. Input overrides are grouped by worksheet:
`OrderWorkbook(Inputs={"quantity": 5})`.


### What the writer writes

- **Only what the file uses.** The header imports the names the file needs (`computed`,
  `field`, `numpy as np` only when a cell uses `np.`, …). Its dependencies list `numpy`
  only when the file imports it: numpy is not a dependency of reaktiv-workbook. `env = {...}` appears only
  when the workbook has environment variables or code reads `env`. Shared code follows
  its `# Shared code: …` comment.
- **No defaults.** `worksheet()` omits the default grid (10 × 16) and empty or default
  layout (column widths, row heights, zoom 1.0). `@workbook_config` omits empty
  settings. A non-default zoom is still saved in the file.
- **Ruff-compatible layout.** Generated code (`cell(...)`, `worksheet(...)`, decorators,
  note strings) is laid out as `ruff format` would: double quotes, one blank line
  between members, calls and dicts split at 88 columns. User code inside cells, widget
  expressions and input values is kept exactly as typed, so running ruff once and
  saving again gives back ruff's output. A widget expression split over several lines
  is re-indented under its parenthesis like ruff does.
- **Minimum version.** Files declare `reaktiv-workbook>=0.1.0`, the first version that
  reads `@workbook_config`; files declaring an older minimum are upgraded on save.

## One action reference API

| Context | Read a cell | Write an input |
| --- | --- | --- |
| Workbook action | `self.Inputs.quantity()` (or `self.workbook.Inputs.quantity()`) | `self.Inputs.quantity.set(3)` |
| Cell in Inputs worksheet | `self.quantity()` | Effects use the existing cell-write rules |
| Cell in another worksheet | `self.workbook.Inputs.quantity()` | Effects use the existing cell-write rules |
| External Python | `book.Inputs.quantity()` | `book.Inputs.quantity.set(3)` |

In an action `self` is the workbook, and `self.workbook` is the same object, so code
copied from a cell (`self.workbook.Inputs.quantity()`) also works in an action. The
file stores actions with the shorter `self.Inputs.quantity()`.

Resources use their native `.value()` / `.is_loading()` / `.error()` interface.
Formula cells returning functions are read before calling the returned function:
`self.Inputs.helper()(argument)`. Linked inputs retain their existing reset behavior
in the app. Action state in worksheet code is
`self.workbook.add_items.result()` / `.running()` / `.error()`.

Labels are local to a worksheet. `Inputs.quantity` and `Results.quantity` can
coexist. Names must be Python identifiers; coordinates are local to their class.
An unlabelled cell receives a generated Python member such as `a1`. Reserved names
receive a collision-free generated member while retaining their display label.
Use autocomplete or inspect the saved declaration instead of guessing its name.
Workbook worksheet symbols and action names must be distinct. The current app
also reserves worksheet names against cell labels because its short-expression
editor still uses those names as namespaces. Worksheet symbols `cells`, `workbook`,
`dispose`, `worksheet_names` and `worksheet_instance` are reserved.

In the app's **cell** editor, existing short expressions (`quantity`, `Inputs.quantity`,
`A1`) remain supported. They are translated to Python members when saved. In the
**action** editor, always write `self.<worksheet>.<member>`; completion offers
worksheets first, then cells, then operations. The editor identifies these methods
as workbook actions. MCP cell inspection includes `modelReference` with the same
canonical path.

Old flat action members and `self.cells.Sheet.label` references remain readable and
are normalized when the file is opened/saved. A legacy linked-input
`self.cells.Sheet.label.reset()` is retained because the native Reaktiv
`LinkedSignal` has no `.reset()` method; this preserves executable old actions.
The app runtime additionally supports `.reset()` on its canonical linked handles. Saved reference mappings continue to
track moves and renames. References inside ordinary comments and string literals
are not rewritten; Markdown's actual `{{ expression }}` interpolations are.

## Ownership and metadata

- The workbook decorator carries `formatVersion`, workbook name, environment
  variables, and global note ordering/parent relationships.
- Each `worksheet()` declaration carries its own grid dimensions, column widths
  and row heights through `grid` and `layout`. The first worksheet has the same
  source structure as every other worksheet.
- Cell decorators retain labels, annotations, colors, spans, rendered/widget
  views, persistence settings, equality settings, and resource parameters.
- Actions and undecorated action helper methods belong to the workbook. Actions
  retain labels, signatures, saved argument bindings, exposure and button bindings.
- PEP 723 `dependencies` is the package declaration. Imports remain normal Python
  imports; imports and shared code belong before the worksheet classes. Shared code
  is executed once by the runtime, not once per worksheet. Environment variables
  remain in workbook metadata and `env` is available to cell code.
- Snapshot outputs and assets remain companions beside the Python source. The
  source does not embed computed outputs.

All existing cell kinds remain supported: inputs, computed functions/classes,
linked inputs, simple/explicit async resources, automatic/manual effects, notes
and grid Markdown. Timers, rich outputs, input widgets, anywidgets, action buttons,
transient inputs and shared code keep their execution contracts. This migration
does not add transaction semantics or change action batching/live streaming.

## Parsing, authoring and migration boundaries

Loading and saving are static AST-based operations and do not execute the workbook
or install user dependencies. Cell and action code is edited by source spans;
comments inside their bodies survive. Python remains the sole serializer. Files
must use literal decorator/worksheet metadata and direct `Workbook` / `Worksheet`
inheritance. Define shared helpers before the worksheet classes. The reader rejects
unsupported managed declarations rather than discarding them during a save.

The writer reuses the existing complete cell codec, then organizes its output into
worksheet classes. The runtime still uses its existing coordinate-based document
and graph; JSON/wire schema versioning is separate from Python `formatVersion`.
Opaque stable cell IDs and a different graph identity model are deferred. Moving
cells still rewrites references through the existing move machinery.

Duplicating a worksheet produces independent cells and a distinct worksheet class.
Declaring the same worksheet class twice as a reusable template is not supported
in this version; parameterized worksheet modules are a separate design problem.
Workbook actions are not implicitly copied into a sheet or rebound to a copied
sheet. Their explicit references retain their targets.

Legacy fixture copies are retained under `tests/fixtures/workbooks/legacy`.
Migration tests cover old-file reading, idempotent new-format saving, duplicate
labels, moves, resource reads, native Python execution and app runtime execution.
