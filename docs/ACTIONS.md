# Workbook actions

Actions expose explicit Python commands in a workbook. Use them to reset inputs,
prepare a report, export data, or perform a user-requested operation. A formula
computes a value when its dependencies change; an action runs when explicitly
invoked. Input changes, opening a workbook, and saving a file do not invoke it.

## Edit and run from any view

**Actions** beside Notes, Cells and Graph opens the workbook-method editor. It uses
our Python editor with model-aware completion for `self`, typed cell handles,
other methods, hover information and call signatures when the kernel language
service is available. Built-in workbook completions remain available without it.
Selecting a method never runs it. Unsaved edits survive switching workspace views
and selecting another method; **Action options (…) → Discard edits** discards that method's draft.

The editor toolbar's **Find or replace in action** button opens search and replace
for the current method. **Ctrl/Cmd+F** opens the same panel while the code editor is
focused. Use next/previous matches, case sensitivity, whole-word or regular-expression
matching, and Replace / Replace all. **Escape** closes the search panel. Replacements
are ordinary draft edits: undo works, and Apply or Save is still required. Read-only
editors support searching; replacement does not change source while editing is disabled.

Each method remembers its editor scroll and cursor/selection position when you
switch to another action, including unapplied drafts. New methods start at the top.
These positions are temporary workspace state, not part of the saved Python file;
opening a different workbook clears them.

**Run saved action** in the method editor opens an inline run section below the code.
Set arguments and choose **Run** there; execution, cancellation, results and errors
stay in the Actions view. Apply source edits first. The code editor stays open.

Toolbar dialogs and menus stay above open Logs, Python console and Artifacts panes,
and adjust when the bottom pane or window is resized.

**Run action** in the toolbar is available in notes, cells, graph and split views.
Search by method name, label or description. Selecting a command opens its details,
arguments and last result for inspection. Choose **Run** explicitly to execute it,
including commands with no arguments or fully saved bindings.
The picker closes on execution, preserving the current view and its selection.
The run icon shows a small status indicator while keeping the toolbar width fixed.
Open the picker to cancel a running command, inspect its result/error or change
arguments. Graph nodes briefly highlight
when the action commits input changes through the ordinary reactive runtime.

Use **Action options (…) → Pin action** in the editor, or **Pin action** in the
runner, to place frequently used commands first in the picker. Pins do not add
buttons to the app toolbar.
Pins are a per-workbook-name preference in this browser/device, not workbook code.
Pinned commands with missing required arguments open the same argument form.
Button widgets and note links use this same execution path. Actions remain explicit
methods, outside the reactive dependency graph; their execution state is reactive.

## Define a command

Use **Actions → New action** in the toolbar. Enter a complete method and edit
**Display label** directly above the code editor; this is the name users see in
buttons and the action picker. Choose **Apply** to save the method and label. The editor adds `@action` when saving the file.
Apply sends only the definition and current workbook revision to Python, which
validates and compiles before installation. Invalid edits keep the previous
action; success appears after kernel acknowledgement. Apply never invokes the
method or reinitializes unrelated inputs. Frontend and kernel must support the
direct action-update command.
You can also declare the method directly in your workbook file:

```python
from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, action, cell, workbook_config, worksheet


class OrdersWorksheet(Worksheet["OrderPlannerWorkbook"]):
    quantity = cell("A1", field(1))

    @cell("B1")
    @computed
    def last_command_result(self):
        return self.workbook.add_items.result()


@workbook_config({"formatVersion": 2, "name": "Order planner"})
class OrderPlannerWorkbook(Workbook):
    Orders = worksheet(OrdersWorksheet, grid={"columns": 6, "rows": 12})

    @action(label="Add items")
    def add_items(self, amount: int = 1) -> int:
        """Add the requested number of items to the order."""
        self.Orders.quantity.set(self.Orders.quantity() + amount)
        return self.Orders.quantity()
```

