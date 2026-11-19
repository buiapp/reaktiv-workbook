---
name: reaktiv-workbook-workbook-authoring
description: Inspect and collaborate on shared live Reaktiv Workbook workbooks, author reactive cells and notes, define and run explicit actions, and change presentation through MCP.
---

# Work with the user and their live workbook

Reaktiv Workbook combines a reactive Python workbook, worksheets, Markdown notes and
explicit action methods. Each shared app window owns its document, live kernel,
drafts and undo history. MCP routes to those owners; it does not open another
copy or start a second workbook kernel. A workbook is saved as a `.workbook.py` file.

## Start with context and inspect before changing

1. Call list_workbooks and get_user_context. Use window focus, lastFocusedAt,
   visible worksheet/note IDs and selected/inspected cell IDs to resolve “this”.
   Ask if the target is ambiguous. Never infer a workbook from its name alone.
2. Call get_workbook_overview for worksheet names/grid sizes, inventory, drafts,
   problems and current revision. Use inspect_cells for complete definitions and
   current results. IDs are `A1` on the first worksheet and `Budget!A1` on others.
   Inventory can be truncated; read_workbook returns the complete document.
3. Inspect get_dependencies before changing a calculation. Observed edges are reads
   from the latest settled evaluation, sometimes partial/unobserved. Source edges
   are static authoring references. Widget edges are input bindings. An edge points
   from consumer to dependency. Do not mistake observed edges for every possible
   branch. Inspect values passively; never run an action to discover what it does.
4. Use a small batch with the latest revision. On conflict, reread and reconcile.
   Never retry a timed-out mutation automatically: its outcome may be unknown.
   Respect cell/action drafts. Do not apply or discard the user's drafts for them.
5. Check new values, root problems, logs and diagnostics. Updates can still be
   running: get_kernel_status, list_actions and get_logs remain responsive.
   Explain changes and leave them unsaved unless saving was requested. Edits,
   action definitions, colors and worksheet sizing use the normal GUI undo history.
   Undo cannot reverse external effects of executing Python/action code.

## Model facts and derivations

- `input`: a writable fact. Source is a Python literal/expression, e.g. `120`.
- `formula`: a derived Python expression, e.g. `price * quantity`. A multi-statement
  body can finish with an expression or use `return`; `def`/`class` can return a helper.
- `linked`: a derivation with a user-writable override; inspect existing source and
  computation before editing. Do not replace it with an effect copying state.
- `resource`: async work. Simple loaders capture cell parameters automatically;
  explicit `params` is synchronous parameter code and the async source consumes
  captured parameters. Preserve the existing mode; do not read live cells across
  awaits or introduce effects in parameter code. Inspect an existing example first.
- `effect`: automatically triggered side effects, or manual when `trigger='manual'`.
  Prefer a formula for derived values and an action for user-requested operations.
- `markdown`: Markdown text, either a worksheet label/heading/text cell or a note
  page. For grid labels/text ALWAYS use `view: {"page": false, "display": "rendered"}`.
  Use `view: {"page": true}` only when intentionally creating/editing a Notes page.
  edit_cells requires an explicit Boolean view.page for EVERY Markdown definition.
  Loaded Notes pages often omit page (the file default is true); explicitly put
  page:true back in the MCP edit to preserve that intent. Never classify a heading
  or short dashboard label as a Notes page just because its kind is markdown.

Cell source is ordinary Python in an app authoring namespace. Read a local cell by
its label or coordinate (`price`, `A1`); use `Budget.price` across worksheets. File
source uses model member calls (`self.price()`); the Python writer handles that
conversion. Do not regenerate workbook files yourself or add file decorators to
cell source. Cells may use installed packages; inspect the workbook environment
first. Function helpers belong in function cells; preserve comments and settings.

