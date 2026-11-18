# Python API

Use Python to generate workbooks, or to run one inside your own script.

## Generate a workbook

Describe the cells and let the package write the file. Sources use labels, exactly as
you would type them in the app:

```python
from reaktiv_workbook import CellDefinition as C, SheetDocument

document = SheetDocument(
    name="Savings plan",
    packages=("plotly",),
    cells=(
        C("A1", "input", "# monthly deposit in €\n200", name="deposit"),
        C("A2", "input", "10", name="years"),
        C("B1", "formula", "deposit * 12 * years", name="saved"),
        C("C1", "markdown", "You save **{{ saved }} €**.", name="plan"),
    ),
)
document.save("savings.workbook.py")
```

`CellDefinition(id, kind, source, name=…, view=…, enabled=…, trigger=…)`. Kinds:
`input`, `linked`, `formula`, `resource`, `effect`, `markdown`.

| `SheetDocument` field | Purpose |
| --- | --- |
| `packages=("pandas", "plotly")` | Packages the workbook needs |
| `imports=("import pandas as pd",)` | Imports for every cell |
| `code="def money(x): ..."` | Shared code |
| `variables={"REGION": "EU"}` | Environment variables (`env["REGION"]`) |
| `sheets=(SheetTab("Budget"),)` | More sheets (`from reaktiv_workbook.model import SheetTab`); their cell ids look like `"Budget!A1"` |
| `save_outputs=False` | Don't save the outputs snapshot |

Presentation goes in `view`:

```python
C("A1", "input", "5", name="rate",
  view={"widget": {"type": "range", "min": 0, "max": 15, "step": 1}})
C("C1", "formula", "figure", name="chart",
  view={"display": "rendered", "span": [3, 8]})      # a tile 3 columns × 8 rows
C("E1", "markdown", "Inputs are on the left.",
  view={"page": False})                              # text in the grid, not a note page
```

Widget types: `number`, `range`, `checkbox`, `select`, `radio`, `text`, `textarea`,
`date`, `list`, `multiselect`, `file`, `folder`, `button`.

Then check the result: `reaktiv-workbook check savings.workbook.py`.

## Run a workbook in a script

`WorkbookSession` loads a workbook, lets your code change inputs and read results, and
can open the editor on the same running model.

```python
from reaktiv_workbook import WorkbookSession

with WorkbookSession.load("pricing.workbook.py") as session:
    print(session.values.total())             # read
    session.inputs.quantity.set(5)            # write
    session.inputs.quantity.update(lambda q: q + 1)
    print(session.values.total())
```

| Task | Code |
| --- | --- |
| Another sheet | `session.inputs.Forecast.quantity.set(10)` |
| By coordinate | `session.values["B1"]()` |
| Several changes at once | `with session.batch(): ...` |
| Reset a linked input | `session.inputs.price.reset()` |
| Call a function cell | `session.values.calculate.call(10, scale=2)` |
| Run an action | `session.run_action("add_items", amount=3)` |
| Save | `session.save()` |

Only inputs and linked inputs are writable. Values are real Python objects; treat them
as read-only and change state with `set` or `update`.

### Open the editor

```python
with WorkbookSession.load("pricing.workbook.py") as session:
    session.open_editor()
    input("Press Enter to stop. ")
```

The editor and your script share one live model: changes on either side show up on the
other. Keep the `with` block open as long as you need the editor. Closing a session
does not save it; call `session.save()`.

### Things to know

- Install the packages the workbook uses into your script's environment.
- Calls are synchronous. In asyncio code, wrap them: `await asyncio.to_thread(session.inputs.quantity.set, 8)`.
- Labels your script uses are part of the workbook's interface: renaming one in the
  app breaks the script.