The same model runs in ordinary Python: `model.add_items(3)`. In a workbook
formula editor, use `actions.add_items.result()` to read its latest result or
`actions.add_items.running()` / `.error()` to inspect state. These reads are
reactive and do not run the command. Actions are model methods rather than grid
cells, so they do not consume coordinates. Undecorated helper methods are saved for other actions to call
but are not offered as buttons. In app methods, use cells for persistent model state;
the runtime facade exposes cell members and model methods, rather than arbitrary
attributes from a custom `__init__`. Each workbook has its own action state.

## Arguments and buttons

Select an action in **Actions**. The form shows named parameters, annotations,
and literal defaults from its signature. Each parameter supports:

- **Use default**, when the method declares one.
- **Enter value**: plain text for `str`, a True/False selector for `bool`, or JSON
  for numbers, lists, dictionaries and other literal data. Simple numeric
  annotations are checked in the form; Python annotations do not otherwise
  perform automatic coercion or validation.
- **Bind workbook cell**: pass the cell's live Python value, including a table,
  class instance, function or other value that cannot be typed as JSON. Bindings
  capture values once at invocation, without subscribing the command to them.

Choose **Run** to invoke with the form's current values. Choose **Use these
arguments for buttons** to save those choices in the workbook. The button link
field provides Markdown such as:

```markdown
[Add items](#sheet-action:add_items)
```

Paste this into a note or a Markdown dashboard cell. In reading mode it is a
button. A click opens the Actions panel and runs with saved bindings/defaults;
if required arguments are missing, the form opens for you to supply them. While
editing Markdown, Ctrl/Cmd-click activates the link. Static exports retain the
text; executing an action requires the live app and a running kernel.

Manual effects are also listed in Actions. Their button links use
`[Run task](#sheet-action:effect:C1)` and retain existing manual-effect behavior.
An ordinary function-valued cell remains data: its inspector's **Expose as action**
creates an editable wrapper method. It does not turn the cell into a command or
change when the cell itself is evaluated.

## Results, writes, and cancellation

The panel displays running, completed, failed or cancelled state, the last
successful result, tables, images, plots, HTML, and downloadable artifacts. Printed
output and exceptions also appear in Logs. Different async actions may overlap. Each action can run only once at a time;
a duplicate attempt is refused, and its Run buttons show loading/are disabled.
Write your own guards when different actions share a device or other resource.

Every action belongs to the workbook. Use one reference syntax for all worksheets:

```python
@action
def copy_to_preanalyze(self):
    self.PreAnalyze.voltage_adc.set(self.PLC.voltage_adc())
    self.PreAnalyze.current_adc.set(self.PLC.current_adc())
```

`self.<worksheet>.<member>()` reads the chosen cell. The selected UI worksheet
never changes an action's targets. Duplicate labels on different sheets remain
unambiguous. Completion offers worksheets after `self.`, then the selected sheet's
members and their operations. Unlabelled cells have generated Python members;
use completion or inspect the file for the exact name. Legacy flat and
`self.cells.Sheet.label` references are accepted and normalized during migration.
See [Python workbook format 2](WORKBOOK-FORMAT.md).

Read an input with `self.Orders.quantity()`; write it with `.set(value)` or
`.update(fn)`. Linked inputs additionally support `.reset()`. Formula/resource
outputs are read-only. Methods can call other model helpers and actions. A
workbook publishes each action write directly to its reactive graph, just like a
native Python model call. Downstream formulas and linked values are invalidated
immediately and recompute when read; automatic effects react normally. No flush or
recalculation command is required. Nested helpers/actions use the same live state.
If a later step fails or is cancelled, earlier writes remain committed. External
work (files, network requests) is not rolled back either. Effect cells keep their
separate staged-write behavior: failed effects discard their pending writes.

For a sweep, write an input and read its derived formula directly:

```python
async def sweep(self):
    values = []
    for frequency in (500, 1000, 1500):
        self.Test.frequency.set(frequency)
        values.append(self.Test.pattern())
    return values
```

This updates the Python graph during the action; the UI displays throttled live
snapshots and accepts the final source changes when execution finishes. Resources still perform asynchronous work: a
write starts their normal reload, but reading a resource before it finishes can
return its previous value or report pending according to the resource contract.
Wait for the operation's readiness/completion signal before consuming its result;
a fixed sleep is not a general guarantee that hardware or async work has finished.
Do not wrap an async action in a batch spanning an `await`.

