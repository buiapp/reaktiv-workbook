# Embedded workbook sessions

An embedded session lets a Python script load a `.workbook.py` workbook, change its
inputs, read its results, and optionally open a live visual editor. The script and
editor use **one running workbook**, rather than separate copies of the model.

This guide describes the `WorkbookSession` API. Python-only use does not require a
browser. Published packages include the editor; source checkouts can use an app
build or local development server. For CLI-owned editing without a host script,
use `reaktiv-workbook edit pricing.workbook.py` ([Standalone CLI](STANDALONE-CLI.md)).

## Set up your environment

Use Python 3.12 or newer. Until this feature is published, install it from this
repository. From the repository root, using a virtual environment:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

Install any additional packages used by your workbook into this same environment.
The session uses the script's Python environment; it does not provision packages
from the workbook's dependency metadata.

Alternatively, run the existing example with `uv` from the repository root:

```bash
uv run --no-project --with-editable . \
  python examples/embedding/run_pricing.py --steps 2 --interval 0
```

That command runs without an editor and exits after two updates. The exact totals
depend on the inputs currently saved in the example workbook.

## Create a small workbook

Save this as `pricing.workbook.py`:

```python
from reaktiv import ReactiveModel, computed, field
from reaktiv_workbook import cell, sheet


@sheet({"name": "Pricing"})
class Pricing(ReactiveModel):
    price = cell("A1", field(20.0))
    quantity = cell("A2", field(3))

    @cell("B1")
    @computed
    def total(self) -> float:
        return self.price() * self.quantity()
```

The file still declares a `ReactiveModel`. `WorkbookSession` reads its workbook
structure and hosts it in a `ReactiveWorkbook`; you do not need to change the file
format or manually construct the host. Existing workbooks authored in the app can
also be loaded.

## Load, write, and read

Save this as `run_pricing.py` next to the workbook:

```python
from pathlib import Path
from reaktiv_workbook import WorkbookSession

workbook_path = Path(__file__).with_name("pricing.workbook.py")

with WorkbookSession.load(workbook_path) as session:
    print(session.values.total())       # 60.0
    session.inputs.quantity.set(5)
    print(session.values.total.get())   # 100.0
    session.inputs.quantity.update(lambda previous: previous + 1)
    print(session.values.total())       # 120.0
```

Run it with `python run_pricing.py` in the environment prepared above. Loading
initializes the workbook, including enabled automatic effects. The context manager
closes the session when the block ends, including on an exception.

`session.inputs` gives writable handles to input and linked-input cells.
`session.values` gives readable handles to value cells. Effects are actions, so
neither namespace exposes them as readable value cells. Attempting to write a
formula through `inputs` raises an error.

Input writes accept actual Python values, including arrays and custom instances.
Literal values update saved source. Other values stay in the running kernel;
saving retains the initializer, and reopening runs that initializer again.
The inspector marks these writes as **Runtime value**. Cell results also remain
actual Python objects rather than their JSON display summaries.
Treat returned objects as read-only. Mutating an array or dictionary in place does
not constitute a tracked input write; use `set` or `update` to change input state.

## Address cells and worksheets

Use a label or a coordinate:

```python
session.inputs.quantity.set(5)
session.inputs["A2"].set(5)
print(session.values["B1"]())
```

Unqualified references use the workbook's primary worksheet. To address a cell in
another worksheet, for example one named `Forecast`, use:

```python
session.inputs.Forecast.quantity.set(10)
print(session.values.Forecast.total())
session.inputs["Forecast.quantity"].set(10)
print(session.values["Forecast.B1"]())
```

Indexed references also handle worksheet names containing spaces or names that
collide with namespace attributes. Each operation resolves its reference against
the current document. Moving a labeled cell preserves its label-based handle;
renaming or deleting its label can break a script that uses that label. Treat labels
used by application code as part of the workbook's interface.

## Apply several changes together

```python
with session.batch():
    session.inputs.price.set(25.0)
    session.inputs.quantity.set(4)

print(session.values.total())  # 100.0
```

The batch queues writes and validates them before committing them together.
Reads **inside** the block see the previously committed state, not queued values.
Successive `update` operations on the same input use the preceding staged value.
An exception while preparing the batch discards queued operations; invalid writes
prevent the input batch from committing. External actions performed by effects
cannot be rolled back.

Update callbacks run on the session owner thread and receive a copy of the previous
value. Keep them short. They may read session values, but must not synchronously
start another mutation or call a function handle through the session API.

For an existing linked input, writing establishes an override and resetting restores
its derived value:

```python
session.inputs.suggested_price.set(30.0)
session.inputs.suggested_price.reset()
```