Use edit_cells for create/replace/delete batches. Replacing requires the COMPLETE
cell definition from inspect_cells: preserve name, kind, source, enabled, trigger,
color, view, annotation, equal, params, computation and override where present.
Creating a simple cell needs id/kind/source; Markdown additionally needs explicit
view.page as described above. New or resized footprints must not
overlap other cells, including coordinates covered by a resized tile. Placement is
checked on the final batch: delete old coordinates when relocating, and use an
empty area for the whole stored span, not just its anchor. Editing validates through the canonical
Python writer and then incrementally applies on the current kernel. It does not
restart Python or save. Use unique Python labels, scoped to a worksheet. Avoid
reserved names such as `cells`, and preserve references when changing names.

## Notes and interactive output

Markdown interpolation: `{{ total }}` or `{{ f"{total:,.2f}" }}`. Use a bare
`{{ chart }}` for a plot/table/widget/HTML cell. Charts are linked to result cells,
not embedded as image data in source. Images use workbook `assets/<name>` paths;
use add_image to upload raster assets and insert its returned durable Markdown reference.
Inline `$V=IR$` and display `$$V=IR$$` LaTeX are supported in Notes and grid Markdown.

Useful note links:

- `#cell-A1`: cell navigation.
- `#note-summary`: another note by label or cell ID.
- `[Amount: {{ amount }}](#sheet-input:amount)`: an input widget; configuration
  lives in the referenced cell's `view.widget`.
- `[Run report](#sheet-action:run_report)`: explicitly invoke an action.
- `[{{ chart }}](#sheet-output?layout=wide)`: wide rich output.

Keep derived logic in cells and explain it in notes. Widgets write input cells;
widget state is a leaf, not something other formulas should read. Do not put
base64 images or generated runtime values into note source.

## Explicit actions

Call list_actions to inspect complete action definitions, parameters, saved bindings,
results, running state and action-draft status. Use upsert_action to create or edit
one COMPLETE definition. Apply compiles/installs the method but NEVER invokes it.
Keep the name when editing; changing the name creates a separate method.

Action source contains exactly one `def`/`async def`, beginning with `self`, without
`@action` (the file writer adds it). Parameters must be named, defaults must be
literals, and the method name must match `name`. Preserve references and bindings
from list_actions when editing. The app refreshes current cell member references.

Example definition (assumes an input cell labelled `quantity`):

```json
{"name":"add_items","label":"Add items","source":"def add_items(self, amount: int = 1):\n    self.Sheet1.quantity.set(self.Sheet1.quantity() + amount)\n    return self.Sheet1.quantity()","references":{},"bindings":{},"exposed":true}
```

Actions belong to the workbook, regardless of the user's selected sheet. Use one
API: `self.<worksheet>.<member>()`, `.set(value)` or `.update(fn)`. Discover actual
sheet names and `modelReference` paths with inspect_cells; `Sheet1` in the example
is only a placeholder. Resource cells use `.value()` for their loaded value.
Avoid legacy flat `self.member` and `self.cells` aliases in new action code.
Saved Python format 2 uses one Worksheet class per sheet and one Workbook class,
decorated with `@workbook_config({...})`, for composition/actions. Cell methods use
`self.member()` locally and `self.workbook.Other.member()` across sheets; actions may
use the same `self.workbook.Other.member()` or the shorter `self.Other.member()`. The
app cell editor keeps short expressions. Preserve metadata and use the standard writer
for source conversion; it imports only the names a file uses and lays out generated
code like `ruff format`.

Action writes update the live graph immediately: after `self.Sheet1.quantity.set(3)`,
a downstream formula read sees the new value without a flush command. Nested
helpers/actions share that state. Failed/cancelled actions keep earlier writes;
effect cells still discard failed staged writes. Cells, notes, tables and plots
refresh automatically during actions through throttled display snapshots; rapid
writes coalesce. No flush command is needed for the UI either. Final completion
commits source/history once. Async resources reload normally but are not instantaneous: await
real readiness/completion before consuming their results; sleep alone is not a
reliable device/resource readiness test. Do not batch across awaits.

For synchronous grouped action writes, import `batch` from `reaktiv` and use
`with batch():`. Effects then observe the grouped values; computed reads inside
still see current values. Display snapshots may see intermediate writes, so this
is not an atomic UI transaction. The app's `self.cells.batch()` is currently a no-op.

