# Feature guide

A reactive spreadsheet, run from the `reaktiv-workbook` command line or in the browser, powered by Angular, Pyodide, NumPy, and the
separately installed `reaktiv` package.

Each `.workbook.py` file is a self-contained calculation model and note collection
in plain Python. There is no second document
format: Markdown cells are shown as individual notes in the app and serialize as
decorated methods on the same `ReactiveModel`.

New here, or an agent asked to build a workbook? Start with
[docs/GETTING-STARTED.md](GETTING-STARTED.md): concepts, creating sheets,
validating with the CLI, and best practices.

For module ownership, the architecture diagram and development checks, see
[docs/ARCHITECTURE.md](ARCHITECTURE.md).

Start the editor with `reaktiv-workbook edit FILE --mcp` (or connect **Agent access** to a
running MCP server) to share open workbooks through the [MCP server](MCP.md). Agents can see your current note,
worksheet and cell selection. Cell and note edits use the current kernel,
protect user drafts, and enter the app's undo history without restarting Python.
Agents can also manage worksheets, shared code/imports and package requirements,
upload image assets, inspect rendering capabilities and LaTeX support, check widget
fit, and request a targeted PNG view of cells/notes. Package activation requires an
explicit kernel start/restart. Hide or show persistent cell badges in **Agent activity**.

To scale the whole interface, use the browser's page zoom; it is separate from
worksheet, note and graph zoom.

The **Graph** toolbar offers **Direction → Horizontal / Vertical**. Horizontal is
the default; vertical places dependencies above their consumers. The choice is
remembered on this device, and pinned views retain their captured direction.
Use **Inputs first** to group source inputs at the start. In scrollable levels,
**Connections** defaults to the selected cell; choose **All** for the full network.
Enable **Scrollable levels** to scroll individual columns vertically or rows
horizontally. Fixed level headers show buttons for connected cells outside the
visible area; connections continue to panel boundaries for offscreen endpoints.

Cell moves rewrite references in the live kernel and preserve initialized inputs.
The UI waits for pending updates and reports conflicts without replaying commands.

For large workbooks, turning off **Save output snapshot JSON (.snapshot.json)**
skips saving calculated values and plots. Input data and Python code still save.
The saving worker releases large allocations immediately after queued saves finish,
and otherwise shuts down after 30 seconds idle.

## Run it

Run these commands from the repository root:

```bash
uv sync
npm ci
npm start
```

Open <http://localhost:4200>. The first load downloads Pyodide and NumPy from the
versioned official CDN. `prestart`, `prebuild`, and `pretest` copy the separately
installed `reaktiv` package into generated public assets. The build never reaches
into another source checkout.

```bash
npm test -- --watch=false
npm run build
```

Python development uses its own environment and the external Reaktiv core:

```bash
uv sync
uv run --no-sync pyright
MPLBACKEND=Agg uv run --no-sync pytest tests/python -q
```

## Cell model

- **Input** — a Python literal such as `125000`, `0.18`, `[1, 2, 3]`, or plain
  text. It is backed by `reaktiv.Signal`.
- **Formula** — either a Python expression such as `A1 * (1 - A2)`, or multiline
  reactive Python whose final top-level expression becomes the output, for
  example `payload = {"total": net_income}\npayload`. `return` works anywhere in
  the cell, also to stop early (`if not rows:\n    return None`). Coordinates and stable
  cell labels are transformed
  into reactive reads and the formula is backed by `reaktiv.ComputeSignal`.
- **Async resource** — asynchronous Python backed by `reaktiv.Resource`. Use
  `await` directly; the last expression (or a `return`) is the value, for example
  `response = await client.get(A1)\nresponse.json()`. Resource
  dependencies reload automatically, preserve Resource cancellation semantics,
  and expose `loading`, `resolved`, or `error` status in the inspector. Long
  loaders can cooperatively stop by checking the provided `cancellation` event;
  the full loader context is available as `resource_params`.
  Running resources have **Cancel load** in the inspector and cell context menu.
  The kernel Stop button (Ctrl/Cmd+.) also cancels the current resource without
  restarting Python. Cancellation retains the previous value; changed parameters
  or loader code start a new load. Other resources continue running.
- **Markdown** — Markdown text with reactive Python interpolation, for example
  `Net income is **{{ net_income }}**` or `Margin: {{ profit / revenue }}`.
  Interpolated cell
  references become graph dependencies and update with their source cells. Each
  Markdown cell also appears as a note in the block-based **Notes** view.
- **Effect** — Python statements such as `print(f"Value: {B1:,.2f}")`. It is
  backed by `reaktiv.Effect` and records its latest output, timestamp, and run
  count. Effects can run automatically when dependencies change or manually from
  the inspector, and can be enabled or disabled.

**Clock cells** run a workbook on a timer. A formula that calls `every(minutes=5)` or
`at("08:00", "17:30", days="mon-fri")` ticks by itself; its value is the time of its
last tick, and every cell that references it re-runs on each tick — resources reload,
formulas recompute, effects fire. Arguments are ordinary values, so the interval can
come from an input cell, and `enabled=running` gives a pause switch. Resources and
effects may also call `every()` themselves. Clock cells show a ◷ marker with their next
tick. They tick while the workbook is open or runs under `reaktiv-workbook file --watch`;
missed ticks are not caught up.

Formula and Resource cells have a rich display path for plots. Return a
Matplotlib `Figure` or `Axes` directly and it is previewed in the grid and
inspector. Interpolating the cell into a Markdown note renders the plot inline:

```python
@cell("A2")
@computed
def revenue_plot(self):
    import matplotlib.pyplot as plt

    figure, axes = plt.subplots()
    axes.plot(self.revenue_history())
    plt.close(figure)
    return figure

@cell("B2")
@markdown
def report(self):
    return """# Revenue report

    {{ self.revenue_plot() }}"""
```

The runtime also understands Jupyter-style `_repr_mimebundle_`, `_repr_png_`,
and `_repr_svg_` image representations. Rich output is display-only and does
not clutter the **Artifacts** drawer.

Use `artifact(data, filename, media_type)` for an output that is actually a
downloadable file, such as a CSV, PDF, or generated image. It accepts bytes,
text, or a `BytesIO` buffer and is library-neutral. Rich output and each
artifact are limited to 20 MiB for browser and remote-kernel transport. These
are generated runtime outputs: the `.workbook.py` file stores their producing
code, so reopening regenerates them.

Notes can also contain user-supplied images. Choose **Image…**, use the `/image`
command while editing, paste an image from the clipboard, or drop one onto a
note. PNG, JPEG, GIF, and WebP images up to 10 MiB are embedded as a data
URL in the Markdown cell, keeping the `.workbook.py` workbook self-contained.
Because base64 increases file and Git-diff size, prefer generated rich output
or external image URLs for large or frequently changing images.

