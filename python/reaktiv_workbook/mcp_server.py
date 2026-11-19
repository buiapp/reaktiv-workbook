"""Authenticated HTTP MCP adapter (CPython only). Never imported by Pyodide or the kernel."""
from __future__ import annotations

import argparse
import json
from dataclasses import replace
from urllib.parse import urlsplit
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations, ImageContent, TextContent
from mcp.server.transport_security import TransportSecuritySettings

from .mcp_bridge import LiveWorkbookBridge, create_bridge_app
from .model import CellDefinition
from .narrowing import as_mapping, as_list
from .widget_config import STATIC_SETTINGS, WIDGET_SETTINGS
from .actions import ActionDefinition, validate_action_bindings


RENDERING_CAPABILITIES: dict[str, Any] = {
    'cellKinds': ['input', 'linked', 'formula', 'resource', 'effect', 'markdown'],
    'outputs': ['plain values', 'tables (pandas/list data)', 'PNG/JPEG/WebP/SVG images',
                'Matplotlib figures', 'interactive Plotly', 'sanitized HTML', 'sandboxed anywidget'],
    'richProtocol': 'Return an object providing _repr_svg_, _repr_png_, _repr_jpeg_, _repr_html_ or _repr_mimebundle_; or a supported figure. Returning raw SVG text or bytes alone does not select an image renderer.',
    'schemdraw': 'Use schemdraw.Drawing(show=False) with the SVG backend and return the Drawing object (_repr_svg_). Alternatively return html(drawing.get_imagedata("svg").decode("utf-8")); HTML is sanitized. Never call show() or open a GUI window.',
    'notes': {'liveValue': '{{ label }}', 'richOutput': 'A bare {{ drawing_label }} displays the rich cell output; use view.display=rendered for grid output.',
              'gridText': 'Markdown cells for labels/headings use view.page=false; Notes pages use true.',
              'latex': {'inline': '$x^2$', 'block': '$$\\int_0^1 x^2\\,dx$$', 'renderer': 'KaTeX'},
              'images': 'Upload raster images with add_image, then insert the returned ![alt](assets/...) Markdown. No base64 data in cell source.'},
    'layout': 'inspect_cell_layout returns fit.resizeNeeded, measured overflow, suggestedSpan and collision/grid-expansion checks. Estimates do not prove sandboxed/offscreen content fits.',
    'visual': 'inspect_visual returns an MCP PNG image for an explicit visible cell/note, or an available image/chart output preview. It never evaluates Python. Sandboxed iframe internals are omitted.',
}

GUIDE_URI = 'reaktiv-workbook://skills/workbook-authoring'


def authoring_guide() -> str:
    from importlib.resources import files
    return files('reaktiv_workbook').joinpath('skills', 'workbook-authoring', 'SKILL.md').read_text(encoding='utf-8')


def patch_cell_view(cell: CellDefinition, patch: dict[str, Any]) -> CellDefinition:
    """Merge presentation only; normal model/widget validators remain authoritative."""
    if set(patch) - {'display', 'span', 'page', 'markdown', 'widget'}:
        raise ValueError('View supports display, span, page, markdown and widget only.')
    if 'page' in patch and cell.kind != 'markdown':
        raise ValueError('view.page applies only to Markdown cells.')
    view = dict(cell.view or {})
    for key, value in patch.items():
        if value is None:
            view.pop(key, None)
        elif key == 'widget':
            widget = as_mapping(value)
            if widget is None or set(widget) - {'type', *WIDGET_SETTINGS, *STATIC_SETTINGS}:
                raise ValueError('Provide a widget object with a supported type and widget settings.')
            merged = dict(as_mapping(view.get('widget')) or {})
            if widget.get('type', merged.get('type')) != 'button':
                for field in ('buttonMode', 'action', 'actionArguments', 'cancelWhileRunning'):
                    merged.pop(field, None)
            for field, setting in widget.items():
                if setting is None:
                    merged.pop(field, None)
                else:
                    merged[field] = setting
            view[key] = merged
        else:
            view[key] = value
    return replace(cell, view=view)


def mcp_cell_definition(cell: dict[str, Any]) -> CellDefinition:
    if cell.get('kind') == 'markdown':
        view = as_mapping(cell.get('view'))
        if view is None or not isinstance(view.get('page'), bool):
            raise ValueError('Markdown cells require explicit view.page: false for grid labels/headings/text; true for a Notes page. Preserve other view settings.')
    return CellDefinition.from_dict(cell)