For acquired/high-volume data, input definitions can use `saveValue: false`
(`cell(..., save_value=False)` in Python). Action/effect writes keep live values
without converting them into saved source; use a small initializer such as `[]`.
Explicit code/widget edits still update the initializer. Reopening reruns it.
Output snapshots are configured separately and may still contain the data.

A function-valued cell must be read, then its returned function called:
`helper = self.Test.helper()` followed by `helper(arg1, arg2)`. Do not pass
those arguments to the cell handle. Bare cell names are not globals in an action;
use explicit model/handle references. This requires no extra formula wrapper or
bound argument merely to obtain a function.

Use run_action ONLY for an intentional execution, with a current revision and no
unapplied cell/action drafts. The action must be exposed. Arguments are bindings:
`{"amount":{"value":3}}`, `{"amount":{"cell":"A1"}}`, or
`{"amount":{"default":true}}`. Cell bindings capture the current value once at
invocation; defaults use Python defaults, not a saved binding. Omitted arguments
use the method's saved bindings/defaults. Long actions may outlive an MCP timeout;
inspect list_actions/logs before retrying. cancel_action requests cancellation of
an exposed async action; cancellation is cooperative and does not undo side effects.

## Widget views, Markdown labels, colors and worksheet dimensions

Use set_cell_view(workbook, revision, cell_id, view) to configure an existing cell
without replacing its source, label, color or other metadata. It patches only the
supplied view fields and merges widget fields. Example view for an input slider:
`{"display":"rendered","widget":{"type":"range","min":0,"max":100,"step":1}}`.
Types: checkbox, number, range, select, radio, text, textarea, date, list,
multiselect, button, file, folder. Select/radio/multiselect use options such as
`{"type":"select","options":["L1","L2","L3"]}`. Dynamic settings use the normal
widget expressions; text/state expressions use `{"expr":"..."}`. An action button
can use `{"type":"button","buttonMode":"action","action":"refresh"}`;
`debounce` (whole ms, 0-10000) sets when a range/text/number widget updates its cell while edited: 0 applies every change instantly; unset, sliders wait 150 ms and text/number apply on Enter or blur.
`cancelWhileRunning:true` optionally enables Run / Cancel for that action's active invocation. Cancellation is cooperative; configuring a button never invokes the action. Inspect existing settings first.

For an existing Markdown dashboard label, patch
`{"page":false,"display":"rendered"}` to remove it from Notes while preserving
its content and span. Use page:true for an intentional Notes page. Never delete
and recreate a label just to fix this classification. `span:[columns,rows]` also
works, with the normal overlap checks. Unmentioned settings are preserved; null
removes a field and widget:null returns to automatic controls. Requires a current
revision, running kernel and no conflicting cell draft; one undo step. Widget
configuration can recompute; live input values and the existing kernel survive.

set_cell_colors changes only existing cell backgrounds, as one undoable batch.
Use `#RRGGBB` (e.g. `#cde7ae`) or `""` to clear. It preserves code and drafts and
does not evaluate Python for fixed colors. For reactive warnings/statuses pass
`expression="'#ffcccc' if temperature > 80 else '#ccffcc'"`, or reference a color
cell (`expression="Status.warning_color"`) or call a shared signal. Expressions
return #RRGGBB, None or ''; `color` becomes the error fallback. A running kernel
and no user drafts are required. Inspect results for color, colorError and
colorDependencies. Omitting expression clears it. New cells can use
`view.color={"expr": "warning_color"}` in edit_cells; preserve their widget settings.

insert_rows_or_columns and delete_rows_or_columns insert or delete whole rows or
columns like a spreadsheet: later cells shift with their references, inputs keep their
values, row heights/column widths and crossing tiles adjust, in one undo step. Deleting
cells that others read is refused unless allow_broken_references=true.

resize_worksheet changes the visible grid to explicit columns/rows; use the exact
worksheet name from the overview, including the first sheet's name. It expands or
shrinks the extent without inserting/deleting/renaming cells or shifting references.
Occupied cells, spans, drafts and hidden row/column sizes are preserved. A shrink
is clamped to the occupied extent; inspect returned actual dimensions. The tool
accepts 1–1000 per dimension and at most 100000 requested grid slots. Colors and
grid sizing stay available while a shared workbook's kernel is stopped.