Selecting a cell highlights its direct dependencies and direct dependents. Drag
a populated cell onto another cell to move it, or swap the two definitions when
the destination is populated. Formula, Markdown interpolation, resource, and effect
references are rewritten simultaneously so references follow the moved content.
Every cell can have a unique Python identifier label, such as `revenue` or
`forecast_total`. Prefer labels in formulas and note interpolation: they remain
stable when cells move; renaming a label rewrites its dependent formulas and
notes. Cells can carry a persisted highlight color from the inspector or context
menu; the cell toolbar also groups highlighting, copying, grid extension, and
deletion. Each evaluated cell shows its latest execution duration. Recalculated
cells and their transitive dependents briefly pulse in both the grid and graph.
While an update runs, the cells it will change fade (also their values in notes),
the cell Python is computing gets a moving outline, and the status bar says
"Running load_data (B3) · 2.4 s"; fast updates show none of this.
Notes have their own persisted zoom control. Switch between
**Notes**, **Split**, **Cells**, and
**Graph** above the workspace. The app opens in Notes, where a Markdown cell is
edited as one continuous page, like Outline or Notion; Cells shows the addressable grid; Graph shows the
same model as a directed dependency graph. **Split** pairs any two of Notes, Cells, and
Graph, including two copies of the same view. Each pane has its own view and worksheet
pickers: choose Cells in both panes to compare different worksheets or the same worksheet.
Notes panes have independent note pickers, so two notes from one sheet can stay open.
Each pane scrolls and zooms independently; edits share one live workbook. Drag the divider
to resize, or use **Swap sides** to exchange the complete pane contents.
Cell zoom is inside the cell view; notes and graph retain their own zoom controls. In large workbooks, turn on **Focus on
selection** to see only what feeds the selected cell (purple) and what it affects
(green), optionally limited to 1–3 steps; click a node to follow the chain. **Hide
notes** and **This sheet only** thin it out further. Zoom with Ctrl/Cmd+scroll, the
zoom buttons, or **Fit**; drag the background to pan. Clicking a Markdown cell opens it as
a note. The page editor uses ProseKit and behaves like a document editor: Enter
continues a list (Enter on an empty item leaves it), Markdown shortcuts work as you
type (`# `, `- `, `1. `, `> `, `**bold**`), and selecting text shows a formatting
toolbar. Hover a block for its handle: drag **⋮⋮** to move the block, **+** to add one
below. Type `/` for text, headings, bullet and numbered lists, checklists, dividers,
quotes, tables, images, links, code blocks, math formulas, and live cell values.
Write LaTeX math with `$…$` (inline) and `$$…$$` (display), rendered with KaTeX; live
values work inside formulas (`$|Z| = {{ z_ohm }}\,\Omega$`), and prices like $5 stay
text. Code blocks are highlighted for the language of their fence (```` ```python ````, `sql`,
`json`, …, any language Shiki knows); pick it from the menu in the block's corner.
Diagrams: a ```` ```mermaid ```` code block (or `/diagram`) renders as a Mermaid
diagram — flowcharts, sequence, state, class, gantt, … — and `{{ }}` values in its source
make it update with the workbook. Double-click a diagram to edit its source. Live values
(`{{ revenue }}`) show their current result right in the text — typing `{{ name }}`
turns into a live value when you leave the braces, `{{` opens searchable cell
completion, double-click a value to edit its expression, and click a value to see the
cells it reads — **Show cell** opens one in the cell view (Cmd/Ctrl+click goes there directly).
A **Contents** panel (toolbar toggle) lists the note's headings like Outline does: click to
jump, the current section is highlighted. Links to websites open in your browser, never
inside the app window. Images can
be pasted, dropped, or uploaded: they are shrunk (at most 1920 px, WebP) and stored as files in
`assets/` next to the workbook, so the `.workbook.py` stays small; older workbooks with embedded
images move them there on the next save. The web
app keeps them in the browser until you save, then downloads a `.workbook.py.zip` containing
the Python file, optional snapshot, and `assets/` folder. Open the ZIP directly in the web
app, or extract it next to the CLI; workbook source keeps file references, never base64
images. Right-click an image to resize it with presets
or a width slider. Live plots embedded from a cell can be resized the same way
without breaking their reactive reference. Dimensions are stored in Markdown so
they survive `.workbook.py` save/load without a separate asset manifest. In the split
view, drag a spreadsheet cell onto a note to insert it as a live value.
Use **Insert widget** to bind a number field, slider, checkbox, dropdown, or text
field to an Input cell. For small apps there are also a **list** (add and remove
strings), **multiple choice**, **long text**, **date**, and a **button** (its cell counts
clicks, so whatever reads it runs on every click); The control is interactive inside the page and updates only
that input's reactive dependents. Sliders have ‹ › buttons to step back and forward (by the slider's step); they follow
the thumb instantly while dragging;
the workbook recalculates at most every 400 ms during the drag (and once on release),
and one drag is one undo step. Widget definitions remain plain,
Git-friendly Markdown links such as
`[Region: {{ region }}](#sheet-input:region?type=select&options=All,North,South)`.
The divider between note and cells is draggable and keyboard-adjustable; selecting
a cell, a live value, or **Inspect note** opens the resizable inspector without
leaving split view. **Swap sides** exchanges the note and cell panels without
resetting the divider.

First-time users see **Getting started**, with two step-by-step tours: **Show me
around** highlights views, kernel controls, cell editing, drafts, and saving;
**Understand cells & reactivity** explains cell types and how state flows between
them. Use Back/Next (or the left/right arrow keys), skip with Escape, and replay
either tour from **More → Getting started**. Tours only change the current view;
they do not edit your workbook or start Python. Closing restores your original view.

In **Cells**, enable dependency arrows to see a selected cell's reactive connections.
Purple arrows trace **Dependencies** (what the cell reads); green arrows trace
**Dependents** (what reads it). Arrows always point from an input toward its consumer.
Arrows are disabled by default with **Depth: 0 (Off)**. Choose 1, 2, 3, 5,
10 steps, or the full chain to enable them. Click either legend label to toggle that
direction, or return depth to 0 to hide the overlay. These are
session view settings and do not change the workbook or trigger Python evaluation.
Arrows track resized rows, columns, dashboard tiles, scrolling, zoom, and split panes.
A small **↗** badge lists connections on other sheets; click a listed connection to
visit its other cell. Very large neighborhoods stop at 300 edges and show a notice;
reduce the depth or use Graph for a broader exploration.

Pressing Enter while editing creates the next prose block; Shift+Enter inserts a
line break. Every block has a remove action and a right-click menu for editing,
duplication, reordering, and deletion. Tables ask for their initial dimensions;
right-click inside a table to add or remove rows and columns. Cell interpolation
works in table cells as it does in normal prose. Spreadsheet cells also have a
right-click menu for inspection, copying references, effect actions, clearing,
and extending the grid.

Undo and redo cover live note authoring as well as cell edits, clears, effect
toggles, moves, and swaps. Continuous note typing is grouped into useful history
steps, so toolbar undo also works before a note is applied. Workbook
settings include local auto-draft recovery, which also preserves an un-applied
note edit across a reload. Explicit Save still writes the portable `.workbook.py`
file; the recovery copy stays in this browser. In a CLI session, Save writes straight
back to the workbook file.

Click the workbook title to rename it in place. Enter confirms, Escape cancels, and
clicking elsewhere confirms a nonempty name. Renaming updates the workbook metadata;
it does not rename an existing file on disk. The short save state beside the title
shows **Saved**, **Unsaved**, or **Saving…**; hover for timestamps or click for details.
The status bar keeps runtime status, problems, console access, and resource readings
visible. Its **…** button opens workbook details with edit/save dates, cell/effect/file
counts, kernel information, type-check status, and links to logs and generated files.

Cells can be edited only while Python runs the workbook: a workbook opened but not
started (or a stopped kernel) shows its cells and notes read-only until **Start**.
The top toolbar keeps **Start** (power icon), **Interrupt** (square), and **Restart**
visible in every view. Interrupt works immediately for cells, actions, and console
commands (Ctrl/Cmd+.). CLI and remote Python preserve the kernel state; browser Python
restarts its worker to stop execution. If Python does not respond, Interrupt becomes
**Force stop**; a remote kernel needs restarting on its host. In an embedded session, Restart reconnects to the script-owned workbook.