A function-valued cell is read first, then the returned function is called:
`helper = self.Test.helper()` followed by `helper(arg1, arg2)` (or
`self.Test.helper()(arg1, arg2)`). A cell handle itself takes no arguments.
Action methods use explicit model/handle references rather than bare cell names
in `globals()`; common module imports/shared code remain available as usual.

For asynchronous work, declare `async def`. The panel offers **Cancel action**
while it runs. Cancellation reaches an `await` cooperatively; a CPU loop requires
the existing kernel Stop/interrupt controls. An action reading a resource gets
its current resource value; actions do not silently wait for a pending resource.
To reload a resource from an action result, use explicit synchronous resource
parameters such as `actions.refresh.result()`; simple resource dependency snapshots
track workbook cells.
Actions share the graph on its owner event loop. Different async actions may overlap;
Run remains available for other actions, while the running action cannot start again. The action panel lists active run IDs
with individual Cancel controls and recent completion/error receipts. Name-only
cancellation cancels the current call of that method. `running()` describes that call;
`result()`/`error()` describe the last completed call. Ordinary input controls
update values directly during measurements, without full Apply. Definition and
structural edits wait until active invocations finish. Blocking synchronous code
still needs to yield; offloading work to a thread does not make arbitrary graph
access from that thread safe.

Action methods in app files currently require named or keyword-only arguments,
`self` first, and literal defaults. `*args`, `**kwargs`, positional-only parameters,
and executable default expressions are rejected. Opening/inspecting a file parses
methods without executing their bodies or defaults. This is not a Python sandbox:
starting a workbook runs trusted Python with its kernel's capabilities.

## Embedded sessions and runtimes

With a `WorkbookSession`, use `session.run_action("add_items", amount=3)` to invoke
on the workbook owner and receive the return value. Its input changes and action
state are published to the live editor. Arguments passed through this API are
serializable literals; use saved cell bindings for rich Python values.

Actions use the same workbook implementation in CLI sessions, remote
kernels and the browser's Pyodide worker. Available packages and device/network
capabilities depend on that runtime. The workbook REST endpoints are
`POST /v1/run-action` with `{"name":"add_items","arguments":{"amount":{"value":3}}}`
and `POST /v1/cancel-action` with `{"name":"add_items"}`. Normal kernel/session
authentication applies. Cancellation stays outside the workbook execution lock.

## Button widgets in notes and the grid

In an input cell's inspector, choose **Widget → Button**, then **Button behavior →
Run action**. Select a method. The per-button argument form supports:

- **Use action settings:** inherit that parameter's saved binding, or its method
  default when no binding is saved. Missing required parameters open the Actions
  argument form when the button is clicked.
- **Use method default:** explicitly ignore a saved action binding and use the
  Python method's default.
- **Enter value:** a literal override for this button.
- **Bind cell:** capture the selected cell's actual value on each click.

**Reset button arguments** clears all per-button overrides and restores inheritance.

Two buttons can call the same method with different arguments. Action buttons do
not increment or toggle their backing input. A grid button and a note widget linked
to that input share the configured action and arguments. Existing count and toggle
buttons retain their behavior. **Manage actions** opens the method editor/result
panel; the main Actions panel also offers cancellation for a running async command.

A Python declaration is ordinary widget metadata:

```python
add_batch = cell("A4", field(0), view={
    "display": "rendered",
    "widget": {
        "type": "button",
        "action": "add_items",
        "label": "Add batch",
        "actionArguments": {"amount": {"cell": "A2"}},
    },
})
```

Show that same control in a note with
`[Add batch](#sheet-input:add_batch?type=button)`. The action is identified by name;
its body is never evaluated to render the button. `actionArguments` is a mapping
of parameter names to `{"value": ...}`, `{"cell": "A2"}`, or `{"default": True}`.
Omitting a parameter inherits action settings. Cell IDs are workbook IDs, including
`OtherSheet!A2` for another worksheet, and follow moves and copies. The selector
stores `buttonMode="action"`; supplying an `action` name in Python infers that mode.

