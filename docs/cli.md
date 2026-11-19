# Command line

```bash
uv tool install reaktiv-workbook     # or: pip install reaktiv-workbook
uvx reaktiv-workbook --help          # or run it without installing
```

The examples below use the installed `reaktiv-workbook` command; with uvx, put `uvx` in front.

## Open and create

| Command | Does |
| --- | --- |
| `reaktiv-workbook new [FILE]` | Create a workbook and open it (never overwrites) |
| `reaktiv-workbook new --from welcome` | Start from a bundled example (`welcome`, `budget`, …) |
| `reaktiv-workbook edit FILE` | Open a workbook in the editor; creates it if missing |
| `reaktiv-workbook run FILE` | Open it as an app: controls and actions work, editing is off |

The editor runs in your browser; the command serves it until you press Ctrl+C. Closing
the browser does not stop it.

| Option | Use it to |
| --- | --- |
| `--sandbox` | Install the workbook's declared packages into an environment of its own (needs [uv](https://docs.astral.sh/uv/)) |
| `--mcp` | Let coding agents work in the open workbook ([Agents](agents.md)) |
| `--port 8765` | Use a fixed port |
| `--headless` | Print the link instead of opening the browser |

Without `--sandbox`, cells run in the Python that started the command, so install the
packages your workbook uses there (`pip install plotly pandas`). If some are missing,
the command names them and, when uv is available, offers to use a sandbox.

**Adding packages while editing.** After you add a package in *Settings → Workbook*,
choose **Restart with these packages** (in a sandbox) or **Restart in a sandbox** (in your
own Python); the editor also offers it when declared packages are missing. Python
restarts in a sandbox with the new list, on the same address: the browser reconnects and
the workbook stays open, unsaved edits included. Values computed at runtime are
recomputed. Your own Python environment is never changed.

## Check and evaluate

| Command | Does |
| --- | --- |
| `reaktiv-workbook check FILE` | Run every cell; exit 1 and list errors if any fail |
| `reaktiv-workbook evaluate FILE [options]` | Run and print values |
| `reaktiv-workbook export FILE DIR` | Write charts as images and notes as Markdown |

Options for `evaluate`:

| Option | Use it to |
| --- | --- |
| `--cell balance --cell B3` | Print only these cells |
| `--set deposit=900` | Override an input (a Python literal; strings need quotes: `region='"EU"'`) |
| `--note plan` | Print a note with its values filled in |
| `--check` | Exit 1 if a cell fails |
| `--types [strict]` | Type-check with pyright instead of running |
| `--json` | Print everything as JSON |
| `--save out.workbook.py` | Save, with overrides and fresh saved outputs |
| `--watch [N]` | Keep running and fire timers (stop after N ticks) |
| `--requirements` | Print the packages the workbook declares |

A good check after any change:

```bash
reaktiv-workbook check model.workbook.py                              # nothing fails
reaktiv-workbook evaluate model.workbook.py --cell balance            # values look right
reaktiv-workbook evaluate model.workbook.py --set rate_percent=0 --check   # edge cases
reaktiv-workbook export model.workbook.py out/                        # look at the charts
```

Errors name the cell, line and cause. Cells that fail because they read a failing
cell say `caused by B2`: fix that one first.

```text
error	B2	ZeroDivisionError: float division by zero
    Cell B2, line 2
      return A1 * ((1 + B1) ** months - 1) / B1
error	B3	ZeroDivisionError: float division by zero
  caused by B2
```

## Running the file directly

`python model.workbook.py` evaluates the workbook like `evaluate`; it never starts the
editor.

## Safety

The editor listens only on your own computer and uses a secret link. Workbook code is
ordinary Python with your permissions, and automatic effects run on startup: **open
only workbooks you trust**. `run` mode hides editing but is not a sandbox; the
workbook's code is still sent to the browser.