The formula bar stays a single line for every cell. Click or focus its Python field
to expand that same editor over the workbook without moving the views. Drag the
bottom-right handle to resize it vertically. Escape, clicking elsewhere, or applying
with Shift+Enter / Ctrl/Cmd+Enter collapses it; edits remain in the cell draft until
applied. The expand/collapse button also controls it. Selecting another cell always
starts with the compact field, even for multiline code.

Selecting a Markdown cell in the grid selects it like any cell; **Open in Notes** (inspector
or right-click) opens it as a page. Markdown cells come in two roles: **note pages**
(listed in Notes) and **cell notes** — headings and explanations that belong to the grid
and are not listed. Markdown typed into the grid starts as a cell note, notes created in
**Save As and examples.** *Save As…* (File menu, the ⋯ menu, Ctrl/Cmd+Shift+S) saves a copy
under a new name; the copy becomes the open file. Examples are templates: saving a workbook
opened from an `examples` folder always asks where to save your copy, so an example is never
overwritten by accident.

**Saving checks the file.** Before Save writes the workbook file, Python loads it back and
compares it with the workbook in the app. If it would not load or would come back different,
nothing is written: the file on disk stays as it was, and the message and the log name the
cells involved. (Without a running Python the file is saved and marked "not checked".)

Notes are pages; switch with *Note page* in the inspector or *Open as note page*.

**Wide and full-width blocks.** Tables, charts, HTML outputs, widgets, and images can be wider
than the text column, like in Outline or WordPress: while editing, hover a value and choose
**Normal · Wide · Full** in its toolbar (images and plots: right-click → Width). Wide grows up
to 1080 px, Full uses the whole note area. The note keeps it as
`[{{ chart }}](#sheet-output?layout=wide)` (images: in the image title); exports drop it.

**Links between notes.** `[Chapter 2](#note-p2_free_fall)` links to another note by its
label (or its cell id, `#note-F3`); the link dialog (`/link`) lists the workbook's notes.
A click opens the note (while editing: Cmd/Ctrl+click). Links follow moved notes and
renamed labels and sheets; exported HTML keeps them as jumps between the exported notes.
The courses link each chapter to the previous and next one.

**Print or export notes** (the export button in the notes sidebar): choose one or more
notes, then Print or export one Markdown or standalone HTML file. The output is a
snapshot of what the notes show — current values, tables, and plots (embedded images);
input widgets and cell links become plain text.