def network_host(value: str) -> str:
    """Normalize a listen/allowed host without admitting URLs, ports or wildcards."""
    candidate = value.strip()
    if not candidate or any(character in candidate for character in '/@?#*') or any(character.isspace() for character in candidate):
        raise ValueError('Use a hostname or IP address without a scheme, port, path or wildcard')
    if ':' in candidate and not candidate.startswith('['):
        from ipaddress import IPv6Address
        return str(IPv6Address(candidate))
    parsed = urlsplit('http://' + candidate)
    if not parsed.hostname or parsed.port is not None:
        raise ValueError('Use a hostname or IP address without a port')
    return parsed.hostname


def host_headers(host: str) -> list[str]:
    authority = f'[{host}]' if ':' in host else host
    return [authority, authority + ':*']


def mcp_origins(app_origin: str | None) -> list[str]:
    return ['http://127.0.0.1:*', 'http://localhost:*', 'http://[::1]:*', *([app_origin] if app_origin else [])]


def mcp_origin_allowed(origin: str, app_origin: str | None) -> bool:
    return any(origin == allowed or (allowed.endswith(':*') and origin.startswith(allowed[:-1]))
               for allowed in mcp_origins(app_origin))


def create_live_server(bridge: LiveWorkbookBridge, *, allowed_hosts: list[str], app_origin: str | None = None) -> FastMCP[None]:
    """Register the shared-workbook tools for the HTTP application's bridge."""
    # The SDK supports wildcard ports, but not wildcard hostnames. In explicit
    # any-host mode the outer HTTP app retains Origin checks and bearer auth.
    security = TransportSecuritySettings(enable_dns_rebinding_protection='*' not in allowed_hosts,
        allowed_hosts=allowed_hosts, allowed_origins=mcp_origins(app_origin))
    server = FastMCP[None]("Reaktiv Workbook — open workbooks", stateless_http=True, json_response=True,
        transport_security=security, instructions=(
        "Collaborate on workbooks already open and explicitly shared in Reaktiv Workbook. "
        "The app keeps its current Python kernel, documents and undo history. "
        "Before authoring, load get_authoring_guide (also available as the workbook-authoring skill resource/prompt). "
        "Use upsert_action to compile/install methods without invoking them; run_action is a separate intentional command. "
        "Fixed set_cell_colors, resize_worksheet and set_worksheet_layout do not run Python; reactive color expressions require a running kernel. "
        "Use move_cells and set_cell_label for atomic reference-aware changes; never emulate moves with delete/create. "
        "Use insert_rows_or_columns / delete_rows_or_columns to make room or remove lines: later cells shift and references follow. "
        "List shared workbooks, then use get_workbook_overview and inspect_cells for targeted reads. "
        "Inspect dependencies before editing and logs/diagnostics afterward; get_kernel_status answers during execution. "
        "Use observed vs source dependency modes accurately; partial/unobserved edges are not complete. "
        "Start/restart/interrupt only intentionally; restart and forced recovery can lose runtime state and rerun effects. "
        "Batch cell edits require that revision and reject cells with user drafts. "
        "Use manage_worksheet for sheet create/rename/delete; update_workbook_environment edits shared code/imports/package requirements. Package activation requires an explicit kernel restart. "
        "Use get_rendering_capabilities for images, Schemdraw and LaTeX; add_image stores durable raster assets; inspect_visual returns images. "
        "Use set_cell_view to patch widgets and presentation without replacing source. "
        "After configuring rendered output, inspect_cells.layout reports measured fit or explicit pending/unmeasured state; span/readability recommendations are estimates and must pass collision checks. "
        "Notes and grid Markdown support $inline$ and $$block$$ KaTeX LaTeX. "
        "Markdown grid labels/headings/text require view.page=false; Notes pages require view.page=true. "
        "Every Markdown definition in edit_cells must explicitly choose view.page. Use {{ label }} for live values. "
        "Edits recalculate immediately and remain unsaved until explicitly saved. "
        "Never retry an uncertain mutation automatically: read the workbook first. "
        "No shared workbooks means the user must enable Agent access in an open app window."
        " When the user refers to this note, this cell or what they are seeing, call get_user_context "
        "and use the returned explicit cell/note IDs. Window focus may be elsewhere while the user "
        "talks to an agent: lastFocusedAt identifies recent app focus. If the target is ambiguous, ask."
    ))

    @server.resource(GUIDE_URI, name='workbook-authoring/SKILL.md', mime_type='text/markdown',
                     description='Concepts and workflow for collaborating on live Reaktiv Workbook workbooks.')
    def workbook_authoring_resource() -> str:
        return authoring_guide()

    @server.prompt(name='workbook_authoring', description='Learn Reaktiv Workbook concepts before authoring cells, notes or actions.')
    def workbook_authoring_prompt() -> str:
        return authoring_guide()

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    def get_authoring_guide() -> str:
        """Read the bundled workbook-authoring SKILL.md: reactive concepts, cell and note
        syntax, actions, argument bindings, colors, worksheet sizing and safe live-edit
        workflow. Same content as the MCP resource and workbook_authoring prompt.
        Use this before authoring; no app connection or running kernel is needed.
        """
        return authoring_guide()

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    def get_rendering_capabilities() -> dict[str, Any]:
        """Discover what cells/notes can render: images, Schemdraw SVG, plots, tables,
        HTML, widgets and inline/block LaTeX. Also explains image assets and fit checks.
        No workbook or Python execution is needed. Read before choosing a renderer.
        """
        return RENDERING_CAPABILITIES

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_workbook_environment(workbook: str) -> dict[str, Any]:
        """Read full shared Python code, import statements, package requirements and
        package activation status. Does not expose environment-variable values or run code.
        """
        return await bridge.request_async(workbook, 'environment', {'read': True})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def update_workbook_environment(workbook: str, revision: str, shared_code: str | None = None,
                                          imports: list[str] | None = None, packages: list[str] | None = None) -> dict[str, Any]:
        """Replace the supplied environment fields only; read existing settings first.
        shared_code/imports are applied to the current kernel and recalculate cells;
        they may execute Python and effects. Empty strings/lists clear that field.
        Packages update saved requirements ONLY: explicitly call control_kernel restart
        to install/activate them. Remote/embedded hosts manage their own installations.
        Rejects user drafts, stale revisions and an open settings editor. One undo step;
        does not save. Read after errors before retrying a potentially executed update.
        """
        payload: dict[str, Any] = {'revision': revision}
        if shared_code is not None:
            payload['code'] = shared_code
        if imports is not None:
            payload['imports'] = imports
        if packages is not None:
            payload['packages'] = packages
        if len(payload) == 1:
            raise ValueError('Provide shared_code, imports or packages')
        return await bridge.request_async(workbook, 'environment', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def manage_worksheet(workbook: str, revision: str, action: Literal['create', 'update', 'delete'], name: str,
                               new_name: str | None = None, columns: int | None = None, rows: int | None = None,
                               allow_broken_references: bool = False) -> dict[str, Any]:
        """Create a named worksheet, update its name/grid, or delete it through the app.
        Uses explicit worksheet names from overview; names must be Python identifiers.
        Renaming updates cell/widget/note/action references through existing app paths.
        Grid shrinking preserves occupied cells/spans. Deletion removes its cells;
        referenced sheets require explicit allow_broken_references=true. The first
        worksheet is protected (reorder sheets in the app first). Rejects user drafts,
        stale revisions/busy kernels. Recalculates without restart; one undo step, unsaved.
        """
        payload: dict[str, Any] = {'revision':revision, 'action':action, 'name':name,
                                   'allowBrokenReferences':allow_broken_references}
        if new_name is not None:
            payload['newName'] = new_name
        if columns is not None:
            payload['columns'] = columns
        if rows is not None:
            payload['rows'] = rows
        return await bridge.request_async(workbook, 'worksheets', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False))
    async def add_image(workbook: str, revision: str, mime_type: Literal['image/png', 'image/jpeg', 'image/webp', 'image/gif'], data_base64: str) -> dict[str, Any]:
        """Upload a raster image (up to 5 MB) into the workbook's existing asset store.
        Returns a durable assets/<hash> reference and Markdown snippet; does not insert
        a cell or save. Then use edit_cells to put ![alt](assets/...) into a note/grid
        Markdown cell. SVG uploads are refused; computed SVG outputs remain supported.
        The app decodes, bounds/shrinks and deduplicates the image as for pasted images.
        Embedded script sessions do not synchronize assets yet and reject uploads;
        use a computed image/SVG output there.
        """
        import base64
        if len(data_base64) > 7 * 1024 * 1024:
            raise ValueError('Image exceeds 5 MB')
        decoded = base64.b64decode(data_base64, validate=True)
        if not decoded or len(decoded) > 5 * 1024 * 1024:
            raise ValueError('Provide an image up to 5 MB')
        return await bridge.request_async(workbook, 'asset', {'revision':revision, 'mimeType':mime_type, 'dataBase64':data_base64})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def inspect_cell_layout(workbook: str, cell_ids: list[str]) -> dict[str, Any]:
        """Check if rendered/widget cells need resizing. Returns fit.resizeNeeded,
        current dimensions, measured/pending/unmeasured states, suggested spans,
        collision checks and required grid expansion. No evaluation/scroll/navigation.
        After resizing inspect again; sandboxed internals cannot be measured.
        """
        result = await bridge.request_async(workbook, 'inspect', {'cellIds':cell_ids})
        return {key:result[key] for key in ('revision','sampledAt','layout','draftedCells') if key in result}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True), structured_output=False)
    async def inspect_visual(workbook: str, cell_id: str, pane: int | None = None) -> list[ImageContent | TextContent]:
        """See a targeted cell or visible note as an MCP PNG image, with capture metadata.
        A hidden cell can supply an image/chart output preview; that does not prove grid
        fit. Use inspect_cell_layout too. Sandboxed iframe/anywidget internals are omitted;
        cross-origin/WebGL rendering may be limited. Does not run cells, scroll, change
        selection, or capture the surrounding app. Requires a vision-capable client.
        """
        payload: dict[str, Any] = {'cellId':cell_id}
        if pane is not None:
            payload['pane'] = pane
        result = await bridge.request_async(workbook, 'visual', payload)
        data = result.pop('dataBase64', None)
        if result.get('mimeType') != 'image/png' or not isinstance(data, str) or not data or len(data) > 7 * 1024 * 1024:
            raise ValueError('The app did not return a bounded PNG capture')
        return [TextContent(type='text',text=json.dumps(result)), ImageContent(type='image',mimeType='image/png',data=data)]

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def list_workbooks() -> dict[str, Any]:
        """List currently shared app workbooks. Handles expire on disconnect or document replacement."""
        return bridge.list_workbooks()

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_user_context(workbook: str | None = None) -> dict[str, Any]:
        """Identify what the user is viewing: worksheet/note panes, selection, inspector,
        editor and window focus. Without a handle, return heartbeat context for all shared
        windows (up to one poll old). With a handle, read fresh context from that window.
        No cell code runs. Use explicit returned IDs for questions/edits; do not guess if ambiguous.
        """
        return bridge.list_workbooks() if workbook is None else await bridge.request_async(workbook, 'context', {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def read_workbook(workbook: str) -> dict[str, Any]:
        """Read the live document, results, draft cell IDs and revision through the app queue.
        Does not evaluate cells or restart Python. Rich binary payloads are omitted.
        """
        return await bridge.request_async(workbook, "read", {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_workbook_overview(workbook: str) -> dict[str, Any]:
        """Start here for a compact inventory: worksheets, cell IDs/names/kinds, notes,
        exposed actions, packages, current problems, drafts, context and revision.
        Environment values and binary outputs are omitted. Inventory is capped at 200;
        read_workbook returns the complete document when inventoryTruncated is true.
        Passive; results refer to the latest settled snapshot, even while Python runs.
        """
        return await bridge.request_async(workbook, 'overview', {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def inspect_cells(workbook: str, cell_ids: list[str]) -> dict[str, Any]:
        """Read 1–100 explicit cell IDs: complete editable definitions, current value/display,
        errors and traceback locations, resource status, timings, callable signatures,
        table shape and rich-output MIME type. No evaluation or binary payloads.
        Use worksheet-qualified IDs exactly as returned by the inventory.
        layout includes stored/displayed spans, grid pixel sizes, pane/zoom-specific
        measurements, overflow/clipping and estimated readable minimums/suggested spans.
        Hidden cells are unmeasured; asynchronous UI updates can be render-pending.
        Suggestions report collision/grid-expansion constraints; never auto-resize.
        """
        return await bridge.request_async(workbook, 'inspect', {'cellIds': cell_ids})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_dependencies(workbook: str, cell_ids: list[str],
                               direction: Literal['upstream', 'downstream', 'both'] = 'both',
                               mode: Literal['observed', 'source', 'widget'] = 'observed',
                               depth: int = 1) -> dict[str, Any]:
        """Explain what cells read and what an edit may affect. Roots: 1–100 explicit IDs;
        depth: 1–10; bounded to 1000 nodes/5000 edges with truncation reported.
        Each edge is consumer -> dependency. observed means reads in the latest run
        (check partial/unobserved flags); source means static authoring references;
        widget means bindings, not normal value dependencies. Never evaluates Python.
        """
        return await bridge.request_async(workbook, 'dependencies', {
            'cellIds': cell_ids, 'direction': direction, 'mode': mode, 'depth': depth})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_logs(workbook: str, cell_ids: list[str] | None = None,
                       level: Literal['all', 'info', 'warning', 'error', 'system'] = 'all',
                       search: str = '', since: str | None = None, limit: int = 100) -> dict[str, Any]:
        """Query retained app/kernel logs, stdout, stderr and error tracebacks, newest first.
        Optional cell IDs, level, text search and exclusive timestamp cutoff; limit 1–500.
        Logs are a bounded window, not durable history. Debug timings/update traces are
        available through get_diagnostics when recording was enabled in the app.
        Responds while Python is busy; does not start a kernel or clear logs.
        """
        payload: dict[str, Any] = {'level': level, 'search': search, 'limit': limit}
        if cell_ids is not None:
            payload['cellIds'] = cell_ids
        if since is not None:
            payload['since'] = since
        return await bridge.request_async(workbook, 'logs', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_diagnostics(workbook: str) -> dict[str, Any]:
        """Read current root-cause problems and affected cells, latest timings, recorded
        update trace, existing type findings and passive performance/debug metadata.
        Trace/performance recording is opt-in; absent data is explicitly reported.
        Never runs a type check, enables recording, evaluates cells or samples memory.
        Findings/results may describe the last settled update while execution is busy.
        """
        return await bridge.request_async(workbook, 'diagnostics', {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def get_kernel_status(workbook: str) -> dict[str, Any]:
        """Read kernel kind/status, error, current/pending/stopped cells, cached resource
        usage, available controls and current revision. Responsive during a running
        cell; does not start Python or poll/sample resource usage.
        """
        return await bridge.request_async(workbook, 'kernel-status', {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def control_kernel(workbook: str, action: Literal['start', 'restart', 'interrupt'],
                             revision: str | None = None, force: bool = False) -> dict[str, Any]:
        """Explicit kernel control using existing app actions. start/restart require the
        revision from status/overview, no user drafts and an idle kernel. Restart loses
        Python memory and reruns cells/effects; use only when needed/requested.
        interrupt stays responsive while Python runs; force=True is explicit recovery
        for local/Pyodide kernels and also requires a revision/no drafts. Pyodide
        interruption itself requires restart. A stopped cell remains held as in the UI.
        Embedded kernels are owned by their script; remote kernels cannot be force
        restarted. No kernel environment replacement, shutdown or automatic retries.
        """
        payload: dict[str, Any] = {'action': action, 'force': force}
        if revision is not None:
            payload['revision'] = revision
        return await bridge.request_async(workbook, 'kernel-control', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def edit_cells(workbook: str, revision: str, cells: list[dict[str, Any]],
                         delete: list[str] | None = None) -> dict[str, Any]:
        """Batch create/replace complete cell definitions and delete IDs in the open workbook.
        Each cell requires id, kind, source; optional name, color (#RRGGBB), view, annotation, enabled,
        trigger, equal, params and computation use the normal workbook format. Preserve
        existing settings when replacing. Every Markdown cell MUST include view.page:
        false for worksheet labels/headings/text; true only for an intentional Notes page.
        Use view.display='rendered' to show grid Markdown. One batch is one
        agent-labelled undo step. Rejects stale revisions and user drafts; recalculates
        on the existing kernel without restarting it. Does not save.
        """
        definitions = [mcp_cell_definition(cell).to_dict() for cell in cells]
        return await bridge.request_async(workbook, "edit", {
            "revision": revision, "cells": definitions, "delete": delete or []})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def save_workbook(workbook: str, revision: str) -> dict[str, Any]:
        """Save a workbook opened with reaktiv-workbook edit through its existing app save flow.
        Requires the current revision. New files and browser downloads must be saved
        by the user in the app. Saving never starts or restarts a kernel.
        """
        return await bridge.request_async(workbook, "save", {"revision": revision})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True))
    async def list_actions(workbook: str) -> dict[str, Any]:
        """Inspect full action definitions/source, labels, references, saved bindings,
        parameter signatures, results/errors, live running/applying status and user
        action drafts. Does not execute actions. Binary output is omitted.
        """
        return await bridge.request_async(workbook, 'actions', {})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def upsert_action(workbook: str, revision: str, definition: dict[str, Any]) -> dict[str, Any]:
        """Create or replace ONE complete action definition (name, source; optional label,
        references, bindings, exposed). Source is a complete def/async def with self,
        without @action; name must match. Actions belong to the workbook: read cells
        with self.Sheet.member(), write with self.Sheet.member.set(value). Use
        inspect_cells modelReference paths. Inspect list_actions and preserve settings
        when editing. Statically validates, then uses the app's confirmed direct action
        update. One labelled undo step; does NOT invoke, restart Python or save.
        Rejects stale revisions, busy kernels and unapplied user action drafts.
        """
        action = ActionDefinition.from_dict(definition)
        return await bridge.request_async(workbook, 'action-edit', {'revision': revision, 'definition': action.to_dict()})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def run_action(workbook: str, revision: str, name: str,
                         arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        """Intentionally invoke an exposed action on the current kernel. Requires current
        revision and no unapplied cell/action drafts. Different actions may run
        concurrently; a duplicate invocation of a running action is refused. Users own guards coordinating different actions. Arguments are
        parameter bindings: {amount:{value:3}}, {amount:{cell:'A1'}}, or
        {amount:{default:true}}. Omitted choices use saved bindings/Python defaults.
        Actions can change inputs and perform external effects; Undo cannot undo
        those external effects. Never retry an uncertain execution automatically;
        inspect list_actions/logs. Use cancel_action for cooperative async cancellation.
        """
        bindings = validate_action_bindings(arguments if arguments is not None else {})
        return await bridge.request_async(workbook, 'action-run', {'revision': revision, 'name': name, 'arguments': bindings})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def cancel_action(workbook: str, name: str, run_id: str | None = None) -> dict[str, Any]:
        """Request cooperative cancellation of an exposed async action. Responsive while
        execution is busy. Provide run_id from list_actions to cancel only that invocation;
        omit it to cancel the current run of this action. Does not roll back completed writes or external effects;
        inspect action status/logs afterward. Use kernel interrupt for blocked code.
        """
        return await bridge.request_async(workbook, 'action-cancel', {'name': name, **({'runId': run_id} if run_id else {})})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def set_cell_view(workbook: str, revision: str, cell_id: str, view: dict[str, Any]) -> dict[str, Any]:
        """Patch an existing cell's view, preserving source/name/color and unmentioned settings.
        Supports display ('value'/'rendered'), span [columns,rows], markdown, page, widget.
        Widget example: {"display":"rendered","widget":{"type":"range","min":0,"max":100,"step":1}}.
        Types: checkbox, number, range, select, radio, text, textarea, date, list,
        multiselect, button, file, folder. Widget fields merge; null removes a setting,
        widget:null restores automatic widget selection. Action buttons never run here.
        Markdown grid labels/headings/text use {"page":false,"display":"rendered"};
        page:true makes an intentional Notes page. Explicit user choice, no inference.
        Requires current revision, running kernel and no conflicting cell draft.
        Uses the normal edit path: one undo step, existing kernel/values preserved,
        may recompute widget configuration; does not save. Span overlaps are rejected.
        Returns best-effort layout feedback after editing. render-pending means inspect
        again after the UI draws; suggestions are readability estimates, not guaranteed
        fit. A layout sampling failure never retries the already-applied mutation.
        """
        state = await bridge.request_async(workbook, 'inspect', {'cellIds': [cell_id]})
        if state.get('revision') != revision:
            raise ValueError('Workbook conflict: inspect current cells and reconcile before setting view.')
        definitions = as_list(state.get('cells'))
        definition = as_mapping(definitions[0]) if definitions and len(definitions) == 1 else None
        if definition is None or definition.get('id') != cell_id:
            raise ValueError('Use an existing explicit cell ID from the workbook inventory.')
        updated = patch_cell_view(CellDefinition.from_dict(definition), view)
        result = await bridge.request_async(workbook, 'edit', {'revision': revision, 'cells': [updated.to_dict()], 'delete': []})
        try:
            sampled = await bridge.request_async(workbook, 'inspect', {'cellIds': [cell_id]})
            return {**result, 'layout': sampled.get('layout', []), 'layoutRevision': sampled.get('revision'),
                    'layoutStatus': 'sampled' if sampled.get('layout') else 'unavailable'}
        except Exception:
            return {**result, 'layout': [], 'layoutStatus': 'unavailable',
                    'layoutMessage': 'Edit applied; layout sampling failed. Inspect again; do not retry the edit automatically.'}

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def set_cell_colors(workbook: str, revision: str, cell_ids: list[str], color: str = "", expression: str | None = None) -> dict[str, Any]:
        """Set background color on 1–100 existing explicit cell IDs as one undoable batch.
        color is #RRGGBB (also the fallback) or empty string to clear. Optional expression
        is Python returning #RRGGBB, None or ''. It supports local/cross-sheet cells
        and signal calls, e.g. "'#ffcccc' if temperature > 80 else '#ccffcc'".
        Expressions require a running kernel and no user drafts; fixed colors do not.
        Omitting expression removes an existing expression. Results expose color,
        colorError and colorDependencies. New definitions use view.color={"expr": code}.
        Preserves cell source and widget settings; undoable, does not save.
        """
        payload: dict[str, Any] = {'revision': revision, 'cellIds': cell_ids, 'color': color}
        if expression is not None:
            payload['expression'] = expression
        return await bridge.request_async(workbook, 'colors', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def resize_worksheet(workbook: str, revision: str, worksheet: str, columns: int, rows: int) -> dict[str, Any]:
        """Set visible worksheet grid extent, using the exact worksheet name from overview.
        Dimensions 1–1000 each, at most 100000 requested slots. Adds visible columns/rows
        or shrinks unused space; never inserts/deletes/moves cells or shifts references.
        Clamps shrink to occupied cells/spans/drafts and returns actual dimensions.
        Preserves hidden size settings, other sheets and current navigation. One labelled
        undo step; current revision required, no running kernel/evaluation/save needed.
        """
        return await bridge.request_async(workbook, 'resize', {'revision': revision, 'worksheet': worksheet, 'columns': columns, 'rows': rows})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False))
    async def insert_rows_or_columns(workbook: str, revision: str, worksheet: str, axis: Literal['row', 'column'],
                                     before: int | str, count: int = 1) -> dict[str, Any]:
        """Insert empty rows or columns, like a spreadsheet: `before` is a row number (axis
        row) or a column letter/number (axis column); count 1–100. Cells from there on move by
        count with their references, inputs keep values, row heights/column widths shift,
        tiles crossing the insertion grow. Needs a running kernel and no user drafts. One
        undo step; recalculates; unsaved. Returns the workbook and the sheet's dimensions.
        """
        return await bridge.request_async(workbook, 'grid-lines', {'revision': revision, 'worksheet': worksheet,
            'axis': axis, 'change': 'insert', 'index': before, 'count': count})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def delete_rows_or_columns(workbook: str, revision: str, worksheet: str, axis: Literal['row', 'column'],
                                     start: int | str, count: int = 1,
                                     allow_broken_references: bool = False) -> dict[str, Any]:
        """Delete rows or columns and their cells, like a spreadsheet: `start` is a row number
        or column letter/number; count 1–100. Later cells move back with their references;
        tiles crossing the deleted lines shrink. Refused while other cells or actions read the
        deleted cells, unless allow_broken_references=true: their coordinate references then
        become deleted_<A1> names that fail clearly. One undo step; recalculates; unsaved.
        """
        return await bridge.request_async(workbook, 'grid-lines', {'revision': revision, 'worksheet': worksheet,
            'axis': axis, 'change': 'delete', 'index': start, 'count': count,
            'allowBrokenReferences': allow_broken_references})

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def set_worksheet_layout(workbook: str, revision: str, worksheet: str,
                                   row_heights: dict[str, int | None] | None = None,
                                   column_widths: dict[str, int | None] | None = None) -> dict[str, Any]:
        """Patch row heights (keys "1", "2": 28–240 px) and column widths
        (keys "A", "B": 64–480 px). CSS pixels before zoom; null resets a track.
        Track keys must exist in the visible grid. Preserves cells, spans, references,
        other tracks and navigation. Affects all cells sharing the tracks. One undo
        step, works with kernel stopped, no Python evaluation/save. Prefer this for
        clipped widgets in densely populated grids; inspect_cell_layout again after.
        """
        payload: dict[str, Any] = {'revision': revision, 'worksheet': worksheet}
        if row_heights is not None:
            payload['rowHeights'] = row_heights
        if column_widths is not None:
            payload['columnWidths'] = column_widths
        return await bridge.request_async(workbook, 'tracks', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def move_cells(workbook: str, revision: str, cell_id: str, target_id: str,
                         cell_ids: list[str] | None = None) -> dict[str, Any]:
        """Atomically move a cell or group, translating from cell_id to target_id.
        Explicit IDs, empty destinations; cell_ids must include cell_id. Uses the
        existing live move transaction: preserves input objects, rewrites formulas,
        notes, action references/handles and widget argument bindings together.
        Refuses overlap, stale revision and open drafts. One undo; requires running
        kernel. Never emulate a move using separate action edits/delete/create.
        """
        payload: dict[str, Any] = {'revision': revision, 'cellId': cell_id, 'targetId': target_id}
        if cell_ids is not None:
            payload['cellIds'] = cell_ids
        return await bridge.request_async(workbook, 'move', payload)

    @server.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False))
    async def set_cell_label(workbook: str, revision: str, cell_id: str, label: str) -> dict[str, Any]:
        """Assign/rename a label, or remove with empty string. Atomically refactors
        coordinate/old-label reads, Markdown expressions, widget expressions and
        action handles/member references. Coordinates remain valid. Refuses label
        collisions, shadowed destinations and open drafts. One undo, no auto-save.
        Use instead of changing an existing name through edit_cells.
        """
        return await bridge.request_async(workbook, 'label', {'revision': revision, 'cellId': cell_id, 'label': label})

    return server


def create_live_http_app(token: str, app_origin: str | None = None, *, host: str = '127.0.0.1', allowed_hosts: list[str] | None = None):
    """One authenticated listener for the app bridge and remote MCP clients."""
    import hmac
    from fastapi import FastAPI, Request, Response
    from fastapi.responses import JSONResponse
    from starlette.middleware.base import RequestResponseEndpoint

    bridge = LiveWorkbookBridge()
    host = network_host(host)
    hosts = ['127.0.0.1', 'localhost', '::1']
    if host not in ('0.0.0.0', '::'):
        hosts.append(host)
    additional_hosts = ['*' if value.strip() == '*' else network_host(value) for value in (allowed_hosts or [])]
    if any(value in ('0.0.0.0', '::') for value in additional_hosts):
        raise ValueError('Allowed hosts must be reachable hostnames/IPs, not wildcard listen addresses')
    if host in ('0.0.0.0', '::') and not additional_hosts:
        raise ValueError('When listening on all interfaces, specify --allowed-host with the reachable IP or hostname')
    hosts.extend(additional_hosts)
    server = create_live_server(bridge, allowed_hosts=[header for name in hosts for header in (['*'] if name == '*' else host_headers(name))], app_origin=app_origin)
    app = create_bridge_app(bridge, token, app_origin)
    app.mount("/", server.streamable_http_app())

    @app.middleware("http")
    async def authenticate_mcp(request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Mounted ASGI apps do not inherit FastAPI route dependencies.
        if request.url.path.startswith("/mcp") and request.method != "OPTIONS":
            supplied = request.headers.get("authorization", "")
            if not hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode()):
                return JSONResponse({"detail": "Missing or invalid agent pairing token"},
                                    status_code=401, headers={"WWW-Authenticate": "Bearer"})
            # Disabling the SDK's combined Host/Origin check for '*' must not
            # also allow arbitrary browser origins. CORS remains unchanged.
            origin = request.headers.get('origin')
            if '*' in additional_hosts and origin and not mcp_origin_allowed(origin, app_origin):
                return JSONResponse({'detail': 'Invalid Origin header'}, status_code=403)
        return await call_next(request)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        del app
        try:
            async with server.session_manager.run():
                yield None
        finally:
            bridge.close()

    app.router.lifespan_context = lifespan
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Authenticated HTTP MCP server for shared Reaktiv Workbook workbooks")
    parser.add_argument("--host", default='127.0.0.1', help="Listen address (default: 127.0.0.1); use a network IP or 0.0.0.0 for remote access")
    parser.add_argument("--allowed-host", action='append', default=[], help="Additional reachable hostname/IP accepted by MCP, or '*' to accept any server host; required with 0.0.0.0 or ::")
    parser.add_argument("--port", type=int, default=8766, help="HTTP port (default: 8766)")
    parser.add_argument("--app-origin", help="Also allow this browser app origin, e.g. https://sheets.example.com")
    args = parser.parse_args()
    from .agent_bridge import pairing_token, token_path
    try:
        # The same token as `reaktiv-workbook edit --mcp`, so agents are configured once.
        token, created = pairing_token()
    except (OSError, RuntimeError) as error:
        parser.error(str(error))
    if created:
        print(f"Created the MCP pairing token in {token_path()}:\n  Authorization: Bearer {token}", flush=True)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    import uvicorn
    try:
        host = network_host(args.host)
        app = create_live_http_app(token, args.app_origin, host=host, allowed_hosts=args.allowed_host)
    except ValueError as error:
        parser.error(str(error))
    uvicorn.run(app, host=host, port=args.port, access_log=False)


if __name__ == "__main__":
    main()
