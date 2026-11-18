# Cells

Every cell has an address (`B2`) and, ideally, a label (`balance`). When a cell
changes, the cells that read it recompute in dependency order. Nothing else runs.

## Kinds of cells

| Kind | Holds | You write | Start a new cell with |
| --- | --- | --- | --- |
| **Input** | A value you change | A Python literal: `200`, `[1, 2, 3]`, `"Jul"` | just type |
| **Formula** | A computed value | Python; the last expression is the value | `=` |
| **Linked input** | A computed value you can override | A formula | the cell type picker |
| **Resource** | A value that arrives later (HTTP, files, slow work) | Python with `await` | `~` |
| **Effect** | No value: does something | Statements (`print`, write a file, call a webhook) | `!` |
| **Markdown** | Text, a heading or a note page | Markdown with `{{ expression }}` | the cell type picker |

Formulas, resources and effects run as the body of a function: `return` works
anywhere, also to stop early.

```python
if not rows:
    return None
total = sum(row["amount"] for row in rows)
total / len(rows)
```

## References

| You write | Means |
| --- | --- |
| `balance` | the cell labelled `balance` on the same sheet. **Prefer labels.** |
| `A1` | cell A1 on the same sheet |
| `Budget.rent`, `Budget.A1` | a cell on the sheet *Budget* |

- Labels are Python identifiers, unique within their sheet. They read better than
  coordinates and survive moving cells.
- Renaming a label in the cell panel updates every cell, note and action that uses it.
- A local variable with the same name as a cell wins. Don't name locals like cells or
  like coordinates (`A1`).
- A cell that depends on itself shows `Circular dependency detected`.

To insert references by clicking, turn on **Pick cells** (the pointer button next to
the editor) and click cells in the grid.

## Reusable code

- **Function cells**: a formula that ends with `def` or `class` holds that function.
  Other cells call it by its label: `tax(income)`. The graph shows who uses it.
- **Shared code** (… menu → *Shared code*): one Python block run once for the whole
  workbook. Use it only for state that must survive recomputation, such as a history
  of readings. Prefer function cells and input cells for everything else.
- **Environment variables** (*Workbook settings*): configuration strings read as
  `env["REGION"]`. They are saved in the file, so **never put secrets there**.

Available in every cell without importing: `math`, `statistics`, `asyncio`, `np`
(NumPy, when installed), `env`, `artifact`, `every`, `at`, and everything in shared
code. Add other imports under *Workbook settings → Imports* and packages under
*Packages*.

## Linked inputs

A formula you can override by hand. `price = base_price * 1.2` follows `base_price`
until a user types another price; it shows **Overridden** and keeps the manual value
until **Reset to derived value**, or until `base_price` changes again.

For more control, the optional **Computation** field receives `source` (the formula's
result) and `previous` (the last value, or `None`). This keeps a selection while it
is still among the options:

```python
previous.value if previous is not None and previous.value in source else source[0]
```

## Resources

A resource runs async code without blocking the workbook and shows *loading*,
*resolved* or *error*. Cells that read it update when it resolves.

```python
response = await client.get(url)
response.json()
```

It reloads when a cell it mentions changes. A running load can be cancelled from the
cell's menu or with Ctrl/Cmd+.; the previous value is kept.

To control exactly when it reloads, choose **Resource parameters → Explicit** in the
cell panel. Put cell reads in **Parameters** and use `params` in the async code:

```python
# Parameters: return None to stay idle
{"url": request_url, "limit": limit} if enabled else None
```

```python
# Async source
response = await client.get(params["url"])
response.json()[: params["limit"]]
```

## Effects

An effect runs when a cell it mentions changes: send an alert, write a file, log a
result. Make effects that do something irreversible **manual** (they then run only from
the cell panel or a button), or guard them with a checkbox input.

Effects can change inputs:

```python
cells.counter.update(lambda counter: counter + 1)
cells.approved.set(False)
cells.Settings.status.set("ready")    # another sheet
cells.price.reset()                   # a linked input back to its formula
```

An effect's writes are applied together when it succeeds and discarded if it fails.
For commands a user triggers on purpose, use [actions](actions.md) instead.

## Running on a timer

A formula that calls `every` or `at` ticks by itself. Its value is the time of the last
tick, and every cell that mentions it reruns on each tick.

```python
every(30)                                  # every 30 seconds
every(minutes=5)
at("08:00", "17:30", days="mon-fri")       # local time
every(refresh_seconds, enabled=running)    # interval and pause switch from inputs
```

Clocks tick while the workbook is open in the app or runs with `--watch`. Missed ticks
are not caught up. See the *Scheduled pipeline* example.

## Sheets

A workbook can have several sheets (tabs under the grid; **+** adds one). Sheets share
one graph: `Budget.rent` reads a cell on another sheet.

- Right-click a tab to rename, move, delete or **Duplicate** it. A duplicate calculates
  from its own inputs, which makes scenarios easy. References to other sheets stay shared.
- Copy and paste cells with Ctrl/Cmd+C and Ctrl/Cmd+V, also between windows. Cut and
  paste moves cells; references follow.

## When a value counts as changed

By default a cell counts as changed when it holds a different Python object. Change it
under **Equality** in the cell panel: *Value and type*, *Always changed*, or a custom
function that returns `True` to keep the old value:

```python
lambda previous, current: abs(previous - current) < 0.01
```

## Inputs that hold Python objects

An input can start from code, for example `make_state()` from a function cell. It runs
once; changing the function does not reset the input. Values written by effects,
actions or scripts stay real Python objects. Literal values are saved in the file;
other values are marked **Runtime value** and rebuilt from the starting code on reopen.

To keep collected data out of the file, untick **Save runtime value in Python file**
for that input.

## Good habits

- Label every cell you reference. One idea per cell.
- Lay out left to right: inputs, then calculations, then notes and charts. Use sheets
  for stages (Inputs, Model, Report).
- Put a comment above an input value to say what it is and its unit.
- Formulas only compute. Side effects go in effects or actions; slow work in resources.
- Don't change a value you read from another cell (`items.append(...)`); build a new one.