**Reading and editing.** Notes of a worksheet are either read or edited, all at once (like
Outline's Edit button, next to the view switch; Ctrl/Cmd+Shift+E). In reading mode the
text cannot change and double-clicking a value, formula, or diagram does nothing, while
values, charts, links, and widgets keep working. New projects start in editing mode;
opened files, examples, and courses in reading mode. The mode is kept in the local draft.

The notes list can be folded away with the sidebar button at its top (a narrow rail
remains, with buttons to show the list again and to add a note).
In the notes list, sort notes **Manual**, **Title A–Z**, or **Sheet order**. Drag a
note (or press Alt+↑/↓ on it) to arrange them by hand; the manual order is saved in the
workbook file.
The note editor's contextual **Update this note** action commits that note's
draft and refreshes its reactive references; it does not write the workbook
file. Use **Save** for that. There is no global note action in the top toolbar,
where its target would be ambiguous in split view.

The initial grid is not a limit: use **+ Row** and **+ Column** to extend it past
J16. Drag header edges to resize individual rows and columns, and use the footer
controls to zoom from 50% to 200%. These layout choices are saved with the
workbook. Press **Enter** or double-click a cell to focus its multiline editor.

Dashboards: tick **Show rendered in the grid** in the inspector to make a cell a tile
that shows its content: plots and images fill the tile, tables scroll, notes render,
scalars appear as large KPI numbers, and input cells become widgets (number, slider,
checkbox, dropdown, text; configure min/max/step or options in the inspector). Drag the
selected cell's corner handle to span several cells, e.g. a plot in A1 over A1:B2.
Tiles never cover other filled cells. Tile settings are saved as `@cell(..., view={...})`.

Sheet dimensions: drag the **↘ columns × rows** control in the Cells toolbar. Drag right
for more columns and down for more rows; use arrow keys for one step or Shift for ten.
Shrinking preserves occupied cells, dashboard spans, and drafts.

Python console: click **Python ›** in the bottom bar, enter commands, and run with
Enter. Shift+Enter inserts a line; ↑↓ recall commands; Ctrl+C interrupts.
The prompt offers completions and keeps focus between commands. Current values are available by label or coordinate on the selected
sheet (`rate`, `A1`), across sheets (`Budget.rate`), or through `cells["Budget!A1"]`.
Commands, variables and history are temporary. They are not saved in the workbook;
mutating live objects can affect cell values. Interrupt a running command or restart
Python to stop sandboxed commands.

Per-cell memory: enable **App settings → Show memory usage of individual cells** to
see estimated value sizes in the grid and inspector. A **+** marks a partial estimate.
Shared values can count toward multiple cells; estimates do not add up to process RAM.
Profiling is off by default and does not run cells.

Workbook resource usage: the bottom bar shows live CPU and RAM for local and remote Python
kernels. Click the readings (or *Usage* in a small window) for details. RAM includes the
Python runtime and loaded packages; CPU uses one core as 100%. Sandboxed Python shows
allocated Python heap memory and leaves CPU unavailable. Readings update every two seconds
while the window is visible.

Saved outputs: saving stores the last values, tables, and plots in a companion file,
`<workbook filename>.snapshot.json`, beside the `.workbook.py`. The local recovery draft
keeps them too, so opening a workbook shows its notes and grid immediately, without
running the graph or installing packages. A *Saved outputs* chip shows until live
results arrive. Turn snapshots off under Settings → Workbook → Saving workbooks → *Save output snapshot JSON (.snapshot.json)*;
`reaktiv-workbook file.workbook.py --save out.workbook.py` refreshes them headlessly. Git ignores
companions locally so diffs show code changes. Browser downloads produce both files when
there are no note images; select both when opening. With note
images, browser downloads package the workbook, snapshot, and assets in one ZIP.

Type hints and type checking: a formula cell can have a type hint (inspector → *Type hint*:
`float`, `list[str]`, `pd.DataFrame`), saved as the method's return annotation in the file. With a
local or HTTP kernel, pyright checks the workbook a moment after each change — the hints, and
how cells use each other's values — and shows findings in the cell editor, under it, and as a
count in the status bar (Settings → *Type checking*: off, standard, strict). They never stop a
cell from running. `reaktiv-workbook file.workbook.py --types` checks from the command line.

Git (workbooks opened with `reaktiv-workbook edit`): when the workbook is in a git
repository, the title bar shows its branch
(a dot when there is something to commit, ↑/↓ for commits to push or pull). The **Changes**
panel lists what changed since the last commit cell by cell — with line diffs, moves by label,
and the raw text diff — and commits the workbook and its images, pushes, and pulls
(fast-forward only); after a pull the session continues with the pulled file. The CLI runs
your own `git` in the workbook's folder with a fixed set of commands, so SSH keys and
credential helpers work as in the terminal.

Selecting and collecting cells: arrow keys move the selection, **Shift+arrows** extend
it, and **Ctrl/⌘+Shift+arrows** extend to the end of the filled block. Click a column
or row header to select its filled cells (Ctrl/⌘+click adds), **Ctrl/⌘+A** selects all.
**Collect as list** (**Alt+L**) creates a computed cell such as `[rent, groceries, B7]`
after the selection; **as dict** (**Alt+D**) creates `{"rent": rent, ...}`. Cells are
referenced by name, so the collection stays correct when cells move.
On a new cell, start with `=` for a formula, `!` for an effect, or `~` for an async
resource (`#` starts a Python comment; pick *Markdown* as the cell type for a note).
Comments stay with the cell in the file, including on input values (`# rent` above
`1200` keeps the number). Press <kbd>Delete</kbd> or <kbd>Backspace</kbd> while
a grid or graph cell has focus to remove it. String results render as Markdown by
default; this can be disabled under **Workbook settings**, or per cell in the
inspector (*Render text results as Markdown*).
Cells and Graph have a **Show/Hide inspector** button at the top right, above the inspector.
The choice is remembered; explicit Inspect/Edit commands reopen it. Graph also
has a worksheet selector, with **All sheets** available for cross-sheet graphs.

The inspector edge can be dragged to resize it. Rendered Markdown has a
**Copy Markdown** action that copies the interpolated Markdown source.
Python inputs, formulas, resources, and effects use a CodeMirror editor
with Python parsing, highlighting, indentation, bracket matching, and editor-local
undo. Completion suggests cell labels and coordinates, Python keywords and
built-ins, configured global import names, and workbook runtime names such as
`np`, `env`, and `artifact`. Suggestions include declared or last evaluated cell types.
In formula, linked input, resource and effect editors, dotted underlines identify
cell references. Hover for the type and **Go to cell**, or Ctrl/Cmd-click to navigate.
Local variables, comments and strings are excluded; sheet-qualified references work
with duplicate labels on different sheets.

With a running Local or Remote Python kernel, completion also follows inferred types
through cells: methods on values, functions and their signatures, classes and instance
members. Call hints appear while entering arguments, and hovering Python names shows
inferred types. This uses a persistent Pyright language server in the kernel's Python
environment, found through uv or an installed Pyright package. It analyzes unfinished
code without running cells. Browser-only Python keeps basic name and cell-type
suggestions.
Press <kbd>Shift+Enter</kbd> or <kbd>Ctrl/Cmd+Enter</kbd> in a cell Python editor to
apply the cell; plain Enter inserts a line in multiline editors when no completion
is selected. Common editor keys follow familiar VS Code conventions:

| Key | Action |
| --- | --- |
| Ctrl+Space | Open suggestions |
| Tab / Enter with a selected suggestion | Accept it without applying the cell or submitting the console |
| Tab / Shift+Tab without a suggestion | Indent / outdent |
| ↑ / ↓ in suggestions | Select a suggestion |
| Ctrl/Cmd+Shift+Space | Show parameter hints inside a Python call |
| Ctrl/Cmd+/ | Toggle comments |
| Escape | Dismiss suggestions or documentation |
| Escape, then Tab | Move keyboard focus out of the editor |

Long hover, parameter-hint and completion documentation wraps within a bounded,
scrollable popup. Scroll over the documentation to read it without moving the
workbook; click the documentation region to focus it for keyboard scrolling.
Markdown is stored as Markdown while ProseKit provides its rich block
authoring surface and rendered preview.

A new window starts with a blank project (one empty note). The first launch presents a
short guide to notes, reactive cells, references, and workbook execution, and offers the
bundled examples to start from. The **New** dialog can start with a blank note, a small
connected note-and-model example, or an empty calculation grid; the help button
reopens the guide at any time.

Every workbook opens in its own browser tab: **New**, **Open** and examples leave the current workbook where it is. A window that still holds its untouched
new workbook is reused, so the first workbook after launch does not leave an empty window behind.

Keyboard shortcuts use <kbd>Ctrl</kbd> on Windows/Linux and <kbd>Command</kbd>
on macOS: <kbd>S</kbd> saves, <kbd>O</kbd> opens, <kbd>N</kbd> creates a note, <kbd>Alt+N</kbd> (<kbd>Option+N</kbd>) starts a new workbook, <kbd>.</kbd> stops a cell that runs too long (also the **Stop** button that appears after 3 s),
<kbd>Enter</kbd> applies the active note or cell, <kbd>1</kbd>–<kbd>4</kbd> switch
workspace views, <kbd>,</kbd> opens workbook settings, <kbd>K</kbd> opens the command palette
(every command, including "Run action: …"), and <kbd>Shift+L</kbd> toggles logs. Without a
modifier, <kbd>I</kbd> shows or hides the cell panel; in view mode a double-click on a cell opens it. Standard undo/redo shortcuts keep working, with editor-local undo
while focus is inside CodeMirror or ProseKit. Successful saves show a visible
confirmation.
The header makes the workbook name more prominent than the application brand
and shows its latest edit time, explicit save time, and an unsaved indicator.

The **Logs** panel (status bar: *✓ No problems* / *⚠ 2 problems*, or Ctrl/Cmd+Shift+L) is
the place to debug a workbook:

- **Problems** lists the cells that fail right now, by root cause: the error, the failing
  line of the cell, the traceback (cell code, shared code, and the innermost library
  frames), and the cells that fail only because they read it. Click a cell to go to it.
- The log stream holds `print()` output, warnings (anything written to stderr, including
  `warnings.warn` and `logging`), errors with their traceback, and app events (starting
  Python, installing packages, actions that failed). Filter by kind, search, and **Copy**
  what is shown — with tracebacks — to paste into an issue or a chat.
- An error is logged once, at the cell where it happened, not for every cell downstream
  and not again while the cell keeps failing the same way.

The inspector shows the same details for the selected cell (*Line 3: …*, *Traceback*, or
*Caused by A3*), and `reaktiv-workbook file --check` prints them on stderr. The panel keeps
the newest 500 cell entries per live kernel; **Clear** empties it without rebuilding the graph.
Worksheet name, kernel, package dependencies, global Python imports, and
environment variables live in **Workbook settings**, separate from the
selected-cell inspector. Add one import statement per line, such as
`import pandas as pd` or `from datetime import date`; imported names are shared by
formulas, Resources, effects, and Markdown interpolation and are stored as normal
top-level Python imports in the `.workbook.py` file. The always-visible **Restart**
toolbar action restarts either the local Pyodide worker or the reference remote
kernel and then reevaluates the workbook.

Use **Open** and **Save** to load or download a `.workbook.py` workbook (older `.sheet.py` files open too). JSON
`.rsheet` files and the former `# %%` Python layout are intentionally no longer
supported. Legacy executable `@sheet` workbooks still open. New saves use
[Python workbook format 2](WORKBOOK-FORMAT.md): one worksheet class per sheet
and one workbook class that composes sheets and owns actions. Opening parses
source statically without importing or executing it. Saving a format-1 file with the
CLI upgrades it to format 2 in place; the browser downloads the upgrade.

```python
from reaktiv import computed, field
from reaktiv_workbook import Workbook, Worksheet, action, cell, workbook_config, worksheet


class InputsWorksheet(Worksheet["ForecastWorkbook"]):
    revenue = cell("A1", field(125000), label="revenue")


class ResultsWorksheet(Worksheet["ForecastWorkbook"]):
    @cell("A1", label="tax")
    @computed
    def tax(self):
        return self.workbook.Inputs.revenue() * 0.2


@workbook_config({"formatVersion": 2, "name": "Forecast"})
class ForecastWorkbook(Workbook):
    Inputs = worksheet(InputsWorksheet)
    Results = worksheet(ResultsWorksheet, grid={"columns": 6, "rows": 12})

    @action
    def set_revenue(self, value: float):
        self.Inputs.revenue.set(value)
        return self.Results.tax()
```

Python member names carry semantic meaning; coordinates are decorator metadata.
Moving `revenue` from A1 to D4 therefore changes `cell("A1", ...)` to
`cell("D4", ...)` while `self.revenue()` remains stable. Formula methods may use
multiple statements and return their result normally. `@cell` is deliberately
the outermost decorator and only contributes sheet metadata; `@computed`,
`@effect`, and `@resource` remain the real Reaktiv behaviors. The workbook
decorator stores composition metadata, while the GUI and CLI parse the worksheet
classes into their fine-grained editable runtime. Running the
generated file directly delegates to the CLI evaluator.

Multiple `@markdown` methods therefore form the sheet's note collection. Their
method names are stable semantic identities, their `@cell` decorators retain
grid placement, and their interpolations remain normal reactive dependencies.
Saving from any view writes calculations, effects, Resources, layout, and all
notes back into one reviewable Python file.

## Runtime design

Pyodide runs in a module Web Worker so NumPy or user calculations do not block
Angular's UI thread. The browser and CLI both consume the reusable
`reaktiv_workbook.ReactiveWorkbook` Python API.

- input values update their existing `Signal` instances;
- formulas, Markdown, and cell types are replaced individually while unrelated
  nodes and effects retain their identities;
- resource cells use `Resource` parameter tracking and run inside the kernel's
  persistent asyncio loop; downstream cells see the resolved value;
- each coordinate has a stable computed slot, allowing its implementation to be
  replaced while dependents reconnect automatically;
- all changes in one model update are batched before effects run;
- `np` is NumPy, imported on first use (a workbook that uses it declares `numpy`; the
  browser always has it); `math` and `statistics` are also available.

Additional packages use PEP 508 requirements such as `pandas==2.3.2` or
`httpx>=0.28`. Applying a changed package list restarts the Pyodide worker,
installs the declared environment through `micropip`, and then evaluates the
sheet from a clean graph. Pyodide supports its prebuilt packages and pure-Python
wheels; native packages without a WebAssembly wheel cannot be installed.

Workbook variables are entered as `NAME=value` and exposed to Python cells
through the read-only `env` mapping. Updating variables invalidates only cells
that read the environment revision (including Resources); it does not require a
Pyodide restart when the package list and kernel are unchanged. Variables are
saved in the workbook, so secrets should be supplied only to files that will not
be shared.

Package code is executable code. Requirements should only come from trusted
documents. API keys and other secrets must not be stored in `.workbook.py` files;
browser-only agent calls are also subject to the target service's CORS policy.

Opening a workbook does not immediately execute it. The sheet and its declared
requirements are shown in a paused state so they can be reviewed before choosing
**Start workbook**. This keeps the portable environment metadata close to the
document while making execution explicit. The approach follows the useful parts
of notebook systems: reactive dependency execution and document-level package
metadata, without hiding kernel restarts or code execution.

Not every value is wrapped in `LinkedSignal`. Inputs and computed formulas have
different ownership: inputs are writable `Signal` instances, while formulas are
read-only `ComputeSignal` instances. Making every formula linked would silently
allow manual overrides and weaken spreadsheet semantics. A dedicated
overrideable-formula cell can be added later when its UI and persistence rules
are defined.

## Positioning and alternatives

Reaktiv Workbook sits between a spreadsheet, a reactive Python notebook, and a
small workflow canvas. Its differentiator is one model shown in two ways: an
addressable grid for financial and state modeling, and a dependency graph for
understanding formulas, Resources, and effects. The saved artifact is an
ordinary Python `ReactiveModel`; coordinates are metadata rather than variable
names.

| Product                                                      | Best fit                                                                                    | Where it is stronger                                                                                                                                         | Where Reaktiv Workbook differs                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Reaktiv Workbook**                                            | Interactive calculations, state models, lightweight Python workflows, and agent experiments | Python/NumPy expressions, writable signals, fine-grained reactive invalidation, Markdown, async Resources, observable effects, and a Git-friendly model file | It is not yet a production scheduler, integration catalog, credential vault, or multi-user automation service.                                                                                         |
| [**n8n**](https://docs.n8n.io/)                              | Business-process and API automation                                                         | Large integration surface, triggers, credentials, execution history, sharing, cloud and self-hosted operation                                                | Reaktiv Workbook is code- and model-centric: better suited to dense numerical/state relationships, but much less complete for production SaaS orchestration.                                              |
| [**Node-RED**](https://nodered.org/)                         | Event-driven, IoT, edge, and message-processing flows                                       | Mature node palette, deployable message flows, hardware/community integrations, and Node.js event handling                                                   | Reaktiv Workbook uses pull-based reactive values in a spreadsheet grid instead of messages moving through ports. It favors Python analysis over device integration.                                       |
| [**Jupyter**](https://jupyter.org/)                          | Exploratory scientific computing and narrative notebooks                                    | Broad ecosystem, kernels, rich outputs, teaching material, and established collaboration tooling                                                             | Reaktiv Workbook makes dependencies and invalidation explicit and stores the model as Python rather than a session document. Jupyter remains the stronger general-purpose notebook ecosystem.             |
| [**Prefect**](https://docs.prefect.io/latest/tutorial/flows) | Durable Python workflow orchestration                                                       | Retries, timeouts, deployments, scheduling, run history, and operational monitoring                                                                          | Reaktiv Workbook targets live interactive models. A mature deployment could hand off durable jobs to Prefect rather than rebuilding an orchestrator.                                                      |

The intended niche is therefore not “another n8n.” It is a reactive modeling
surface for people who want spreadsheet ergonomics without giving up Python
libraries or explicit program structure. For production automation, n8n,
Node-RED, or Prefect can remain the execution boundary while a Reaktiv Workbook is
used to design, inspect, and parameterize the model.

## Sheets

A workbook can have several sheets (tabs under the grid: **+** adds one, double-click
renames, right-click for more). Sheets are not isolated — they share one reactive graph:

- a cell label (`rent`) works from any sheet;
- `A1` means A1 on the same sheet;
- `Budget.A1` means A1 on the *Budget* sheet (the first sheet by its name, e.g. `Sheet1.A1`).

While editing a formula (formula bar or inspector), turn on **Pick cells** (the pointer
button next to the editor) and click cells in the sheet to insert references at the
cursor: a labelled cell inserts its label, others their coordinate (`A1`, or `Budget.A1`
from another sheet — switch tabs while picking). In a Markdown cell the click inserts
`{{ reference }}`. Picking ends with Esc, the button, or applying the cell. Without it, a
click on another cell selects that cell and leaves the edit, as usual.

Right-click a sheet tab to rename, move, or delete it (deleting asks first and can be
undone). Drag a sheet tab to reorder the sheets (moving a sheet to the front relabels cell ids;
formulas are unaffected, and undo restores the previous order).

**Duplicate sheet…** (right-click a tab) copies a sheet for a scenario: name the copy
(`ScenarioB`) and its cells calculate from their own inputs. Labels are global, so the
copies get a suffix from the name (`revenue` → `revenue_scenario_b`, then `_2`, `_3` if that
is taken), and the copied formulas, notes, widgets and `bind(...)` use the new labels.
References to other sheets stay, so shared inputs remain shared. Effects, resources and clock
cells are copied too — the dialog says how many, since they then run twice.

**Copy** cells with **⌘/Ctrl+C** and paste them with **⌘/Ctrl+V** — in the same workbook, on
another sheet, or in another window: references between the copied cells follow, labels bind to
the cells of that name where you paste (`price * quantity` works wherever `price` and `quantity`
exist), and labels already taken there get `_2`. The clipboard holds them as a small `.workbook.py`, so
you can also paste them into a text editor or a chat.

Move cells within or between sheets with **⌘/Ctrl+X** then **⌘/Ctrl+V** on the target cell
(or *Cut* / *Paste here* in the cell menu), or drag cells onto a sheet tab. References
follow: other cells now point at `Budget.C5`, and moved cells keep pointing at what they
referenced before. Pasting onto occupied cells is refused.

Notes are cells too: reference values from any sheet, and `{{ summary }}` embeds the
note labelled `summary`. In files, cells on other sheets are declared as
`@cell("Budget!A1")`.

## Standalone browser IDE

Launch the IDE from the command line:

```bash
reaktiv-workbook new --from welcome
reaktiv-workbook edit analysis.workbook.py
reaktiv-workbook run analysis.workbook.py --headless
```

`new` creates a workbook (blank, or a copy of a bundled example with `--from`); `edit`
creates or opens one; `run` presents interactive views without authoring.
The CLI owns the local server until Ctrl+C. Executing a workbook with Python still
only evaluates it. The Python wheel includes the compiled IDE; Node is needed only
by maintainers building the release. `--sandbox` installs the workbook's declared
packages into an isolated environment with uv, and `edit --mcp` starts the agent MCP
service next to the editor. File/folder widgets browse this computer, and the Git panel
commits, pushes and pulls the workbook. See [CLI and Python packages](STANDALONE-CLI.md)
for environment setup, compatibility, release building and validation.

## Python API and CLI

The Python package is in `python/reaktiv_workbook` and has its own `pyproject.toml`.
For development from this repository:

```bash
uv run --no-sync python -m reaktiv_workbook examples/features/financial-model.workbook.py
uv run --no-sync python -m reaktiv_workbook examples/features/financial-model.workbook.py \
  --set A1=200000 --json
```

It can also be installed to expose the `reaktiv-workbook` command:

```bash
python -m pip install -e .
reaktiv-workbook examples/features/financial-model.workbook.py --set A1=200000
reaktiv-workbook examples/features/financial-model.workbook.py --requirements
```

More options (the package requires Python 3.12+):

```bash
reaktiv-workbook model.workbook.py --set focus_month='"Jul"'  # override an input by id or name
reaktiv-workbook model.workbook.py --cell B2 --cell total      # print only these cells
reaktiv-workbook model.workbook.py --note overview_note         # a note as self-contained Markdown
reaktiv-workbook model.workbook.py --export out/                # plots/artifacts as files, notes as .md
reaktiv-workbook model.workbook.py --check                      # exit 1 if any cell errors
reaktiv-workbook model.workbook.py --watch                      # keep running: fire clock cells (every/at), print changes
reaktiv-workbook model.workbook.py --watch 3 --cell latest      # stop after 3 ticks
```

Tabular values display as tables: a pandas DataFrame or Series (or a list of dicts)
shows as a scrollable table in the inspector, `{{ frame }}` in a note renders it as a
table (`{{ frame.head() }}` works too), and grid cells show `▦ DataFrame 12 × 6`.

Cells run as ordinary Python with the full builtins: comprehensions, lambdas,
nested functions, and classes can all use the cell's own local variables.
Notes link plots from other cells as `![Plot](#cell-C1)` instead of embedding a
copy per note; `--note`, `--export`, and the app's copy action resolve those
links into self-contained Markdown.

The public API is deliberately small:

```python
import asyncio
from reaktiv_workbook import ReactiveWorkbook, SheetDocument

document = SheetDocument.load("model.workbook.py")
workbook = ReactiveWorkbook()
snapshot = asyncio.run(workbook.load_document_async(document))
print(snapshot.to_dict())
workbook.document.save("model.workbook.py")
```

## Browser and remote kernels

The inspector can switch between two consumers of the same workbook protocol:

- **Pyodide** runs locally in a Web Worker. Requirement changes create a clean
  worker and install packages through `micropip` before rebuilding the workbook.
- **Python backend** sends workbook operations to a user-owned HTTP kernel. This
  supports normal CPython packages, local files, credentials supplied by the
  backend environment, and infrastructure that is not available in WebAssembly.

For local development, start the included reference backend from this directory:

```bash
uv run --no-sync python -m reaktiv_workbook.server --host 127.0.0.1 --port 8765
```

Then choose **Python backend · HTTP** and connect to
`http://127.0.0.1:8765`. The reference server intentionally does not install the
workbook's package list; provision those dependencies in its Python environment
(the CLI's `--requirements` flag prints them). It is a single-workbook,
unauthenticated development server that executes cell code, so keep it bound to
localhost or replace it with an authenticated service before any shared use.

The HTTP contract is deliberately small: `GET /health`, plus `POST /v1/apply`,
`/v1/run-effect`, `/v1/widget-update`, `/v1/tick-timer`, `/v1/move-cells`,
`/v1/clear-logs`, and `/v1/restart`. A
production kernel can implement those routes without importing Angular or
Pyodide.

## Web app

`npm run build` writes the browser app to `dist/reaktiv-workbook/browser/`: static files
that run workbooks with Pyodide. Any static file server works, as long as it serves `.mjs`
as JavaScript (Pyodide's modules) and `.wasm` as `application/wasm`.
`scripts/screenshots.py` refreshes the README screenshot from that build.

The public website (landing page, static example pages, the app under `app/`) lives in the
separate reaktiv-workbook-site repository and builds against a release of this one.

The multi-chapter courses in `examples/education/` open in the web app through links such
as `?example=education/motion.workbook.py&note=p2_free_fall` after the app's address.

## Example workbooks

Open these from the top-bar **Examples…** menu (or the files in `examples/`). They go from
a first look to complete apps:

**Start here**

- `examples/welcome.workbook.py` — the ideas in five short notes: cells, reactivity and the
  graph, widgets and charts, actions, and the Python file behind it all.
- `examples/docs/guide.workbook.py` — the user guide as a workbook: how output works, note
  controls, tables, charts, HTML cells, and your own anywidgets with `bind`.

**Simple**

- `examples/budget.workbook.py` — a monthly budget: income and spending sliders, a
  spending chart, a verdict and a savings goal.
- `examples/trip-planner-app.workbook.py` — a small app made of input widgets: a packing list,
  activities, a date, long text and a button.

**Useful**

- `examples/model-fit.workbook.py` — fit a polynomial to noisy samples; degree, noise and
  sample sliders show underfitting and overfitting in the fit, the error curve and residuals.
- `examples/sales-performance-dashboard.workbook.py` — a filterable report with KPI tables,
  channel and region breakdowns and plots, plus an optional JSON data URL.
- `examples/project-planner.workbook.py` — project and life management from one plain-text
  task list: Kanban board with WIP limits, Eisenhower matrix, forecasts, OKRs, habits, a
  weekly review and a decision matrix.
- `examples/calorie-coach.workbook.py` — calories and macros over five sheets, with a goal plan
  and a weekly check-in that measures your real maintenance.
- `examples/scheduled-pipeline.workbook.py` — clock cells: a simulated sensor polled every few
  seconds, a trend, an alert and a report on a weekday schedule.

**Impressive**

- `examples/signal-lab.workbook.py` — recover a tone from interference and noise with a
  windowed-sinc low-pass filter; time, spectrum, filter-response and kernel plots in one grid.
- `examples/personal-life-dashboard.workbook.py` — money, home, health and household in one
  model with many charts.
- `examples/wave-laboratory.workbook.py`, `examples/vectors.workbook.py`,
  `examples/binary-search.workbook.py` — small lessons built on anywidget classes in cells.

`examples/features/` holds small workbooks that each show one feature (actions, async
resources, artifacts, reactive widget settings, anywidget, Plotly, an effect), and
`examples/education/` multi-chapter courses (maths, physics, statistics and more).

Cells that return an **anywidget** are shown as the live widget (in notes with
`{{ counter }}` and as tiles). The inspector shows a lightweight summary.
Widgets are views of input cells:
`bind(Counter(), value=count)` shows the input cell `count` in the counter, and a click
writes the new value back to that cell — so it is saved, undoable, settable from the CLI,
and everything reading `count` re-runs. A widget's own state (hover, animation) stays in
the widget and is not part of the graph; reading `counter.value` in a cell is an error that
points to `bind`. The whole
widget protocol works as in Jupyter: changes made by Python code (effects, message
handlers) reach the view, custom messages (`model.send` / `widget.send`) and anywidget
commands (`experimental.invoke`), binary values, and nested widgets
(`widget_manager.get_model`). Widgets run in a sandboxed frame; see [third-party widgets](THIRD-PARTY-WIDGETS.md) for the limits.
Library authors and coding agents can follow [Creating third-party widgets](THIRD-PARTY-WIDGETS.md)
for a complete example, bindings, packaging and validation.

Cells that return **HTML** are shown as HTML: `html(f"<b>{done}</b> of {total} done")`, or
any value with `_repr_html_` (as in Jupyter, e.g. a pandas `Styler`). Build cards, boards,
matrices or KPI tiles from Python and style them with CSS (`light-dark()` follows the app
theme). The HTML is sanitised — no scripts or event handlers — and rendered in its own
shadow root, so its styles never leak into the app;
The project planner's board, Eisenhower matrix, focus list and habit tracker are HTML cells.

Cells that return a Plotly figure are drawn interactively (hover, zoom, legend) in
notes, dashboard tiles, and the inspector; plotly.js loads the first time a chart
appears. Printing and exporting notes turn charts into PNG images.

**Long signals** (ADC captures, high sample rates): a Plotly figure with a trace longer than
50 000 points keeps its data in Python and shows about 4 000 points (minimum and maximum per
bucket, so peaks stay visible); zooming or panning fetches the real samples of the visible range,
down to every single one — no 20 MB limit, no slow browser. `resampled(fig, points=…)` does the
same for any figure.

**Drafts:** editing a cell and selecting another one to look something up keeps your unapplied
edits as a draft (dashed outline); coming back restores them. **Discard draft**, available
while editing and in the cell context menu, restores the applied cell (or empties a new cell).
**Clear cell** and Delete/Backspace also clear draft-only cells. Drafts follow moved cells;
pasting into an empty cell replaces its draft.

## Reusable code: shared code, function cells, inputs, environment variables

- **Shared code** (… menu → *Shared code*): one Python block for functions, classes,
  constants, and imports that every cell can use (`gross(price)`). It is saved as plain
  module-level Python in the `.workbook.py`; changing it recomputes the workbook.
- **Function cells**: a formula ending in `def tax(amount): ...` holds that function;
  other cells call it by its label, `tax(income)`, and it is tracked in the graph.
- **Input cells** for values you tweak (and bind to widgets).
- **Environment variables** (Workbook settings) for configuration strings such as URLs or
  regions, read as `env['NAME']` — not for code, and not for secrets (saved in the file).

## Deliberate first-slice limits

- graph layout is deterministic and dependency-based, but nodes cannot yet be
  manually positioned;
- the reference HTTP kernel is local-development infrastructure, not a
  multi-user notebook server or a full Jupyter wire-protocol implementation;
- coarse-pointer sizing and larger resize targets are prepared in CSS, while
  touch drag/reorder still needs a dedicated gesture interaction.

Settings has two scopes: **Workbook** contains the name, kernel, Python version,
packages, imports, environment variables and output snapshot policy saved with the
workbook. **App** contains theme, recovery, string rendering and type checking on this device. App preferences apply immediately; applying
workbook environment settings configures its kernel. Changing output snapshot policy
does not restart or evaluate the kernel. Ctrl/Cmd+, opens App settings.

Search cells with the magnifying glass or **Ctrl/Cmd+Shift+F**. Search matches labels,
coordinates and source code across all sheets, including drafts. Select a result to
open its cell. The **Focus** selector in Cells and Graph dims other cell types,
so choosing Inputs shows the knobs you can turn. Choose All types to clear it.

Notes can contain child notes. Drag a note onto another to nest it, or drop it
on **Move to top level** while dragging to unnest it. Right-click a note for
**Add subnote** or **Delete note** (also Shift+F10 with the note focused). The
chevrons expand and collapse groups. Search keeps matching notes with their parents visible.
The hierarchy is saved with the workbook; ordering applies within each group.

### Reactive built-in widget settings

Grid widget `min`, `max`, and `step` accept numbers or Python expressions such as
`upper_limit * 2`; `options` accepts a string list or an expression returning one.
In the inspector, enter a number or expression for bounds, and `=choices` for dynamic
options. In files, expressions are strings: `view={"widget": {"type": "range",
"min": 0, "max": "upper_limit", "step": "increment"}}`.

In notes, use interpolations in widget parameters: `max={{ upper_limit }}` and
`step={{ increment }}`; `options={{ choices }}` uses a list-valued cell. Settings
are reactive, use sheet-local references, and changing them preserves the input value.
Grid settings are separate computed leaves; dashed graph edges show their dependencies.
Invalid grid settings disable the control and show an error without changing the cell's value.

### Linked inputs

Choose **Linked input** in the cell type picker and enter its derivation, for example
`base_price * 1.2`. It uses `LinkedSignal`: users can override the derived value while
keeping the formula. The inspector shows **Derived value** or **Overridden**, a manual
value editor, and **Reset to derived value**. Note widgets and grid widgets can edit linked
inputs; overridden note widgets also have a reset button. Grid cells show an Override badge.

Changing a referenced value returns the cell to its derivation. Editing its formula in
the app also resets the override. Overrides are saved with the formula and survive reopening,
copying, moving, and undo. CLI `--set price=7` can override a linked input too.

Drafts live in the browser's localStorage, one per window. Snapshots saved with a workbook
remain in its adjacent `.workbook.py.snapshot.json` companion.

Dynamic built-in widget settings are saved as Python callbacks, e.g.
`"options": lambda self: self.choices()` for dropdowns and multiselects or
`"max": lambda self: self.limit() * 2` for numeric controls. They use computed
graph dependencies and preserve the user’s input value when settings change.

Graph nodes identify their cell type with a coloured marker and a labelled symbol.
The graph toolbar’s Back/Forward arrows navigate previous graph selections across
sheets, including split views containing a graph. Alt+Left/Right work in graph views
outside editors. Navigation is separate from undo/redo.

Cells, Notes and Graph support the same zoom gestures: pinch, or hold Ctrl/Cmd
while scrolling over the view. Zoom affects that view only, including in split
view. Ordinary scrolling stays unchanged; embedded plots keep their own controls.


Effects can write input cells through explicit handles:

```python
cells.approved.set(False)
cells.counter.update(lambda counter: counter + 1)
cells.Settings.status.set("ready")
cells.linked_price.reset()  # return to its derivation
```

Labels and coordinates select the current sheet by default. `get()` reads a handle;
ordinary labels still read values. Inputs support `set`/`update`, linked inputs also
support `reset`, and formula/resource cells are read-only. Writes are available in
effects and helpers called by effects; the console's `cells` remains a read-only
snapshot. The name `cells` is reserved for this API.

An effect's writes commit together when it succeeds; failed effects discard staged
writes. `update` reads a copy without subscribing to its target. `with cells.batch():`
can group writes explicitly. Input handles see their own staged writes, while derived
calculations update after the effect completes. Values must be Python literals
(numbers, strings, containers); NumPy scalars are accepted. Writes preserve comments,
update widgets and saved cell source, and support undo/redo. Feedback loops report an
error rather than running indefinitely.

### Cell equality

The cell inspector's **Equality** setting controls when a value counts as changed.
Choose the default (identity: same Python object), value and type, always changed,
or a custom Python function. This applies to inputs, linked inputs, formulas,
resources and Markdown; effects use their trigger settings. Click **Apply** to apply
it along with the cell's other edits. The setting is saved in the workbook.

For example, `lambda previous, current: abs(previous - current) < 0.01` ignores tiny
numeric differences. Return `True` to retain the previous value and skip updates
to dependent cells; return `False` to propagate a change. A custom expression can
also name a function in shared code. Keep comparisons pure: they run without
tracking reactive dependencies.

### Embed a workbook in a Python script

For setup, examples, API behavior, and troubleshooting, see the
[embedded workbook sessions guide](EMBEDDED-WORKBOOK-SESSIONS.md).

Use `SheetSession` to run the model in a script and optionally open its live editor:

```python
from reaktiv_workbook import SheetSession

with SheetSession.load('pricing.workbook.py') as session:
    session.inputs.quantity.set(5)
    print(session.values.total())
    session.open_editor()
    run_business_process(session)  # your code keeps using this same graph
```

`open_editor()` serves an existing `npm run build` output. During development, pass
`app_url='http://127.0.0.1:4200/'` after starting the app. The browser sees script
updates and edits the same runtime; attaching does not rerun initialization.
Keep the context open for as long as the script needs the model or editor.

Use `inputs.Other.amount` for another sheet, or `inputs['Other.amount']` for a label
that clashes with a namespace method. Inputs accept `set` and `update`; linked
inputs also accept `reset`. `values.name()` returns the actual Python value. Invoke function-valued cells with
`session.values.calculate.call(argument)` so execution stays on the owner loop.
`with session.batch():` commits several writes together; reads inside the block
see the previous committed state. Call `session.save()` to save the definitions
and snapshot, or use Save in the attached editor. An editor with stale state keeps
rejected cell edits as drafts for review. Closing the browser leaves the model running. **Reconnect** refreshes the
attachment without restarting the script-owned workbook.

Calls are synchronous and serialized on one owner thread, where resources and
clock cells also run. Treat returned objects as read-only. Install workbook packages
in the host script's environment. In asyncio applications, use `asyncio.to_thread`
for calls that should not block the caller's event loop. This hosts worksheet files;
attaching an arbitrary existing `ReactiveModel` instance is a separate capability.

Try `examples/embedding/run_pricing.py --editor` (or add `--app-url` for a preview).
Use `--steps 2 --interval 0` to run the example without an editor and exit.


### Optional resource parameters and live graph edges

Async resource cells have two modes. **Automatic** remains the default: cell
references in the async source are captured before loading. **Explicit**, selected
in the inspector's Resource parameters control, adds a synchronous Python editor.
Return the request value there, then read it as `params` in the async source.
Return `None` to stay idle; use conditional reads or normalized request keys to
control reloads. Explicit loaders reject direct cell reads. Parameter edits support
apply/discard, drafts, undo, copying, moving, renaming, saving, and embedded sessions.

The dependency graph now uses reads from the latest evaluation. Conditional
branches change graph edges; unobserved cells show **Not run**, and failed cells
may have incomplete edges. Static references are retained separately for authoring. Resource
parameter functions are preserved in executable Python files, and generated simple
loaders use captured parameters consistently across await boundaries.

See [Resource parameters and live dependencies](GETTING-STARTED.md#resource-parameters-and-live-dependencies)
for examples and file semantics. This does not introduce demand-based evaluation.

### Debugging the graph

Failed nodes show **Error origin** or **From <cell>**, based on the kernel's error
provenance. Select a failure to see its message, use **Go to origin** to focus its
source and dependency chain, or **Inspect error** to open the cell's error details.
Red edges connect failures with the same reported origin. Cyclic provenance is
shown as an unavailable origin rather than guessing a cause.

**Hide text / headings** starts enabled; **Hide notes** controls note pages
separately. Text and notes can read live values and participate in dependencies.
**Hide unconnected** removes cells with no observed dependencies or dependents in
the full workbook, including edges to hidden cells. Unknown dependencies of not-run
or failed cells may still appear after evaluation. **Errors only** temporarily
suspends these visibility filters so failed text, notes and unconnected origins stay
visible. A focused selection is always retained. Graph filters are remembered on
this device and never change workbook execution.

### Reactive widget presentation

Notes and grid controls now share the input cell's resolved widget configuration.
Options, labels, placeholders, disabled/visible/loading flags, and button pressed
indicators can read workbook cells. The inspector accepts literal values or
`=Python expressions`; saved workbooks use real `lambda self: …` callbacks.
Buttons can count clicks or toggle a Boolean input. Configuration changes preserve
input values and focused text drafts; choices removed from an option list remain
visible as unavailable instead of silently resetting the selection.

Choose **Auto** when inserting a note widget to inherit its configuration. Cell
configuration dependencies appear in the graph, and configuration errors disable
controls while leaving input values available to calculations. Python can still
write inputs: disabled/hidden/loading settings govern built-in UI interaction.

Try **Reactive app controls** in the Examples menu, or read
[Reactive widget labels and state](GETTING-STARTED.md#reactive-widget-labels-and-state).

## Explicit commands

Use `@action` model methods for user-triggered commands, with a visible Actions editor,
a global Run action picker, pinned commands in the picker, argument forms and note buttons. See [Workbook actions](ACTIONS.md) for a complete
example, input-write behavior, cancellation and embedded-session calls.

### File and folder widgets

Input cells can use **File path** or **Folder path** controls. In a CLI session,
**Browse…** opens a picker over this computer's folders; with browser Python, type a path
accessible to the kernel.
The value is a path string; selection does not upload or read files.
See [Widgets: use and extend](WIDGETS.md) for examples, state flow, host
capabilities and the APIs for adding built-in or anywidget controls.

### Startup diagnostics

A window that cannot load the application shows a startup-failure screen with
**Copy diagnostics**, independent of Angular and Python.

### Themes and performance reports

Choose Light, Dark, Nord, Midnight or Solarized Light in **Settings → App**. Import
custom JSON palettes individually or from a theme folder; **Export theme JSON…**
provides a starting file. See [Themes](THEMES.md).

For slow cell moves or evaluation, start **Record performance** in the same App
settings, reproduce the problem, stop recording, then **Save diagnostics…**. The
report combines bounded timing metadata with existing error/startup logs. Review
it before sharing.
