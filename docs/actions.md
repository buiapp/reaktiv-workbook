# Actions

An action is a command you run on purpose: import data, reset a scenario, export a
report. Formulas run when their inputs change; actions run only when someone clicks
**Run**, presses a button, or an agent calls them. Opening or saving a workbook never
runs an action.

## Create an action

Open **Actions** (next to Notes, Cells and Graph) and choose **New action**. Write a
method, give it a **Display label**, and choose **Apply**. Applying installs the method;
it does not run it.

```python
def add_items(self, amount: int = 1) -> int:
    """Add the requested number of items to the order."""
    self.Orders.quantity.set(self.Orders.quantity() + amount)
    return self.Orders.quantity()
```

Inside an action, `self.<Sheet>.<cell>` reaches any cell:

| | |
| --- | --- |
| Read a cell | `self.Orders.quantity()` |
| Set an input | `self.Orders.quantity.set(5)` |
| Change an input | `self.Orders.quantity.update(lambda q: q + 1)` |
| Reset a linked input | `self.Orders.price.reset()` |
| Call a function cell | `self.Model.tax()(income)` |

A write takes effect immediately: reading a formula right after setting its input
gives the new value. If a later step fails, earlier writes stay.

## Run an action

- **Run action** in the toolbar (or Ctrl/Cmd+K) lists every action. Pick one, fill in
  its arguments and choose **Run**.
- **Pin action** puts frequent commands first in the list.
- The result, errors, tables and charts it returns show in the Actions panel. `print()`
  output appears in **Logs** while it runs.

## Arguments

Each parameter can use its default, a typed value, or a **bound cell**, which passes that
cell's current value (a DataFrame, an object, anything). Choose **Use these arguments
for buttons** to save the choices.

## Buttons

Put a button in a note:

```markdown
[Add items](#sheet-action:add_items)
```

Or give an input cell a **Button** widget with **Button behavior → Run action**. Each
button can pass its own arguments, so two buttons can call the same action differently.

## Long-running actions

Declare `async def` for work that waits (network, devices). **Cancel action** stops it
at the next `await`; writes already made are kept. The same action can't run twice at
once, but different actions can overlap. Cells, notes and charts refresh while it runs.

To show progress in a formula, read the action's state:
`actions.add_items.running()`, `.result()`, `.error()`.

## From Python

Actions are ordinary methods of the workbook model:

```python
book = OrderWorkbook()
book.add_items(3)
```

In a script, `session.run_action("add_items", amount=3)`; see [Python API](python-api.md).