This snippet requires a linked input named `suggested_price`; it is not in the
minimal workbook above. `reset()` applies only to linked inputs. Resetting and then
updating the same linked input requires separate batches.

## Invoke a function-valued cell

If a formula cell named `calculate` returns a callable:

```python
result = session.values.calculate.call(10, scale=2)
```

`.call()` invokes it on the owner thread and awaits an async result when necessary.
By contrast, `session.values.calculate()` returns the function object itself.
Prefer `.call()` to invoking that object on your script's thread when it accesses
workbook state or owner-loop resources.

## Open the live editor

Build the app once from the repository root:

```bash
# From the repository root
npm install
npm run build
```

Then run this script in the Python environment, keeping the session alive:

```python
from pathlib import Path
from reaktiv_workbook import WorkbookSession

with WorkbookSession.load(Path(__file__).with_name("pricing.workbook.py")) as session:
    session.open_editor()
    session.inputs.quantity.set(5)
    input("Editor is running. Press Enter to close the session. ")
```

`open_editor()` starts a local HTTP host and opens the browser. It attaches to the
existing graph without rerunning initialization. Script updates appear in the
editor; input changes and applied code edits in the editor affect the same session.
Closing the browser leaves the session running. Exiting the script's context closes
both the session and its editor host.

For development, start `npm start` in the repository root, then use:

```python
session.open_editor(app_url="http://127.0.0.1:4200/")
```

To obtain the attachment URL without opening a browser:

```python
url = session.open_editor(open_browser=False)
```

The URL includes a session access token. The host binds to loopback, and the app URL
must be local HTTP. This is a local attachment feature, not remote sharing.

The editor checks revisions when applying changes. If the script has changed the
workbook since an edit began, the editor rejects the stale update, refreshes state,
and preserves rejected cell edits as drafts for review and reapplication.
**Reconnect** refreshes the attachment without restarting the workbook. The owning
script controls runtime lifetime and dependencies; the editor cannot replace its
kernel. Unapplied drafts do not change the live session, and script updates do not
create editor undo-history entries.

## Save deliberately

```python
session.save()
```

This saves current definitions to the originally loaded path and writes saved
outputs alongside it, such as `pricing.workbook.py.snapshot.json`. Save in the attached
editor targets that same original path. Save As exports a separate copy through the
browser. Closing a session does not automatically save its input changes.

The snapshot stores displays for reopening, not every Python object or a resumable
runtime. Note images can require the neighboring `assets/` directory. Workbook-
relative note asset delivery to the embedded editor is still a follow-up integration.

## Threads, asyncio, and lifetime

Session calls are synchronous and serialized onto a dedicated asyncio owner thread.
Resources and clock cells run there even with no editor connected. Each session has
its own graph and lifetime. Reading values from your script does not make the host
script a subscriber in Reaktiv's graph.

In an asyncio application, offload blocking session operations:

```python
import asyncio

async def change_quantity(session):
    await asyncio.to_thread(session.inputs.quantity.set, 8)
    return await asyncio.to_thread(session.values.total.get)
```

Close sessions from the owning script, not from a cell or an update callback. The
context manager is the preferred cleanup path; `session.close()` is available when
explicit lifetime management is needed. Keep the context open for as long as your
application or editor needs the model.

## Common questions

**The editor says to build the app.** Run `npm run build` in
the repository root, or start the development server and provide its local URL.
Installed Python distributions do not yet bundle the editor automatically.

**The editor disappears as soon as the script runs.** Opening a browser does not
block your script. Keep the context open with your application loop or an explicit
wait, as shown above.

**A package imports in the app but not in the script.** Install it into the host
script's environment. The embedded session does not use a browser's Pyodide packages
or provision a sandboxed environment.

**A label is unknown or a write is rejected.** Check worksheet qualification, label
renames, and the cell kind. Only inputs and linked inputs are writable. Equality
settings can also retain a previous reactive value when a submitted value compares
equal.

**Can I attach an existing `ReactiveModel` instance?** Not with this API.
`WorkbookSession.load()` hosts workbook definitions from a file; attaching an arbitrary
already-running model is a separate, unsupported capability.

**Does reported RAM/CPU belong only to the workbook?** No. Embedded-session process
monitoring includes the host script. Per-cell memory figures are estimates.

## Explicit model commands

Invoke an exposed `@action` method on the workbook owner with
`session.run_action("add_items", amount=3)`. The call returns its Python result and
publishes input changes to the live editor; failures propagate to the caller.
See [Workbook actions](ACTIONS.md) for method definitions, bindings and UI buttons.