## Verify widget and rendered-output sizing

After setting a view, use inspect_cells and its layout array. Read stored/displayed
spans, grid pixel dimensions and per-pane usable/content sizes. Pixel sizes are
unzoomed CSS layout pixels; pane zoom is separate. Inspecting never scrolls or
switches the user's view. Hidden/unmounted outputs are unmeasured, unfinished DOM
or plots are render-pending, and sandboxed widget internals are opaque. Never
claim an off-screen or pending widget fits based only on its span.

recommendation contains estimated minimum content/outer dimensions, suggestedSpan,
meetsMinimum, placementValid/placementError, requiredGrid and requiresGridExpansion.
These are readability estimates, not guaranteed fits. Plotly can fit without
clipping yet still be too small to read. Check overflow AND estimated minimums.
Viewport clipping just means the user has scrolled; it is not content overflow.
Grid spans do not resize graph cards. If a recommendation overlaps another cell,
reconcile placement with the user rather than overwriting neighboring content.

Workflow: configure, inspect, adjust, verify. set_cell_view returns best-effort
layout plus layoutRevision; reconcile when it differs from the edit revision.
For render-pending, inspect again after rendering. If layout sampling fails, the
edit may already have succeeded: inspect current state instead of retrying it.
Use resize_worksheet first if more grid space is needed, then patch span with the
current revision. Keep user drafts, layout and nearby cells safe.

## Diagnose and recover

get_logs filters retained stdout/stderr, errors, tracebacks and app/kernel messages.
get_diagnostics returns root causes, affected cells, existing type findings and
recorded performance/update traces. These reads never enable recording, run type
checks, sample memory or evaluate cells. Missing debug data is reported explicitly.

Kernel start/restart require a current revision, no drafts and an idle kernel.
Interrupt bypasses the edit queue. Restart/forced recovery loses Python state and
can rerun effects; Pyodide interruption also needs a restart. Use only when needed
or requested, not as routine validation. Stopped cells remain held until changed
or run again. Embedded scripts own their kernels; remote kernels cannot be
force-restarted. Use GUI controls for unsupported environment/worksheet operations.

## Worksheets, shared code and packages

Use manage_worksheet with create/update/delete and explicit worksheet names from
get_workbook_overview. update accepts new_name and optional columns/rows. It keeps
existing app reference rewrites and offers one undo step. Never delete a referenced
sheet by default; update dependents first. allow_broken_references=true is an
intentional destructive choice. The first sheet is protected; reorder in the app
before deleting it. The selected sheet is not an implicit tool target.

Read get_workbook_environment before editing. update_workbook_environment replaces
only provided shared_code/imports/packages fields; preserve everything else.
Shared code/imports execute on the existing kernel and can rerun effects. Keep pure
helpers in function cells when possible; shared code suits imports and state that
must survive recomputation. Package requirements are saved configuration: changing
them does NOT install packages or restart Python. Explicitly use control_kernel
restart when activation is intended (runtime values may be lost and effects rerun).
Remote/embedded hosts install their own dependencies. Nothing auto-saves.

## Rendering, images, Schemdraw and LaTeX

Call get_rendering_capabilities before choosing a renderer. A formula/resource can
return a Matplotlib figure, Plotly figure, pandas table, anywidget, HTML wrapper,
or an object with _repr_svg_/_repr_png_/_repr_mimebundle_. Enable grid output with
set_cell_view(display='rendered'). A bare {{ drawing }} in Markdown shows that
cell's rich output; wrapping it inside a sentence may display text instead.

Schemdraw: create Drawing(show=False) with the SVG backend, add elements, and
return the Drawing object. Its _repr_svg_ output is supported. Alternatively use
html(drawing.get_imagedata('svg').decode('utf-8')); HTML is sanitized. Returning
raw SVG bytes/text alone does not choose an image renderer. Avoid show()/GUI windows.
See https://schemdraw.readthedocs.io/en/stable/usage/start.html.

