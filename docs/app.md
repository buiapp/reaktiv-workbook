# Using the app

## Views

| View | Shows |
| --- | --- |
| **Notes** | Pages with live values, controls and charts |
| **Cells** | The grid of inputs, formulas and outputs |
| **Graph** | What depends on what |
| **Split** | Any two views side by side, e.g. a note next to its cells |
| **Actions** | The workbook's [commands](actions.md) |

Switch views with Ctrl/Cmd+1–4. In **Split**, each side has its own view, sheet and
zoom; **Swap sides** exchanges them. The **View / Edit** switch (Ctrl/Cmd+Shift+E) locks
or unlocks editing for the whole workbook; controls keep working in View mode.

## Python must be running

A workbook you open shows its saved results but runs no code until you choose
**Start**. This lets you review it first. Cells can be edited only while Python runs.

| Control | Does |
| --- | --- |
| **Start** | Runs the workbook |
| **Interrupt** (Ctrl/Cmd+.) | Stops the code that is running now |
| **Restart** | Starts Python fresh and reruns everything |

A cell that runs for more than 3 seconds shows a **Stop** button. `while True:` will
not hang the app.

## Editing cells

- Type into a cell; start with `=` (formula), `~` (resource) or `!` (effect).
- Press **Enter** or double-click to edit. **Shift+Enter** or **Ctrl/Cmd+Enter** applies.
- The **cell panel** (press **I**) holds the label, type, widget, colour and other
  settings.
- Editing one cell and selecting another keeps your edit as a **draft** (dashed outline)
  until you apply or discard it.
- Drag a cell to move it; references follow. Copy, cut and paste work across sheets
  and windows.
- Select several cells and press **Alt+L** to collect them into a list
  (`[rent, groceries]`), or **Alt+D** for a dict.
- **Ctrl/Cmd+Shift+F** searches labels and code across all sheets.

The editor completes cell names and Python. With a local Python kernel it also knows
the types of your values, shows call signatures, and checks [type hints](#type-checking).

## The graph

Select a cell to see what it reads (purple) and what reads it (green). Useful options:

- **Focus on selection**: only the selected cell's chain, optionally 1–3 steps deep.
- **This sheet only**, **Hide notes**, **Hide unconnected**: thin out a large graph.
- **Show outputs**: charts and controls inside the graph cards.
- **Direction**: horizontal or vertical. **Scrollable levels** for very wide graphs.
- **Errors only**: find where a failure starts (**Go to origin**).

In **Cells**, the dependency-arrow depth setting draws the same connections over the grid.

## Finding problems

The status bar shows **✓ No problems** or **⚠ 2 problems**. Click it (or press
Ctrl/Cmd+Shift+L) to open **Logs**:

- **Problems** lists failing cells by root cause, with the failing line and traceback.
  Cells that fail only because they read a broken cell are grouped under it: fix the
  first one.
- The log holds `print()` output, warnings and errors, per cell. **Copy** puts them on
  the clipboard for an issue or a chat.

`NameError` usually means a misspelled label or a missing import or package.

The **Python ›** console in the bottom bar runs code against current values (`rate`,
`Budget.rate`). Console commands are not saved.

## Saving

**Save** (Ctrl/Cmd+S) writes the `.workbook.py` file. Before writing, the app reads the
new file back and compares it with what you see; if anything would be lost, nothing is
written and the message names the cells involved.

- **Saved outputs**: the last values, tables and charts are also saved in
  `name.workbook.py.snapshot.json`, so the workbook opens instantly without running.
  Turn this off in *Settings → Workbook*.
- **Save As** (Ctrl/Cmd+Shift+S) saves a copy. Workbooks from an `examples` folder always
  ask where to save, so examples are never overwritten.
- Unsaved changes survive a browser reload as a local draft.

**Git.** For a workbook in a git repository opened with `reaktiv-workbook edit`, the
title bar shows the branch, and **Changes** shows what changed cell by cell. You can
commit, push and pull from there.

## Type checking

Give a formula a **Type hint** (`float`, `pd.DataFrame`) in the cell panel. With a local
Python kernel, pyright checks how cells use each other's values and shows findings in
the editor and the status bar. Findings never stop a cell from running. Choose *off*,
*standard* or *strict* in *Settings*; `reaktiv-workbook evaluate FILE --types` checks
from the command line.

## Settings

*Settings* (Ctrl/Cmd+,) has two tabs:

- **Workbook** (saved in the file): name, packages, imports, environment variables,
  saved outputs.
- **App** (this device): [theme](themes.md), drafts, type checking, memory display.

## Where Python runs

| Opened with | Python | Packages |
| --- | --- | --- |
| `reaktiv-workbook edit` | your own Python | anything installed there; `--sandbox` installs the workbook's packages for you |
| The web app | Pyodide, in the browser | NumPy, pandas, Matplotlib, Plotly and other pure-Python packages; browser networking only |

Use `reaktiv-workbook edit` for local files, databases and native packages. Added a package
there? *Settings → Workbook → Restart with these packages* restarts Python in a sandbox that
has it ([Command line](cli.md)).

## Keyboard shortcuts

Ctrl on Windows and Linux, Cmd on macOS.

| Keys | Action |
| --- | --- |
| Ctrl/Cmd+S, Ctrl/Cmd+Shift+S | Save, Save As |
| Ctrl/Cmd+O | Open |
| Ctrl/Cmd+N | New note |
| Ctrl/Cmd+Alt+N | New workbook |
| Ctrl/Cmd+K | Command palette, including every action |
| Ctrl/Cmd+1–4 | Switch views |
| Ctrl/Cmd+Shift+E | View / Edit mode |
| Ctrl/Cmd+. | Stop running code |
| Ctrl/Cmd+Shift+F | Search cells |
| Ctrl/Cmd+Shift+L | Logs |
| Ctrl/Cmd+, | Settings |
| I | Show or hide the cell panel |
| Shift+Enter | Apply the cell |
| Ctrl+Space | Suggestions |
| Tab | Accept a suggestion, otherwise indent |
| Alt+L, Alt+D | Collect selected cells as list, as dict |
