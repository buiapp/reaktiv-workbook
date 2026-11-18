# Workbook MCP server

Agents collaborate on workbooks already open in Reaktiv Workbook over authenticated
Streamable HTTP. The app keeps its current Python kernel, inputs, document,
notes and history. You choose which windows to share. Each agent edit batch is
one undo step.

## Start MCP with the editor

```bash
reaktiv-workbook edit analysis.workbook.py --mcp
# or, without installing:
uvx reaktiv-workbook edit analysis.workbook.py --mcp
```

The CLI serves the MCP endpoint next to the editor and shares the open workbook as soon
as the editor loads; no click in the app is needed. The terminal prints the URL
(`http://127.0.0.1:8766/mcp`; change the port with `--mcp-port`) and the
`Authorization: Bearer …` header to configure in the agent, once: the token is saved
(`~/.config/reaktiv-workbook/mcp-token` on Linux) and all workbooks opened with `--mcp`
share the endpoint, so the agent's MCP configuration never changes. If the serving
editor quits, another editor takes over the same URL and token; an agent may need to
reconnect its MCP session then. Delete the token file to issue a new one. **Agent access** in the app
shows the connection and offers **Stop sharing this workbook**. See
[standalone CLI](STANDALONE-CLI.md#agents---mcp).

## Externally managed service

A browser page cannot start a local listening process. To share workbooks from the
website or a hosted app, start the HTTP service yourself. It uses the same saved token
(set `REAKTIV_WORKBOOK_MCP_TOKEN` to use another one), and `edit --mcp` editors join it:

```bash
uv sync --locked --extra mcp
uv run --locked --extra mcp reaktiv-workbook-mcp --port 8766
```

The CLI always starts HTTP. No mode or transport argument is needed.

Agents connect by URL with `Authorization: Bearer <pairing token>`. They do not
launch a subprocess. **Copy MCP URL** and **Copy OpenCode HTTP configuration** are
available in the panel, including while sharing. Keep the token and configuration
private. The server uses the optional
[official MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x);
Pyodide and execution kernels do not import the SDK.

For a hosted browser app, add `--app-origin https://your-app.example` when starting
the service. Local browser origins are allowed by default. The browser
may require permission to access the local network. The bridge supports existing
Pyodide, remote and CLI session kernels.

## Network bridge addresses

The app accepts HTTP and HTTPS origins, including VPN/LAN IPs and hostnames.
A bare address such as `192.0.2.10` is normalized to
`http://192.0.2.10:8766`. Include a port to use a different one. The bridge
field is a connection destination; changing it does not rebind a running server.

To listen on that specific interface, start the server on its host with:

```bash
uv run --locked --extra mcp reaktiv-workbook-mcp --host 192.0.2.10 --port 8766
```

Both the app bridge and OpenCode can then use `http://192.0.2.10:8766`
(OpenCode appends `/mcp`). The configured pairing token is still required.

To listen on all IPv4 interfaces instead:

```bash
uv run --locked --extra mcp reaktiv-workbook-mcp --host 0.0.0.0 --allowed-host 192.0.2.10 --port 8766
```

`0.0.0.0` is a **listen address**, not a URL to enter in the app or agent client.
Use the server's actual reachable IP or hostname. Repeat `--allowed-host` for
additional DNS names/IPs; this keeps MCP Host-header checks enabled. A specific
`--host` IP/name is automatically allowed, while wildcard binds require an explicit
reachable `--allowed-host` or `--allowed-host '*'`. Loopback hostnames remain allowed as well.

**Allowing all client machines:** choose listen address `0.0.0.0`, and enter the
server address clients will use (for example `192.0.2.10`) under allowed hosts.
Agents connect to `http://192.0.2.10:8766/mcp`. Allowed hosts validates the
server hostname/IP in the HTTP request; it is **not a client-IP allowlist**. Any
machine that can reach the port can authenticate with the token. No `*` is needed.
List additional DNS names/IPs if clients use several server addresses. Firewall or
VPN rules still determine which machines can reach that port.

To accept **every server hostname/IP** in client URLs, pass `--allowed-host '*'`.
This relaxes Host-header validation only; pairing-token authentication,
browser-Origin restrictions and bridge CORS remain enforced. The listen address
still determines which network interfaces accept connections.

CLI equivalent (quote the asterisk to prevent shell expansion):

```bash
uv run --locked --extra mcp reaktiv-workbook-mcp --host 0.0.0.0 --allowed-host '*'
```

Clients still use an actual reachable IP/hostname in their URL, never `*` or
`0.0.0.0`. The default remains specific hosts; partial patterns such as
`*.example.com` are not supported.

The default listener is still loopback. Direct network access is an explicit
server option. Use a trusted network/VPN, an HTTPS reverse proxy, or the SSH tunnel
below to protect the bearer token in transit. HTTPS URLs in the GUI refer to an
HTTPS proxy; the built-in listener serves HTTP. For a browser app on a nonlocal
origin, also set `--app-origin` to that app's origin.

## Live agent tools

- `list_workbooks()` lists currently shared windows with names, handles and their
  latest view/focus context (updated by the app heartbeat).
- `get_user_context(workbook?)` resolves “this workbook”, “this note” or “this cell”.
  Without a handle it lists shared windows and their latest context. With a handle
  it requests fresh context directly from that window, including while Python is busy.
  Context includes window focus and last-focus time, visible panes/worksheets/note
  IDs and titles, active pane, selected cell IDs, open inspector/editor and the
  focused cell/note when identifiable. For multiple windows use window focus and
  last-focus time to identify the user's current workbook. Context describes the
  latest UI at sampling time; use `read_workbook` to inspect content before editing.
- `read_workbook(workbook)` returns document source, current results/dependencies,
  `draftedCells`, view/focus context, kernel status and an opaque `revision`. It does not run cells.
- `get_workbook_overview(workbook)` gives a compact inventory, worksheets, notes,
  cell kinds, exposed action names, packages, current problems and revision. It
  lists environment variable names, not their values. Cell/note inventories are
  capped at 200; use `read_workbook` for the complete document when truncated.
- `inspect_cells(workbook, cell_ids)` reads 1–100 complete definitions plus current
  values, errors/tracebacks, resource state, timings, signatures and table shape.
  Use explicit IDs such as `Budget!A1`; no binary image/widget payloads are returned.
- `get_dependencies(workbook, cell_ids, direction?, mode?, depth?)` explores upstream,
  downstream or both, with depth 1–10. `observed` reflects the latest runtime reads,
  `source` static authoring references, and `widget` input bindings. Observation
  flags distinguish partial/unobserved runs. Edges point from consumer to dependency.
  Results cap at 1000 nodes/5000 edges and report missing data and truncation.
- `get_logs(workbook, cell_ids?, level?, search?, since?, limit?)` queries retained
  logs newest first, deduplicating entries with stable IDs. `since` is an exclusive
  timestamp cutoff; limits are 1–500 (default 100). Levels are info/warning/error,
  plus filters all/system. Logs include captured output and error tracebacks, and
  remain bounded to the existing window retention.
- `get_diagnostics(workbook)` returns root-cause problems and affected cells,
  settled-update timings, update traces, existing type findings and recorded
  performance metadata. Missing traces are reported explicitly. Enable **Record
  performance** in app settings before reproducing a problem to collect timings.
  The tool does not enable recording, sample memory or run a new type check.
- `get_kernel_status(workbook)` returns status/error, current/pending/stopped cells,
  cached resource usage, supported controls and current revision. It remains
  responsive while Python runs.
- `control_kernel(workbook, action, revision?, force?)` uses existing app controls:
  `start`, `restart`, `interrupt`. Start/restart require a current revision, no
  unapplied cell/environment drafts and an idle kernel. Interrupt bypasses the edit
  queue. `force: true` is explicit local/Pyodide recovery and requires a revision
  and no cell drafts. **Restart loses Python memory and reruns cells/effects.**
  Pyodide interruption also needs a restart. A stopped cell stays held until changed
  or run again, as in the GUI. Embedded scripts own their kernels; remote kernels
  cannot be force-restarted. Kernel shutdown and environment-variable edits are not exposed; package/shared-code tools are described below.
- `list_actions(workbook)` returns complete definitions, source, references, saved
  argument bindings, parameters, result previews, errors, live running/applying
  state and whether user action drafts exist. Reading never invokes an action.
- `upsert_action(workbook, revision, definition)` creates/replaces one complete
  method. `name` and `source` are required; preserve `label`, `references`, `bindings`
  and `exposed` when editing. Source is one complete `def`/`async def` beginning with
  `self`, without `@action`. The writer validates statically, then the existing
  direct action-update command compiles/installs it without invoking it or resetting
  inputs. Confirmation creates one **Agent action edits** undo step. Existing
  action drafts, including those stashed in the hidden Actions pane, are protected.
- `run_action(workbook, revision, name, arguments?)` intentionally invokes an exposed
  action. Arguments use `{"amount":{"value":3}}`, `{"amount":{"cell":"A1"}}`
  or `{"amount":{"default":true}}`. Omitted choices use saved bindings/defaults;
  cell bindings capture once. Requires current revision and no user
  cell/action drafts. Different actions may run concurrently; a second invocation of an already-running
  action is refused. Users own guards coordinating different actions. Action results include individual `runs` receipts with IDs, status and errors.
  External effects cannot be undone. Inspect status/logs before retrying a timeout.
- `cancel_action(workbook, name, run_id?)` requests cooperative async-action cancellation,
  including while other invocations are active. Supply optional `run_id` from
  `list_actions` to cancel only that invocation; omission cancels the current run of the named action. Cancellation does not roll
  back completed writes or external effects.
- `set_cell_colors(workbook, revision, cell_ids, color="", expression=None)` sets
  fixed or reactive highlights in one undo step. `color` is `#RRGGBB` or `""`;
  with an expression it is the fallback if evaluation fails. For example,
  `expression="'#ffcccc' if temperature > 80 else '#ccffcc'"` or
  `expression="Status.warning_color"`. Expressions can call signals, return `None`
  or `""` to remove highlighting, and require a running kernel with no user drafts.
  Omitting the expression removes a previous expression; fixed colors work with
  Python stopped. Inspect results for `color`, `colorError`, `colorDependencies`.
  `edit_cells` accepts the same expression as `view.color={"expr": "temperature_color"}`.
- `resize_worksheet(workbook, revision, worksheet, columns, rows)` changes visible
  extent using the exact worksheet name, including the first sheet's name. Requested
  dimensions are 1–1000 each, at most 100000 slots. It does not insert/delete/move
  cells or shift references. Shrinking clamps to cells, spans and drafts; actual
  dimensions are returned. Hidden size settings and navigation are preserved.
  One **Agent worksheet size** undo step; no evaluation. Colors/grid sizing remain
  available if an already-shared workbook's kernel stops.
- `edit_cells(workbook, revision, cells, delete?)` creates/replaces complete cell
  definitions and deletes IDs. New/resized footprints cannot overlap other cells or
  resized tiles; a batch is checked against its final positions after deletions.
  It validates through the Python file writer, then
  uses the app's command queue and normal incremental kernel apply. It does not save.
- `save_workbook(workbook, revision)` uses the app's existing save flow for named
  CLI or embedded workbooks. New files and browser downloads must be saved by
  the user in the app. Save respects the workbook's output snapshot preference.

Read before editing. Pass the returned string revision and complete definitions:

```json
{
  "workbook": "<shared handle>",
  "revision": "<revision from read_workbook>",
  "cells": [
    {"id": "A1", "kind": "input", "name": "price", "source": "20"},
    {"id": "B1", "kind": "formula", "name": "total", "source": "price * 3"},
    {"id": "C1", "kind": "markdown", "name": "report", "source": "# Report\nTotal: **{{ total }}**", "view": {"page": true}}
  ]
}
```

Markdown cells can be grid labels/text (`view.page:false`) or Notes pages
(`view.page:true`); MCP edits must choose explicitly. Use labels in formulas and `{{ label }}` for live note
values. Cell IDs use `A1` on the first worksheet, `SheetName!A1` elsewhere.
Optional fields include `view`, `annotation`, `enabled`, `trigger`, `equal`,
`params`, and `computation`. When replacing a cell, retain settings from the read
that you are not changing. See [Getting started](GETTING-STARTED.md).

User or runtime changes invalidate the revision. Edits/deletions that touch a user
draft fail without applying; drafts on unrelated cells remain intact. Validation
rechecks revision, drafts and sharing after it awaits Python. Agent edits appear
in the normal views, highlight affected cells, mark the workbook dirty and enter
recovery history. **Undo Agent cell edits** reverses a batch; Redo reapplies it.
The panel shows agent activity, latest success/conflict, and connection state;
rejected requests also appear in Logs. Effects may run when edits recalculate.

## Sharing lifecycle and limits

**Stop sharing this workbook** removes the handle. Opening another document,
closing/navigating away from the window, and app teardown also revoke access.
Sharing consent is not persisted. Reopening the app does not silently share files.
A closed or disconnected window becomes undiscoverable after its short lease.
Sharing multiple workbooks does not introduce cross-workbook formula references.

The bridge defaults to loopback and requires the pairing token on every interface. It owns no Python model
or file path and cannot discover unshared workbooks. Trusted agents can edit
executable Python; normal kernel permissions apply. Package installation requires an explicit kernel start/restart; editing package
requirements alone does not install them. Raster asset uploads are available through
add_image. Environment-variable replacement and window-closing tools are not exposed.

Commands deliver once, have a deadline, and are never retried automatically.
If the MCP client times out or disconnects after an edit starts, its outcome may
be uncertain: read and reconcile before retrying. Revocation prevents queued and
still-validating edits; it cannot roll back an edit already executing in the
kernel. Use the app's existing Stop and Undo controls. Edits do not restart Python.

Use one HTTP server process per pairing/port. Multiple clients can share that service.
Polling may pause in suspended browser tabs; keep shared windows active during work.
Passive inspection tools return the latest settled snapshot while execution is busy;
status and logs report current window activity. Ordinary reads/edits/saves remain
serialized. Worksheet creation/renaming/deletion, action deletion, asset transfer and environment replacement are outside this interface.

## Authoring skill through MCP

The bundled [workbook-authoring SKILL.md](../python/reaktiv_workbook/skills/workbook-authoring/SKILL.md)
explains facts/derivations/resources/effects, Python references, notes/widgets, explicit
methods and argument bindings, revisions/drafts, colors/grid sizing and recovery.
It is distributed with the Python package; no workbook or
running kernel is needed to read it.

The same content is available through:

- MCP resource `reaktiv-workbook://skills/workbook-authoring`, named `workbook-authoring/SKILL.md`.
- MCP prompt `workbook_authoring`.
- Read-only fallback tool `get_authoring_guide()` for clients using tools primarily.

Server instructions tell agents to load the guide before authoring. MCP serves the
content but cannot force a client to install or automatically load a native skill.
If needed, tell the agent: “Call get_authoring_guide before editing my workbook.”

## Recommended agent workflow

1. List workbooks and resolve the user context; ask if several targets are ambiguous.
2. Get the overview, inspect the target cells and their upstream/downstream graph.
   Treat observed reads as potentially incomplete when their flags say so.
3. Read and preserve complete definitions, respect draft IDs and use the returned
   revision for a small edit batch. Edits validate through the canonical Python writer.
4. Inspect new values, problems, logs and diagnostics after the edit. If execution is
   still running, use status/logs; interrupt only when appropriate. A timed-out write
   has an uncertain outcome: inspect before retrying.
5. Explain the change and leave it available for GUI Undo. Save only when requested.

Useful future additions are rendered note/chart inspection, explicit type-check
requests and previewing a proposed edit before application. These are follow-up
capabilities; current passive diagnostics never run code to inspect a value.

## OpenCode and access from another host

OpenCode supports a remote MCP URL and bearer-token headers, so the OpenCode
machine does **not** need Python, this package, or a locally installed MCP server.
The MCP service runs on the Reaktiv Workbook host; start the editor there with `reaktiv-workbook edit FILE --mcp`. See [OpenCode's remote MCP documentation](https://dev.opencode.ai/v2/docs/mcp-servers/#remote).

In **Agent access**, the pairing token has **Show/Hide** and **Copy** controls.
They stay available while sharing; the active token is read-only until sharing
and the app-owned service stops. **Copy OpenCode HTTP configuration** produces OpenCode 2's `mcp.servers` format,
which differs from the `mcpServers` format used by other clients.

On the **Reaktiv Workbook host**, start one HTTP service from the app checkout:

```bash
uv run --locked --extra mcp reaktiv-workbook-mcp --port 8766
```

Keep the app's bridge address at `http://127.0.0.1:8766` and share the desired
workbooks. The same listener serves the app bridge and authenticated MCP at
`http://127.0.0.1:8766/mcp`. The service runs independently of agent clients. Add `--app-origin https://your-app.example` if
using a hosted browser app, as described above.

On the **OpenCode host**, forward that listener over SSH:

```bash
ssh -N -L 8766:127.0.0.1:8766 user@reaktiv-host
```

Then put the copied configuration in your OpenCode 2 `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "reaktiv-workbook": {
        "type": "remote",
        "url": "http://127.0.0.1:8766/mcp",
        "oauth": false,
        "timeout": { "execution": 65000 },
        "headers": {
          "Authorization": "Bearer <token from ~/.config/reaktiv-workbook/mcp-token>"
        }
      }
    }
  }
}
```

For OpenCode 1, place `reaktiv-workbook` directly under `mcp`, remove the `servers`
wrapper, and use `"timeout": 65000`. The GUI copy button targets OpenCode 2.

Check the connection with `opencode mcp list`. On the same host, omit the SSH
tunnel and use the same configuration. If local port 8766 is already occupied,
forward a different local port and change only OpenCode's URL; the app's local
bridge address stays unchanged. Only one service can listen on that port.

With the default loopback listener, remote access uses the encrypted tunnel.
For direct VPN/LAN access, use the network binding options above. No new kernel starts and
no workbook runtime is restarted. Several HTTP clients can join the same service;
they share the user-authorized handles and the existing revision checks.

## Verification

Tests cover authenticated HTTP MCP initialization, tool listing and edit routing,
multiple shared windows, revocation, cancellation/timeouts, validation races,
draft protection and app undo/redo. CLI tests verify the default HTTP launch and
rejection of removed mode options. GUI tests cover token reveal/copy, the HTTP
URL and OpenCode configuration. Strict Pyright and the production build also pass.

Real Chromium checks exercised already-running Python sessions and a Pyodide
worker, preserving live input object identity across cell/note edits.

The local OpenCode 2.2.3 CLI loaded its isolated test configuration but reported
no configured servers, including after its own `mcp add` command. An end-to-end
OpenCode connection could not be verified in that profile; the copied format
follows the OpenCode 2 documentation. The HTTP endpoint is tested with the
MCP SDK client over TCP.

## Watching agent activity

The status bar's **Agent activity** button opens the latest 50 requests, including
running/completed/failed outcomes and links to affected cells. Reading cells gives
a short blue highlight; writing uses amber, and command activity uses purple.
Grid and graph cells show **Agent +** for created cells and **Agent ✎** for edited
cells; the inspector and notes expand the labels. Agent-invoked actions also mark
input source changes, while ordinary downstream recomputation is not an edit.

Badges describe current cell definitions changed by agents in this window's
session. Undo or a manual edit hides a badge when the definition no longer matches;
redo can restore it. These markers are not saved to workbook files. **Clear
activity and cell badges** dismisses them, and opening another workbook resets
feedback. Read highlights describe returned cells, not an agent's internal reasoning.

## Cell views, widgets and Markdown labels

Use `set_cell_view(workbook, revision, cell_id, view)` to patch existing presentation
settings without replacing the cell's source, name or color. View keys are
`display`, `span`, `page`, `markdown` and `widget`; unmentioned fields survive and
widget fields merge. For a slider, pass
`{"display":"rendered","widget":{"type":"range","min":0,"max":100,"step":1}}`.
For a dashboard label, pass `{"page":false,"display":"rendered"}`. Null removes
settings; `widget:null` returns to automatic widget selection. This uses the normal
edit path, requires a running kernel/current revision, respects drafts and overlaps,
keeps live inputs, and creates one undo entry. Set `widget.cancelWhileRunning: true` on an action button to let its rendered
control request cancellation of its active invocation. This setting is Boolean
and saved with the workbook; cancellation remains cooperative.
Configuring an action button does
not run the action.

**MCP Markdown edits must explicitly choose placement.** Every Markdown definition
in `edit_cells` must contain Boolean `view.page`: `false` for worksheet labels,
headings and text; `true` for an intentional Notes page. Missing choices return an
error without editing. This also applies to existing Notes pages whose stored
normalized definition omits the default `page:true`. This MCP authoring guard does
not change workbook-file or GUI defaults.

## Measuring rendered cells

`inspect_cells` returns a `layout` array alongside definitions/results. Each report
identifies the worksheet and prefix, stored/displayed span, grid dimensions in
pixels, rendered content kind and `renderedInGrid`. All pixel sizes are **unzoomed
CSS layout pixels**. Measurements identify the pane, view and zoom separately.

Visible outputs report `outerPx`, `usablePx`, `contentPx`, horizontal/vertical
`overflow`, `clipped` and `scrollable`. `viewportClipped` means the cell extends
outside the current scroll viewport, not that its content needs a larger span.
`unmeasured` means the cell is hidden/unmounted/off-screen; `render-pending` means
the DOM or asynchronous chart has not caught up. Sandboxed widget internals are
`opaque`, with unknown clipping. No inspection scrolls or navigates the app.

`recommendation` is an **estimated readability minimum**, not a guaranteed fit.
It includes minimum content/outer sizes, a suggested grid span, whether that span
meets the minimum, placement validity/error, required grid extent and whether grid
expansion is needed. Suggestions use actual row/column sizes and the existing
collision validator. They apply to worksheet grid cells; graph card sizes have a
separate owner. Plotly can fit without clipping while still being unreadably small.

Use **configure → inspect → adjust → verify**. `set_cell_view` returns best-effort
post-edit layout feedback and `layoutRevision`; compare it with the edit revision
and reconcile if newer. If rendering is pending, inspect again later. If feedback
is unavailable, the edit may already have succeeded: inspect, never blindly retry.

## Worksheet, environment and visual tools

`manage_worksheet` creates, renames/resizes, or deletes a sheet using explicit names.
Changes use the app's history and reference paths. Referenced sheets require an
explicit `allow_broken_references=true` to delete; the first sheet remains protected
(reorder in the app first). User drafts, stale revisions and busy kernels are refused.

`get_workbook_environment` reads shared code, imports and package requirements.
`update_workbook_environment` replaces only supplied fields. Code/imports apply to
the existing kernel; package changes are stored without installing or restarting.
Use an explicit `control_kernel` restart to activate dependencies. Remote/embedded
hosts own package installation. Environment-variable values are omitted from this
read tool. These edits are undoable and remain unsaved.

`get_rendering_capabilities` explains supported outputs, Schemdraw SVG, KaTeX
`$inline$` / `$$display$$` math, rich-output interpolation and image assets. The
same guidance is bundled in the authoring skill. `add_image` uploads raster images
(up to 5 MB) to the existing asset store and returns a durable Markdown reference;
it does not insert a cell or save. SVG assets are refused; computed SVGs can render.

`inspect_cell_layout` gives `fit.resizeNeeded`, measured/estimated/pending fit,
readability spans, collision checks and grid expansion requirements. Reinspect
after resizing. Sandboxed widget internals remain opaque.

`inspect_visual` returns an MCP PNG image for one explicit visible cell or note.
Hidden image/chart cells can return an output preview instead. It does not evaluate
Python, scroll, select cells, or capture the app chrome. Read `captureKind` and
warnings; sandboxed iframe content is omitted and browser rasterization can differ
from native rendering. The MCP client must support images for the agent to see it.
Visual inspection is deliberately on demand, with bounded image dimensions/payloads.

In the GUI **Agent activity** panel, **Show Agent labels on cells** toggles persistent
provenance labels across notes, grid, graph and inspector. The device remembers this
preference. Labels are retained while hidden, and live activity animations continue.

Embedded script sessions currently lack asset synchronization and refuse image
uploads to avoid losing them on save. Use computed image/SVG outputs there, or
open the workbook normally for durable assets. CLI and normal browser saves
use the existing asset-folder/ZIP flows.

## Relayout without breaking references

Use `set_worksheet_layout(workbook, revision, worksheet,
row_heights={"2":64,"4":160}, column_widths={"B":300})` to enlarge existing tracks.
Keys are row numbers and uppercase column letters; values are unzoomed CSS pixels.
Rows accept 28–240 px and columns 64–480 px. Null resets a specific override.
The whole patch is validated before applying. Other tracks, spans, cell positions
and references stay intact. All cells sharing a track use its size. This works
with the kernel stopped and has one undo step; it does not evaluate or save.

`inspect_cell_layout` now offers `recommendation.trackSizing`, including row/column
patches and `meetsMinimum`, alongside the collision-checked `suggestedSpan`.
For densely packed controls, prefer track sizing; for sparse dashboards, spans may
be suitable. Recommendations are estimates plus observed overflow. Inspect again
after rendering and use `inspect_visual` to review appearance.

Use `move_cells(workbook, revision, cell_id, target_id, cell_ids?)` for a real move.
The optional group includes its anchor `cell_id`. Destinations must be empty and
footprints must not overlap other cells. It uses the live transaction, preserving
initialized inputs and updating formula/note/action references and widget argument
bindings together. It requires a running kernel and no open drafts.

`set_cell_label(workbook, revision, cell_id, label)` assigns/renames a label, or
removes it with `label=""`. GUI label Apply uses the same refactoring plan. Static
references in code, notes, widgets and actions follow the change atomically;
comments and literal strings remain intact. Duplicate/reserved or shadowed labels
are refused. Use this instead of changing an existing name through `edit_cells`.
Dynamic Python references such as `getattr` cannot be refactored statically.

Action references now contain only members used by the method; Apply no longer
pins an action to all cells in the workbook. Existing unused aliases are discarded
when parsed, without running the method.
