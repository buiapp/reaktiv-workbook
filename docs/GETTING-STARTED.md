# Getting started with Reaktiv Workbooks

For people and coding agents who want to **create and maintain workbooks**. (To change
the app itself, read [the architecture overview](ARCHITECTURE.md); for the full feature
tour, the [README](../README.md).)

To author workbooks through agent tools, see the local [MCP server](MCP.md).
Use **Agent access** to share already-open workbooks. Agent cell/note edits use the
current kernel, protect your drafts, and enter undo history without restarting Python.

## 1. The idea in one minute

A workbook is **one Python file**, `name.workbook.py`. It contains cells; cells reference
each other; when a value changes, everything that depends on it recomputes — nothing else.
The same file opens in the app (grid, notes, graph), runs from the command line, and reads
as plain Python in a code review.

Start one with `reaktiv-workbook new analysis.workbook.py`, or copy the guided tour with
`reaktiv-workbook new --from welcome`.

Pasted note images are separate files in a neighboring `assets/` folder; the Python
source stores only their paths. A CLI session (`reaktiv-workbook edit`) writes these files on save. In the
browser, saving a workbook with images downloads a `.workbook.py.zip` containing the
Python file, optional snapshot, and `assets/` folder. Open this ZIP directly in the
browser app, or extract it and open the Python file with the CLI. Keep `assets/` beside
the Python file when moving or sharing it. Browser workbooks without images still
download as Python plus an optional snapshot. HTML exports and printing may embed
images to make the exported document self-contained.

Three things to remember:

1. **A cell is a value with an address** (`B2`) and, ideally, a **label** (`balance`).
2. **Mentioning a cell is depending on it.** `deposit * 12` re-runs when `deposit` changes.
   There is no "run all" and no execution order to manage.
3. **Notes are cells too.** A note is Markdown with live values: `{{ balance }}`.

## 2. Cell kinds

| Kind | Holds | Write | In the app, start a new cell with |
| --- | --- | --- | --- |
| **Input** | A value you change | A Python literal: `200`, `0.18`, `[1, 2, 3]`, `"Jul"`. Initialization may also call Python functions, for example np.zeros(10) or make_state(). It runs once; strings need quotes. | just type |
| **Linked input** | A derived value users can override | A formula, with an optional saved manual value | choose *Linked input* |
| **Formula** | A computed value | A Python expression, or several statements: the **last expression** is the value, and `return` works anywhere (also to stop early) | `=` |
| **Resource** | An awaited value (HTTP, files, slow work) | Python with `await`; the last expression or a `return` is the value | `~` |
| **Effect** | An action, no value | Statements with side effects (`print`, write a file, call a webhook); `return` stops early | `!` |
| **Markdown** | Worksheet text or a note page | Markdown with `{{ expression }}` | choose *Text / heading* in the grid, or **+** in Notes |

Also useful:

- **Function cell** — a formula that ends in a `def` or `class` holds that function; other
  cells call it by its label (`tax(income)`).
- **Shared code** — a module-level block run once for the workbook. Prefer cells: helpers
  as function cells, constants as input cells, so the graph shows every dependency. Use
  shared code for state that must survive recomputation (a history of readings, a cache).
- **Clock cell** — a formula calling `every(minutes=5)` or `at("08:00", days="mon-fri")`;
  it ticks by itself and re-runs everything that references it (section 7).
- **Environment variables** — configuration strings, read as `env["NAME"]`. Not for
  secrets: they are saved in the file.

Available in every cell without imports: `math`, `statistics`, `asyncio`, `np` (NumPy, when
installed; a workbook that uses it declares it on save), `env`, `artifact`, `every`, `at`, and everything defined in shared code.

## 3. References

| You write | Means |
| --- | --- |
| `balance` | the cell labelled `balance`, on any sheet — **prefer this** |
| `A1` | cell A1 on the same sheet |
| `Budget.A1` | cell A1 on the sheet named *Budget* |

- Labels are Python identifiers and unique in the workbook. They survive moving cells;
  coordinates are rewritten when cells move, but labels read better.
- A local variable with the same name wins: in `items = [9]` followed by `len(items)`,
  `items` is the local, not the cell. Do not name locals like cells you want to read, and
  do not name them like coordinates (`A1`, `T2`).
- A cell that depends on itself, directly or in a loop, shows
  `Circular dependency detected`.

## 4. Creating a workbook

### In the app

**New** → write a note, type `{{` to insert a live value, or switch to **Cells** and type
into the grid. Give every cell you reference a label (inspector → *Cell label*). **Save**
writes the `.workbook.py`.

### From Python (recommended for agents)

Describe the cells and let the package write the file. Sources use labels, exactly as
you would type them in the app:

```python
from reaktiv_workbook import CellDefinition as C, SheetDocument

NOTE = """# Savings plan

[Monthly deposit: {{ deposit }}](#sheet-input:deposit?type=range&min=50&max=1000&step=50)

After **{{ years }} years** at {{ rate_percent }} % you have **{{ f"{balance:,.0f}" }} €**,
of which {{ f"{interest:,.0f}" }} € is interest.

$$B = d \\cdot \\frac{(1+r)^n - 1}{r}$$
"""

document = SheetDocument(
    name="Savings plan",
    cells=(
        C("A1", "input", "# monthly deposit in €\n200", name="deposit"),
        C("A2", "input", "4.0", name="rate_percent"),
        C("A3", "input", "10", name="years"),
        C("B1", "formula", "rate_percent / 100 / 12", name="monthly_rate"),
        C("B2", "formula",
          "months = years * 12\n"
          "deposit * ((1 + monthly_rate) ** months - 1) / monthly_rate",
          name="balance"),
        C("B3", "formula", "balance - deposit * years * 12", name="interest"),
        C("B4", "effect", "if balance > 100_000:\n    print('Six figures!')", name="milestone"),
        C("D1", "markdown", NOTE, name="plan"),
    ),
)
document.save("savings.workbook.py")
```

`CellDefinition(id, kind, source, name=…, view=…, enabled=…, trigger=…)`; kinds are
`input`, `formula`, `resource`, `effect`, `markdown`. Useful `SheetDocument` fields:

| Field | Purpose |
| --- | --- |
| `packages=("pandas", "plotly")` | Requirements (written as the PEP 723 header) |
| `imports=("import pandas as pd",)` | Imports shared by all cells |
| `code="def money(x): ..."` | Shared code |
| `variables={"REGION": "EU"}` | Environment variables (`env["REGION"]`) |
| `sheet_name="Inputs"`, `sheets=(SheetTab("Budget"),)` | Sheets; cells on other sheets have ids like `"Budget!A1"` (`from reaktiv_workbook.model import SheetTab`) |
| `column_widths={"A": 200}`, `note_order=("D1",)` | Layout |

Presentation of a cell goes in `view`:

```python
C("A1", "input", "5", name="rate", view={"widget": {"type": "range", "min": 0, "max": 15, "step": 1}})
C("C1", "formula", "figure", name="chart", view={"display": "rendered", "span": [3, 8]})  # dashboard tile, 3 columns × 8 rows
C("E1", "markdown", "Inputs are on the left.", view={"page": False})                      # a note in the grid, not a note page
```

Widget types: `number`, `range`, `checkbox`, `select` (with `options`), `text`, and for
small apps `list` (add/remove strings; the cell holds a list), `multiselect` (with
`options`; the cell holds the ticked ones), `textarea`, `date` (an ISO string), and
`button` (the cell holds a click count: whatever reads it runs on each click),
plus `file` and `folder` (path strings; **Browse…** in a CLI session, manual entry
with browser Python). See [Widgets: use and extend](WIDGETS.md) for path semantics and
the widget extension APIs.

### Python values in inputs

An input can initialize from a function cell. For a formula labeled make_state
with source “def make(): return np.zeros(10)”, enter make_state() in an input named
state. It stores the returned array; changing the function does not reset the input.
Apply changed initialization code or restart the kernel to initialize again.
Use a formula or linked input when the default should follow other cells.

An effect or action can write cells.state.set(make_state()); an embedded script
can write session.inputs.state.set(value). Values remain real Python objects.
Literal writes are saved as source. Other values stay in the kernel, marked
**Runtime value** in the inspector; saving retains the initializer so reopening
can reconstruct the starting state.

[Workbook format](WORKBOOK-FORMAT.md) describes the Python file syntax.

Notes inherit the widget type configured in the cell inspector. The note insertion
menu selects an input cell, with no separate widget type. While editing a note,
hover or keyboard-focus a direct input reference to reveal **Show as widget**.
Hover or focus its widget to reveal **Show value** and switch back. Both are saved note edits
and support undo/redo. A note URL cannot change
that type. Choose **Single choice (radio buttons)** for one string option, or
**Multiple choice** for a list of selected strings. Options can be reactive.

### Linked inputs

A linked input combines a formula with a writable value. Its derivation stays in `source`;
an optional `override` holds the manual value as input text (Python literal or plain text):

```python
C("A1", "input", "100", name="base_price")
C("B1", "linked", "base_price * 1.2", name="price")
C("B2", "linked", "base_price * 1.2", name="negotiated_price", override="110")
```

An optional **Computation** field enables the full previous-state form of `LinkedSignal`.
The normal code is its Source; Computation receives `source` (the current source result)
and `previous` (`None` initially, otherwise `.value` and `.source`). `.value` includes
manual overrides. For example, retain a selected item while it remains in the options:

```python
C("A1", "input", "['red', 'green', 'blue']", name="options")
C("B1", "linked", "options", name="selection", computation="""
previous.value if previous is not None and previous.value in source else source[0]
""")
```

Only reactive reads in Source subscribe the linked value to changes. Computation runs
untracked, as in native Reaktiv; put trigger dependencies in Source. A successful source
recomputation clears the override marker, but Computation may retain the previous value.
Reset starts fresh with `previous is None`. Leaving Computation empty keeps the original
simple behavior. Edits to either stage reset the derivation; both stages survive saves,
label renames, moves, copies, and editor drafts.

Native files use a computation method and `@linked(computation=method)` over the source
method. Each model instance owns its own previous state.

In files, these are `@cell(...)` methods over `@linked` from reaktiv. A saved override is
`@cell("B2", override="110")`; the decorated method still returns its derivation. The
plain Python model restores that value once per instance and remains reactive.

Users can override through the inspector or any built-in widget. Changing a source dependency's
value recomputes the linked value (using Computation when provided) and clears the override marker. **Reset to
derived value** resets it immediately. Editing the derivation in the app resets it too;
renaming a label or moving the cell preserves its override. Undo restores both pieces.
Saving and reopening retains the override; `--set price=110` overrides it in the CLI.
An override does not bypass an invalid derivation: the error is reported and saved override
text is retained so it is not lost. Use `"None"` for an explicit None override, or `'""'`
for an empty string; omitted `override` means the derived value.

### Reactive widget settings

Built-in widget `min`, `max`, and `step` can be numbers or Python expressions stored
as strings. `options` can be a list of strings or an expression returning that list:

```python
C("A1", "input", "100", name="upper_limit")
C("A2", "input", "5", name="amount", view={"display": "rendered", "widget": {
    "type": "range", "min": 0, "max": "upper_limit * 2", "step": 1,
}})
C("A3", "input", '["Basic", "Pro"]', name="choices")
C("A4", "input", '"Basic"', view={"widget": {"type": "select", "options": "choices"}})
```

In the saved `.workbook.py` file, these expressions become real Python callbacks:

```python
choices = cell("A3", field(["Basic", "Pro"]))
plan = cell("A4", field("Basic"), view={"widget": {
    "type": "select", "options": lambda self: self.choices(),
}})
```

The same pattern works for dropdown and multiselect options, and number/slider
bounds. Callbacks take `self`, can call helpers or use conditional expressions,
and read cells with `self.label()`. They are parsed without running during loading.
The JSON/document API keeps expressions as strings for transport and editing.

Settings are computed leaves of the reactive graph. They update when referenced cells
change, without changing the input's stored value. A value outside newly narrowed bounds
is retained; only user interaction changes it. In the inspector use `=choices` for an
options expression. Bounds must be finite numbers, step positive, and min no greater than
max; options must be at most 1000 strings. Invalid grid settings disable the control.

Notes use existing Python interpolations in query parameters, for example
`[Amount: {{ amount }}](#sheet-input:amount?min=0&max={{ upper_limit }}&step=1)`
or `options={{ choices }}`. Prefer a named formula cell for complex settings expressions.

### Editing the file by hand

New saves use [Python workbook format 2](WORKBOOK-FORMAT.md): one `Worksheet` class
per sheet, composed by one `Workbook` class containing all actions. Legacy `@sheet`
files still open and upgrade when saved. Imports and shared helpers go before the
worksheet classes; PEP 723 declares dependencies. Inside a worksheet class, cells
are members and references are method calls:

```python
deposit = cell("A1", field(200), label="deposit")           # input

@cell("B2", label="balance")                                # formula
@computed
def balance(self):
    months = self.years() * 12
    return self.deposit() * ((1 + self.monthly_rate()) ** months - 1) / self.monthly_rate()

@cell("D1", label="plan")                                   # note
@markdown
def plan(self):
    return """# Savings plan

    You have **{{ f'{self.balance():,.0f}' }} €**."""
```

Rules: `@cell` is the outermost decorator; a formula `return`s its value; another cell is
`self.name()` and a resource's value is `self.name.value()`; a resource is a pair
(`@resource` returning the tuple of what it depends on, plus `@name.loader`). Comments
inside cells are kept. Copy the patterns from `examples/*.workbook.py`; when in doubt,
generate the file from Python instead. Cross-sheet Python reads use
`self.workbook.Sheet.member()`; workbook actions use `self.Sheet.member()`.
The complete file structure and IDE typing are documented in
[WORKBOOK-FORMAT.md](WORKBOOK-FORMAT.md).

### Opening older workbook files