Notes and grid Markdown support KaTeX LaTeX: inline `$V = IR$` and display
`$$\int_0^1 x^2\,dx$$`. Use ordinary Markdown source, not HTML escaping. In JSON,
backslashes need JSON escaping. Use view.page=false for labels/text in the grid
and true for intentional Notes pages.

For a static external/generated raster image, add_image accepts base64 PNG, JPEG,
WebP or GIF (maximum 5 MB). It returns assets/<content-hash> plus Markdown; insert
`![Description](assets/<hash>)` with edit_cells. Do not embed base64 into source or
invent host file paths. SVG asset uploads are refused; SVG computed outputs work.
The existing asset save/archive flow carries uploaded images with the workbook.

## Verify appearance and fit

After enabling or changing a rendered/widget view, call inspect_cell_layout with
explicit cell_ids. Read fit.resizeNeeded, current sizes, overflow and status.
If resizeNeeded=true, review recommendation.suggestedSpan, placementValid,
placementError and requiredGrid. Increase grid dimensions first when required,
then patch the cell span and inspect again. A suggested span is an estimate, not a
promise. Pending/unmeasured/opaque content is not confirmed to fit. Plotly may
technically fit but still be too small to read.

Call inspect_visual for a cell or visible note to receive an actual MCP PNG image.
This requires a vision-capable agent client. It captures only the requested content;
it never runs Python or changes the user's selection/view. Offscreen image/chart
cells may return an output preview instead of their grid appearance: read
captureKind and warnings. Sandboxed iframe/anywidget internals are omitted;
cross-origin images/WebGL and native WebKit rasterization can be limited.
Combine the image with layout feedback; an output preview does not prove grid fit.

The GUI Agent activity panel can hide/show persistent Agent labels. Hiding labels
preserves their provenance and live reading/writing animations.

Embedded script sessions currently lack asset synchronization and refuse image
uploads to avoid losing them on save. Use computed image/SVG outputs there, or
open the workbook normally for durable assets. CLI and normal browser saves
use the existing asset-folder/ZIP flows.

## Dense widget layout and safe reference changes

Prefer `set_worksheet_layout` when widgets are clipped and adjacent cells prevent
larger spans. Patch `row_heights` (keys "1", "2", 28–240 CSS px) and
`column_widths` (keys "A", "B", 64–480 CSS px). Null restores a default. Values
are before zoom. This affects every cell sharing a track, preserves coordinates
and references, works with the kernel stopped, and is one undo step without
Python evaluation or saving. Example: row_heights={"2":64,"4":160},
column_widths={"B":300}. Use measured feedback rather than applying these values
indiscriminately. `inspect_cell_layout` returns `recommendation.trackSizing` as an
alternative to `suggestedSpan`; check `meetsMinimum`, then inspect after rendering.

Move through `move_cells(cell_id=anchor, target_id=destination, cell_ids=group)`
with the current workbook/revision. Omit cell_ids for one cell. Destinations must
be empty; spans cannot overlap existing cells. The existing live transaction
updates formulas, notes, action targets/handles and widget bindings together,
preserving live input objects. Never work around validation with sequential
moves/deletes/action edits. Drafts must be applied or discarded first.

Use `set_cell_label(cell_id=..., label=...)` for existing labels; empty string
removes the label. Coordinates and old labels in static references are refactored
across cells, notes, widgets and actions. Literal strings/comments stay intact.
Conflicting/shadowed labels are refused. `edit_cells` refuses existing label changes.
Dynamic Python (`getattr`, constructed names) cannot be rewritten statically.

Action upserts store only actual self.member cell references. Do not send a
reference map containing every cell as completion context. Existing explicit
bindings remain authoritative; new members are resolved against current cells.

## Concurrent actions

Different async actions can overlap. Each action runs once at a time; duplicate
invocations are refused. Use explicit user-code guards when different actions
share a device or workflow requiring exclusivity. Widgets continue
writing inputs while actions await. Inspect list_actions `runs` receipts and use
cancel_action with run_id for one invocation, or omit it to cancel the current call of a
method. Cancellation does not undo writes or stop user-created threads. Offload
blocking I/O explicitly; return results to the owner coroutine before writing cells.
Structural edits wait for active invocations.