Buttons show loading immediately and reject repeated activation while the workbook
is busy. Failures are shown alongside the button without disabling retry; detailed
errors and printed output remain in Logs. Rich return values are available in
Actions and through `actions.add_items.result()` in formulas. Static exports do not
execute buttons. See [Order actions](../examples/features/model-actions.workbook.py) for live
examples, and [Architecture](ARCHITECTURE.md) for how actions are executed.

## Applying edited actions

In the Actions editor, **Apply edits** validates and installs the method definition.
It does not run the method. The editor shows **Applying…**, then **Edits applied**
only after the Python kernel confirms it. Use **Run** to execute it. Apply and Run
are blocked while edits are being applied. **Save** also applies changed drafts,
including edits stashed while selecting another method, before writing the file.
It waits for an in-flight Apply. A failed edit prevents the file write and keeps
its draft; the error identifies the method and editor line, with an **Open action**
link in save details. Correct it and try Apply or Save again. Earlier successful
applies remain active if a later method fails. Saving never runs an action.

With a disconnected/stopped kernel, Save validates and saves method source without
running Python workbook code; starting/reconnecting the workbook installs it.
Buttons and the runner refuse invocation while unapplied method drafts remain,
so an older installed implementation cannot silently run. Serializer failures can
be retried without restarting the app; an unresponsive serializer is replaced
after two minutes.
 Errors remain visible and failed drafts
are preserved. An unrelated workbook update cannot acknowledge/discard a draft.

Apply sends the method directly to the existing workbook; unrelated large
measurement buffers and cached calculations are preserved. Offline Save uses the
independent static file worker. Neither path executes the method to validate it.

### Live action output

Open **Logs** directly from the bottom bar to watch `print()` output while an
action runs. Standard output appears as Output, and stderr as Warnings, under
`action:<name>`. Complete lines arrive as they are printed; `flush=True` also
publishes an unfinished line. An action's remaining partial line is flushed when
it finishes, fails, is interrupted or is cancelled.

Cells, notes, tables and plots also refresh automatically while an action runs.
Input writes publish throttled display snapshots, and asynchronous resource
completions refresh the dashboard while the action awaits work. No `flush()` call
is needed. Rapid writes coalesce to at most about ten snapshots per second;
HTTP kernels deliver the latest snapshot through their 200 ms activity poll.
The final result commits source changes and one undo entry, preserving editor
drafts throughout. Failed/cancelled actions keep their already published writes.
For responsive async dashboards, await actual work/readiness normally; blocking
Python prevents resource tasks and timers on that same loop from advancing.

HTTP kernels use the existing 200 ms activity poll, so delivery is near real
time, subject to scheduling and transport. Browser kernels post worker messages
while Python is busy. Update/restart an older kernel to enable live delivery.
Output written to other files or by child processes is outside the Python capture.
Very long lines are split into bounded chunks, and the log retains its latest
500 entries. The final workbook snapshot contains the same entries without
replaying them.

## Agent collaboration

Shared workbooks expose `list_actions`, `upsert_action`, `run_action` and
`cancel_action` through [MCP](MCP.md). Agents use the same confirmed direct-update
and execution path as these GUI controls. Applying never invokes a method; running
is a separate intentional request. Revisions and unapplied cell/action drafts are
checked before execution. Action definition edits receive a labelled undo step;
Undo cannot reverse external effects of running a command.


Opening an action in the Actions workspace shows its source read-only. Click
**Edit** to change it; selecting or inspecting a method creates no draft and
never runs it. **Run** remains available in the workspace. Returning to a method
with actual unsaved edits restores its draft. Untouched source follows MCP updates,
including when Edit was opened without changing anything. Only real user edits
block agent changes; Apply, Discard or save them before collaborating further.


During an async action, input widgets (including checkboxes controlling plots)
update the running workbook when its owner next yields. Dependent calculations,
resources and charts update through normal live snapshots. Rapid changes can be
coalesced; display frames remain throttled. Synchronous Python or blocking device
calls cannot accept live input until they yield. Editing source still waits for
the current action; the live widget path does not recompile the workbook.