Legacy format-1 Python workbooks still open, with a **Format 1 workbook** notice.
With `reaktiv-workbook edit`, saving upgrades the file to format 2 in place;
commit the old version first if older Reaktiv Workbook versions still need
it. In the browser, the upgrade downloads under the name chosen in the notice. See
[Workbook format](WORKBOOK-FORMAT.md).

## Worksheet headings and labels

Right-click an empty grid cell and choose **Text / heading**, or choose that type in
the cell editor. It renders Markdown directly in the grid, with no paragraph icon.
Use # for a heading, bold for a label, and live interpolations for changing values.
Drag the tile corner to give longer text more space.

Text created in the grid stays out of the Notes sidebar by default. The Notes
sidebar's **+** creates a **Note page** instead. Select any Markdown cell and use
**Show in Notes**, next to its cell type in the inspector, to change its sidebar
membership. This preserves its text and reactive references and supports undo.

## 5. Notes

Markdown, plus:

| Syntax | Result |
| --- | --- |
| `{{ balance }}` | Live value. Any expression works: `{{ f"{balance:,.0f}" }}`, `{{ total / count }}` |
| `{{ chart }}` | The cell's plot, table (DataFrame), HTML, or widget — only for a bare reference |
| `[Rate: {{ rate }}](#sheet-input:rate)` | The input’s configured widget. Choose its type and reactive settings in the cell inspector: number, slider, checkbox, dropdown, radio, text, long text, date, list, multiple choice, file path, folder path, or button. |
| `$E = mc^2$`, `$$…$$` | LaTeX math (KaTeX); `{{ }}` works inside |
| ```` ```mermaid ```` code block | Diagram; `{{ }}` works inside |
| `[{{ chart }}](#sheet-output?layout=wide)` | The value wider than the text (`wide`, or `full` for the whole note area); add `width=…&height=…` for a plot's size |
| `[Chapter 2](#note-p2_free_fall)` | Link to another note, by its label (or cell id: `#note-F3`) |

Plots: return a Matplotlib figure (call `plt.close(figure)` before returning it) or a
Plotly figure from a formula, then put `{{ label }}` in a note. Long signals (more than
50 000 points in a trace) are resampled for display and zooming shows the real samples;
`resampled(fig, points=5000)` sets the detail or resamples smaller figures.

Widgets (anywidget): keep their data in input cells and bind it —
`bind(VectorPad(), x=vector_x, y=vector_y)` — then read `vector_x`, never `vector.x`
(reading a widget's state in a cell is an error). The view writes changes back to the
input cells, so the values are saved and `--set vector_x=6` works in the CLI.

HTML: return `html(...)` from a formula for cards, boards, or styled summaries (no
JavaScript; scripts and event handlers are removed). Escape text you insert with
`from html import escape`, keep the CSS in an input cell, and use `light-dark(light, dark)`
colours so it follows the theme:

```python
C("C1", "formula",
  "from html import escape\n"
  "cards = ''.join(f\"<div class='card'>{escape(task)}</div>\" for task in open_tasks)\n"
  "html(f'<style>{board_css}</style><div class=\"board\">{cards}</div>')",
  name="board", view={"display": "rendered", "span": [4, 8]})
```

## 6. Validating — always, with the CLI

The CLI evaluates a workbook exactly as the app does. **A workbook is not done until
`--check` passes.** From the repository root in this repository:

```bash
uv run -q --no-project --with numpy --with-editable . \
  python -m reaktiv_workbook savings.workbook.py --check
```

(Add `--with pandas --with plotly …` for the packages the workbook needs;
`--requirements` prints them. With the package installed, the command is `reaktiv-workbook`.)

| Option | Use it to |
| --- | --- |
| `--check` | Exit 1 and list failing cells on stderr — the pass/fail gate |
| `--types [strict]` | Type-check with pyright instead of running: one line per finding (cell, line); exit 1 on type errors |
| `--cell balance --cell B3` | Print only these cells (label or id) — **look at the numbers**, not only at the exit code |
| `--set deposit=900 --set region='"EU"'` | Override inputs (Python literals; strings need quotes) to test scenarios and edge cases |
| `--note plan` | Print a note as it renders, with values filled in |
| `--export out/` | Write plots as images and notes as Markdown (with the images they use from `assets/`) — open the PNGs when you changed a chart |
| `--json` | The full result (values, errors, dependencies, effects, timers) for scripts |
| `--save out.workbook.py` | Save, with overrides and a fresh output snapshot |
| `--watch [N]` | Keep running and fire clock cells (stop after N ticks) |

A good check sequence:

```bash
… savings.workbook.py --check                                        # nothing raises
… savings.workbook.py --cell balance --cell interest                  # values are plausible
… savings.workbook.py --set deposit=900 --set years=8 --cell balance  # the model reacts
… savings.workbook.py --set rate_percent=0 --check                    # edge case → finds a ZeroDivisionError
… savings.workbook.py --note plan                                     # the note reads well
```

Reading errors: a cell shows `#ERROR` with the Python exception; cells that depend on it
fail with the same error, so fix the first one in the chain. `--check` tells you which:

```text
error	B2	ZeroDivisionError: float division by zero
    Cell B2, line 2
      return A1 * ((1 + B1) ** months - 1) / B1
error	B3	ZeroDivisionError: float division by zero
  caused by B2
```

In the app, the same information is in the **Logs** panel (click *⚠ problems* in the
status bar): failing cells by root cause, the failing line, the traceback, plus `print()`
output and warnings. `NameError` usually means a misspelled label or a missing
import/package. `print()` is a fine debugging tool: its output lands in the log, per cell.

## 7. Running on a timer

```python
every(30)                                  # every 30 seconds
every(minutes=5)                           # every 5 minutes
at("08:00", "17:30", days="mon-fri")       # a schedule, local time
every(refresh_seconds, enabled=running)    # interval and pause switch from input cells
```

Put the call in a formula cell labelled, say, `clock`. Its value is the time of its last
tick; every cell that mentions `clock` re-runs on each tick — a resource reloads, an
effect fires. A resource or effect can also call `every()` itself. Clocks tick while the
workbook is open in the app or runs under `--watch`; missed ticks are not caught up.

Typical uses: polling an API or a sensor, live dashboards, reports at fixed times, alerts
and heartbeats. See `examples/scheduled-pipeline.workbook.py`.

## 8. Best practices

**Structure**

- Label every cell that is referenced. Labels are the vocabulary of the model.
- One idea per cell. Small cells make the graph readable and recompute less.
- Lay out left to right: inputs in column A, calculations next, notes and charts after
  that. Use sheets for stages (Inputs, Model, Report).
- Put a comment line above an input value to say what it is and its unit.
- Repeated logic belongs in a **function cell** (a formula ending in `def`), not copied
  between cells: other cells call it by its label and the graph shows who uses it.
  Constants and lookup tables are input cells. Keep **shared code** for what cannot be a
  cell: state that must survive recomputation (a history, a cache).

**Reactivity**

- A cell re-runs when something it *mentions* changes. To make a cell run less often,
  mention less; to make it run on time, mention a clock.
- Formulas are pure: same inputs, same output, no side effects. Side effects go in
  effects; slow or awaiting work goes in resources so the sheet never blocks.
- Do not mutate a value you got from another cell (`items.append(…)`); build a new one.
- State across runs (history, counters, caches) lives in shared code, a file, or a
  database — never in a cell.
- Effects that do something irreversible (send, delete, pay) should be *manual*
  (`trigger="manual"`) or guarded by an input checkbox.

**Notes**

- Lead with the result, then the controls, then the explanation.
- Format numbers in the note (`{{ f"{x:,.0f}" }}`), keep the cell's value numeric.
- Bind controls to input cells so readers explore without touching formulas.

**Portability**

- The in-app kernel is Pyodide: pure-Python packages and those built for it (NumPy,
  pandas, Matplotlib, Plotly, …), browser networking only. For local files, databases,
  or native packages open the workbook with `reaktiv-workbook edit` (add `--sandbox` to install its
  declared packages) — and say so in a note.
- Keep examples and tests offline and deterministic: embed a small dataset, simulate
  the API.
- No secrets in the file: not in inputs, not in environment variables.

**For agents, specifically**

- Generate with `SheetDocument` rather than writing class syntax by hand.
- Run `--check`, then read values with `--cell` and try a scenario with `--set`.
  "No error" is not "correct".
- After changing a chart, `--export` and look at the image.
- Keep labels stable when editing an existing workbook; notes and other cells use them.
- Saved outputs are regenerated on save in `<filename>.snapshot.json` beside the workbook.
  Keep the companion with the workbook when sharing saved previews; Git ignores it locally.

## 9. Where to look next

- `examples/` — `financial-model` (basics), `async-resource` (resources),
  `sales-performance-dashboard` (report with widgets), `plotly-dashboard` (charts, function
  cells), `anywidget-demo`, `wave-laboratory`, `vectors`, `binary-search` (custom widgets),
  `scheduled-pipeline` (timers), `calorie-coach` and `project-planner` (several sheets and linked notes), `trip-planner-app`
  (a small app built from list, multiple-choice, date, text, and button widgets).
- [Feature guide](FEATURES.md) — every feature of the app.
- [Architecture](ARCHITECTURE.md) — how the pieces fit together.


Effects can update workbook inputs with `cells.counter.set(3)` or
`cells.counter.update(lambda counter: counter + 1)`. `cells.Sheet2.counter` selects
another sheet; bare handles select the current sheet. Linked inputs support writes
as overrides and `cells.linked_input.reset()` to restore the derivation. Formula
cells remain read-only. In app cell source, use these handles directly; saved files
bind `cells = cell_refs(self, "SheetName")` inside the method and import `cell_refs`
from `reaktiv_workbook`. The app writes and removes that binding automatically.
Each successful effect commits its writes together, updates saved input literals,
and preserves input comments. `cells` is a reserved cell label/sheet name.

Per-cell **Equality** in the inspector controls change detection. The default
compares object identity, matching Reaktiv. Value and type is an explicit option; always changed
propagates every update. Custom accepts a Python lambda or shared-code function
of `(previous, current)`, returning True to retain the old value and skip dependent
updates. For example, `lambda previous, current: abs(previous - current) < 0.01`
ignores small numeric differences. This is saved as `@cell(..., equal="...")`
and works for inputs, linked inputs, formulas, resources and notes. Effects have
triggers rather than equality. Comparisons are pure and run without tracking.

For a complete walkthrough, see [Embedded workbook sessions](EMBEDDED-WORKBOOK-SESSIONS.md).

A production script can use the worksheet through `WorkbookSession.load(path)`.
Read results with `session.values.total()` and write inputs with
`session.inputs.quantity.set(5)` or `.update(lambda quantity: quantity + 1)`.
`session.open_editor()` opens the app against that same running graph. Build the
app first, or pass a local `app_url` while developing. Keep the session context
open while your business process runs. `session.save()` and the editor's Save
write the original worksheet and its snapshot sidecar. See the runnable example
in `examples/embedding/run_pricing.py`; dependencies come from the script's Python
environment. The worksheet itself remains a normal `ReactiveModel` declaration.


## Resource parameters and live dependencies

Simple **Async resource** cells remain the default. Write async Python and reference
cells normally; the app captures all source references before starting the loader.
These reads stay consistent across `await`. Every referenced cell participates in
that automatic snapshot, including references in branches that do not execute.

For more control, select **Resource parameters → Explicit · synchronous Python**
in the cell inspector. The Parameters editor accepts an expression or a synchronous
block with a final expression or `return`. For example:

```python
# Parameters
{"url": request_url, "limit": limit} if enabled else None
```

```python
# Async source
response = await client.get(params["url"])
return response.json()[:params["limit"]]
```

Put cell reads in Parameters and use `params` in the async body. Direct cell reads
in an explicit loader are rejected so its inputs cannot change halfway through a
request. Shared imports and non-cell helpers remain available. The loader context
is also available as `resource_params`, including its `.params`, `.previous`, and
`.cancellation`; `cancellation` is a convenient alias for the event.

Only reads actually made by the parameter computation establish dependencies.
When `enabled` is false in the example, changing URL or limit does not start a
request. Returning `None` puts the resource into **idle** and prevents a new load;
a previous resolved value can remain available. Normalizing parameters, for example
`query.strip()`, avoids reloading when the effective request is unchanged.
Environment changes and the resource's own clock ticks still invalidate requests.
Parameter values are captured by reference, not deep-copied: avoid mutating them
in place, and keep parameter code free of external actions.

The file stores the synchronous stage as the `@resource` method and the async body
as its `.loader` method. `@cell(..., resource_mode="simple")` identifies the
app-generated automatic snapshot; explicit resources use `resource_mode="explicit"`.
An authored resource without a mode marker is explicit, and its parameter function
is preserved. Both writers make simple loaders use their captured parameters rather
than reading `self` again after an await.

The dependency graph shows **live reads from the latest evaluation**, not every
possible source reference. Branches change edges, and reads in called helper
functions are attributed to the calling calculation. Input cells have no calculation
dependencies; automatic formulas, linked inputs, notes, and effects track reads.
Untracked reads are excluded. Manual effects acquire observed reads when run.
**Not run** marks a cell with no observed evaluation, and **Partial** marks a failed
cell whose reads may be incomplete. Static source references remain available for
editing, rename/move operations, and conservative feedback checks.

This does not change evaluation policy: creating a display snapshot still reads
all cell results. Closing or hiding a view does not disable calculations.

## Reactive widget labels and state

Built-in controls use the configuration of their input or linked-input cell in both
Notes and Cells. In the inspector, select a widget, then configure its **Label** and
expand **Visibility and state** for additional settings. Choose **Auto** when inserting
an input widget into a note to inherit the cell's widget type and settings.

- **Label** and **Placeholder** accept literal text or `=Python expression`.
- **Disabled**, **Visible**, **Loading**, and **Pressed** accept `True`, `False`, or
  `=Python expression`. Pressed is a button's visual state; loading also disables
  interaction. An omitted visible setting defaults to True; other flags default to False.
- Dropdown and multiple-choice **Options** accept comma-separated choices or an
  expression such as `=available_devices`. Expressions return lists of unique strings.
- **Button action** can count clicks or toggle a Boolean input. Toggle mode derives
  its pressed indicator from its value unless an explicit pressed setting is provided.

For example, a button can have `="Stop" if running else "Start"` as its label,
`=not ready` as its disabled state, and `=working` as its loading state. A dropdown
can obtain its options from a formula that depends on a selected category.

Settings are cached computed leaves in the reactive graph. Their observed reads
appear as widget configuration dependencies; changing settings does not reset the
bound input. Hidden, disabled, or loading controls preserve their values. A removed
choice stays visible as unavailable; multiple-choice selections can be explicitly
unchecked. Configuration errors appear separately from calculation errors and
prevent interaction until corrected.

In JSON definitions, label/state expressions use an explicit expression object so
literal text remains unambiguous:

```python
view={"widget": {
    "type": "button",
    "buttonMode": "toggle",
    "label": {"expr": '"Stop" if running else "Start"'},
    "disabled": {"expr": "not ready"},
}}
```

The executable `.workbook.py` stores real Python callbacks:

```python
running = cell("A1", field(False), view={"widget": {
    "type": "button",
    "buttonMode": "toggle",
    "label": lambda self: "Stop" if self.running() else "Start",
    "disabled": lambda self: not self.ready(),
}})
```

This snippet assumes another input named `ready`. Both writers preserve callbacks
as editable expressions, including references when cells move or labels change.

A note can override presentation through explicit link parameters. Numeric bounds,
options, label, and placeholder can override inherited settings. Cell-level disabled,
hidden, and loading states still apply; note parameters can further restrict them.
Use `{{ expression }}` for reactive link parameters. A label written directly in a
note can also include live expressions, excluding the bound input's value placeholder.
Prefer cell configuration when the same control appears in several notes.

Try **Examples → Reactive app controls** for dependent choices, dynamic labels,
visibility, a toggle button, and a simulated busy state. This example is a form
model; it does not start a service or create a background thread.


### Workbook View and Edit modes

Use the **View / Edit** control in the top bar to change the mode for the whole
workbook, across worksheets, Notes, Cells and split panes. **View** keeps inputs,
buttons, plots and widgets interactive while locking source and layout editing.
**Edit** enables authoring throughout the workbook. Selecting or inspecting a cell
does not change the mode, and there are no per-cell mode switches.

Ctrl/Cmd+Shift+E toggles the global mode. Existing workbooks open in View; new
workbooks start in Edit. Switching to View preserves drafts. The saved local draft
remembers the mode. Python actions and MCP writes remain independent of this UI
preference.

For an action button, enable **Run / Cancel while running** in its widget settings.
The button runs its configured action when idle, requests cancellation of that
specific active invocation when running, and shows **Cancelling…** until it ends.
Cancellation is cooperative; it does not roll back writes or stop detached work.
Existing action buttons retain their original Run behavior unless enabled.

### Fit the cell view

Click **Fit** beside the cell view's zoom percentage to fit the occupied area,
including resized tiles and unsaved cell drafts. Custom row heights and column
widths are respected; unused trailing rows and columns are ignored. Fit uses the
10–100% zoom range, so very large worksheets may still need scrolling.
It returns the viewport to the top left and affects only that pane. Click the
percentage to reset to 100%.

### Compare worksheets in split view

Choose **Split**, set both pane view pickers to **Cells**, then choose a worksheet
in each pane's sheet picker. Both panes may show the same worksheet. Each keeps its
own scroll position and zoom, and edits update the same workbook runtime.

You can also choose **Notes** in both panes and select a different note in each,
including two notes from the same worksheet. **Graph** remains available in either
pane; **This sheet only** uses that pane's worksheet. Click a pane to make it the
context for editing and keyboard actions. **Swap sides** exchanges views, worksheets,
notes, and zoom settings together. On narrow phones the panes stack vertically.
Pane choices are kept for the current split-view session.

## Explicit commands

Use `@action` model methods for user-triggered commands, with a visible Actions editor,
a global Run action picker, pinned commands in the picker, argument forms and note buttons. See [Workbook actions](ACTIONS.md) for a complete
example, input-write behavior, cancellation and embedded-session calls.

## When saving fails

A **Workbook not saved** dialog explains what stopped the save. Validation issues
are listed in full; a runtime check failure prevents writing an unchecked file.
File errors identify the failed step and include the original error. If the source
was written but its snapshot or a later step failed, the dialog says **Save
incomplete** and explains what was saved. Choose **Try again** after resolving the
problem, or **Back to workbook** to continue editing. Changes remain marked unsaved
until the save finishes. Saving while Python is stopped still supports an offline
save, identified as unchecked in the success message.

### When saving is blocked

The save dialog names affected cells and offers **Open cell** to inspect them.
For invalid Python, it shows the line in the cell editor, surrounding code, and
a correction hint. A generated-file line refers to the proposed Python file,
which can differ from the file already on disk. If valid cell code cannot be
generated correctly, the message identifies an app problem rather than asking
you to change that code. The existing file is not overwritten; edits remain open.

Empty cells and cells containing only comments can be saved. Comments do not
produce a displayed value: use a Markdown cell for headings, or put text in Python
quotes when it should be an input value.

### Keeping acquired input data out of Python source

Select an **Input** cell and uncheck **Save runtime value in Python file** in its
inspector. Actions and effects still update its live value and dependent cells,
but saving retains the initialization code instead of embedding the latest data.
Reopening runs that initializer again. This also skips conversion of large lists
into Python literal source on every write. Existing inputs keep saving values by default.

For example, an acquisition buffer can start empty:

```python
samples = cell("A1", field([]), save_value=False)
```

The equivalent document field is `"saveValue": false`. The option applies to input
cells, not linked inputs. Explicitly editing input code or a built-in value widget
still changes the saved initialization code. If a cell already contains a large
literal, replace its initialization code with a small default such as `[]`;
turning off the checkbox does not remove existing source data.
Output snapshots are a separate setting; disable them too if acquired values
should not be included in the companion snapshot file.

### Saving output snapshots

In **Settings → Workbook → Saving workbooks**, choose whether to save the output
snapshot JSON. This choice is saved in the workbook and travels with it. Turning
it off skips calculated values/plots in the companion file; Python source, input
values, notes and image assets still save. Existing companions are removed on the
next CLI/session save. Old workbooks default to snapshots enabled. In Python,
use `SheetDocument(save_outputs=False)` or `"saveOutputs": False` in the `@sheet`
configuration. Changing this setting does not evaluate cells.

Action writes publish directly to the reactive graph: after setting an input, a
formula read in the same action reflects the new value, with no flush command.
Cells, notes, tables and plots also refresh automatically while actions run;
rapid changes are coalesced into throttled display updates. Source/history changes
are accepted once when the action finishes.
Use `from reaktiv import batch` and `with batch():` around synchronous action
writes to defer effects until the block exits. Computed reads inside the block
still return current values; batching is not a transaction or an atomic UI frame.
Do not hold a batch across an `await`.
Async resource results still require their normal readiness/completion. Earlier
action writes remain if a later step fails or is cancelled; effect cells retain
staged writes that commit only on success. See [Workbook actions](ACTIONS.md).

Cell moves, swaps and pastes account for the full resized tile footprint, not only
its anchor coordinate. Occupied areas reject the operation without applying it.
While dragging in a worksheet, dashed outlines show where the complete cell or
selected group will land. Labels identify the destination and whether the drop
swaps cells; red outlines and a blocked cursor indicate an invalid overlap.
The preview follows worksheet zoom and custom row/column sizes without changing
the workbook until you drop.
New notes skip coordinates covered by resized tiles. These checks also apply to
agent-created/moved/resized cell definitions through MCP.


Changing a cell label in the inspector refactors static references in cells,
notes, widget expressions and actions in one undo step. Assigning a first label
replaces coordinate references; removing it returns to coordinates. Apply or
discard other drafts first. Conflicting or shadowed labels are refused. Dynamic
Python references built with `getattr` cannot be refactored automatically.

## Reactive cell highlights

In the cell inspector, enter a **Reactive color** Python expression and choose
**Apply color expression**. Use a cell label (`warning_color`), a cross-sheet
reference (`Status.warning_color`), a signal call, or an expression such as
`'#ffcccc' if temperature > 80 else '#ccffcc'`. Return `None` or `''` to clear
highlighting. Fixed colors remain available and provide the fallback on errors.
The expression changes presentation independently of the cell's value. The grid
and graph update from live snapshots, including during actions. The inspector
and MCP report color errors separately from calculation errors.

In files, this is `view={'color': lambda self: ('#ffcccc' if self.temperature() > 80 else '#ccffcc')}`
on a `cell` declaration. MCP uses `set_cell_colors(..., expression=...)` or
`view.color={'expr': 'warning_color'}` in a complete cell definition. Expressions
follow cell moves, label/sheet renames and sheet copies.

## Open the standalone IDE

With the Python package installed, use `reaktiv-workbook edit budget.workbook.py` to
open or create a workbook in your browser, or `reaktiv-workbook run budget.workbook.py`
to interact without authoring. The CLI starts the local server and Ctrl+C stops it.
Running `python budget.workbook.py` only evaluates the file. Workbook packages must
be installed in the same Python environment. See [Standalone CLI](STANDALONE-CLI.md).

Actions are imported from `reaktiv_workbook`; primitive signals, models and batching are imported from `reaktiv`. Opening older workbooks and saving them updates these imports automatically.
