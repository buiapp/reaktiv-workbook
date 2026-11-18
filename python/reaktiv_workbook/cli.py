"""Command-line consumer of the reactive spreadsheet API."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import mimetypes
import os
import re
import shutil
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Mapping, Optional, Sequence

from .model import CellDefinition, SheetDocument, make_snapshot
from .narrowing import as_mapping
from .sheets import ReferenceScope, qualify, sheet_prefixes, split_cell_id
from .typecheck import MODES, check_document
from .workbook import ReactiveWorkbook, WorkbookSnapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reaktiv-workbook",
        description="Evaluate a Reaktiv Workbook Python workbook.",
    )
    parser.add_argument("file", type=Path, help="Path to a workbook (.workbook.py, or .sheet.py from before the rename)")
    parser.add_argument(
        "--set",
        dest="overrides",
        metavar="CELL=VALUE",
        action="append",
        default=[],
        help="Override an input cell before evaluation; repeatable",
    )
    parser.add_argument(
        "--json", action="store_true", help="Print the full result as JSON"
    )
    parser.add_argument(
        "--save", type=Path, help="Save overrides to this workbook file"
    )
    parser.add_argument(
        "--cell",
        dest="cells",
        metavar="CELL",
        action="append",
        default=[],
        help="Only print these cells (id or name); repeatable",
    )
    parser.add_argument(
        "--note",
        dest="notes",
        metavar="CELL",
        action="append",
        default=[],
        help="Print a Markdown cell as self-contained Markdown; repeatable",
    )
    parser.add_argument(
        "--export",
        type=Path,
        metavar="DIR",
        help="Write plots, artifacts, and notes (as .md) into DIR",
    )
    parser.add_argument(
        "--no-snapshot",
        action="store_true",
        help="With --save, do not store the evaluated outputs snapshot in the file",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit with status 1 when any cell has an error",
    )
    parser.add_argument(
        "--types",
        nargs="?",
        const="standard",
        choices=MODES,
        help="Type-check the workbook with pyright instead of running it (standard or strict); "
        "exit 1 on type errors, 2 when pyright is not available",
    )
    parser.add_argument(
        "--watch",
        nargs="?",
        type=int,
        const=0,
        default=None,
        metavar="TICKS",
        help=(
            "Keep running and fire clock cells (every/at) when they are due, printing "
            "what changed; stop with Ctrl+C or after TICKS ticks"
        ),
    )
    parser.add_argument(
        "--requirements",
        action="store_true",
        help="Print document package requirements and exit",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Evaluate only. Generated workbooks call this; it never launches a server."""
    try:
        return _main(argv)
    except BrokenPipeError:
        # Output was piped into a reader that stopped early (e.g. ``| head``).
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return 0


def command_main(argv: Optional[Sequence[str]] = None) -> int:
    """Console entry point; workbook scripts deliberately keep using ``main``."""
    from .commands import command_main as dispatch

    return dispatch(argv)


def _main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    document = SheetDocument.load(args.file)
    if args.requirements:
        print("\n".join(document.packages))
        return 0
    if args.types:
        return _report_types(document, args.types)
    cells = {cell.id: cell for cell in document.cells}
    aliases = {qualify(split_cell_id(cell.id)[0], cell.name): cell.id for cell in document.cells if cell.name}
    scope = ReferenceScope(aliases, "", sheet_prefixes(document.sheet_name, tuple(tab.name for tab in document.sheets)))

    def resolve(reference: str) -> str:
        namespace, dot, attribute = reference.partition(".")
        return (scope.qualified(namespace, attribute) if dot else scope.coordinate(reference) or scope.label(reference)) or reference

    for override in args.overrides:
        if "=" not in override:
            raise SystemExit(f"Invalid --set {override!r}; expected CELL=VALUE")
        reference, source = override.split("=", 1)
        cell_id = resolve(reference.strip())
        existing = cells.get(cell_id)
        if existing is not None and existing.kind not in ("input", "linked"):
            raise SystemExit(f"Cannot override non-input cell {cell_id}")
        cells[cell_id] = (
            replace(existing, **({"override": source} if existing.kind == "linked" else {"source": source}))
            if existing is not None
            else CellDefinition(cell_id, "input", source)
        )

    # Copy the document (sheets, kernel, snapshot, ...) and only replace its cells.
    updated = replace(document, cells=tuple(cells.values()))
    workbook = ReactiveWorkbook()
    # One event loop for the whole run: --watch keeps reloading resources on it.
    loop = asyncio.new_event_loop()
    try:
        return _run(args, loop, workbook, updated, resolve)
    finally:
        workbook.close()
        loop.close()


def _run(
    args: argparse.Namespace,
    loop: asyncio.AbstractEventLoop,
    workbook: ReactiveWorkbook,
    updated: SheetDocument,
    resolve: Callable[[str], str],
) -> int:
    snapshot = loop.run_until_complete(workbook.load_document_async(updated))

    if args.save is not None:
        # Saving refreshes the output snapshot, so the file opens with current values.
        snapshot_payload = None
        if not args.no_snapshot and workbook.document.save_outputs:
            snapshot_payload = make_snapshot(snapshot.cells, snapshot.dependencies, widget_dependencies=snapshot.widget_dependencies, source_dependencies=snapshot.source_dependencies, dependency_states=snapshot.dependency_states)
        replace(workbook.document, snapshot=snapshot_payload).save(args.save)
    selected = {resolve(reference) for reference in args.cells}
    results = [
        cell for cell in snapshot.cells if not selected or cell["id"] in selected
    ]
    if args.json:
        payload = snapshot.to_dict()
        payload["cells"] = results
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    elif args.notes:
        for reference in args.notes:
            print(workbook.render_note(resolve(reference)))
    else:
        effects = {effect["id"]: effect for effect in snapshot.effects}
        for cell in results:
            display = cell["display"]
            if cell["error"]:
                display = f"#ERROR {cell['error']}"
            print(f"{cell['id']}\t{display}")
            effect = effects.get(cell["id"])
            if effect and effect["output"]:
                print(f"  output\t{effect['output']}")
    if args.export is not None:
        _export(workbook, updated, snapshot.cells, args.export, Path(args.file).parent)
    failed = [{**cell, "error": cell["error"] or (f"Widget settings: {cell['widgetError']}" if cell.get("widgetError") else f"Cell color: {cell.get('colorError')}")} for cell in results if cell["error"] or cell.get("widgetError") or cell.get("colorError")]
    if args.check and failed:
        _report_errors(failed)
        return 1
    if args.watch is not None:
        try:
            return loop.run_until_complete(
                _watch(workbook, snapshot, selected, args.watch, args.json, args.check)
            )
        except KeyboardInterrupt:
            return 0
    return 0


async def _watch(
    workbook: ReactiveWorkbook,
    snapshot: WorkbookSnapshot,
    selected: set[str],
    limit: int,
    as_json: bool,
    check: bool,
) -> int:
    """Fire clock cells when due and print the cells whose value changed."""

    if not snapshot.timers:
        print("watch\tno clock cells (every/at) in this workbook", file=sys.stderr)
        return 0
    ticks = 0
    while snapshot.timers and (limit <= 0 or ticks < limit):
        due = snapshot.timers[0]
        print(f"watch\tnext {due['cellId']} ({due['label']}) at {due['nextAt']}", file=sys.stderr)
        await asyncio.sleep(due["nextInSeconds"])
        before = {cell["id"]: (cell["display"], cell["error"]) for cell in snapshot.cells}
        runs = {effect["id"]: effect["triggerCount"] for effect in snapshot.effects}
        snapshot = await workbook.tick_timer_async(due["cellId"])
        ticks += 1
        changed = [
            cell
            for cell in snapshot.cells
            if (not selected or cell["id"] in selected)
            and before.get(cell["id"]) != (cell["display"], cell["error"])
        ]
        ran = [
            effect
            for effect in snapshot.effects
            if (not selected or effect["id"] in selected)
            and effect["triggerCount"] != runs.get(effect["id"])
        ]
        at = next(
            (timer["lastAt"] for timer in snapshot.timers if timer["cellId"] == due["cellId"]),
            due["nextAt"],
        )
        if as_json:
            payload = {"tick": due["cellId"], "at": at, "cells": changed, "effects": ran}
            print(json.dumps(payload, ensure_ascii=False), flush=True)
        else:
            print(f"tick\t{due['cellId']}\t{at}")
            for cell in changed:
                display = f"#ERROR {cell['error']}" if cell["error"] else cell["display"]
                print(f"{cell['id']}\t{display}")
            for effect in ran:
                if effect["output"]:
                    print(f"{effect['id']}\toutput\t{effect['output']}")
            sys.stdout.flush()
        failed = [cell for cell in changed if cell["error"]]
        if check and failed:
            _report_errors(failed)
            return 1
    return 0


def _report_types(document: SheetDocument, mode: str) -> int:
    """``type<TAB>cell<TAB>line<TAB>severity<TAB>message`` per finding."""
    result = check_document(document, mode)
    if not result["available"]:
        print(f"types unavailable\t{result.get('reason', '')}", file=sys.stderr)
        return 2
    names = {cell.id: cell.name for cell in document.cells}
    for item in result["diagnostics"]:
        cell_id = item["cellId"]
        where = f"{names.get(cell_id) or cell_id}" if cell_id else "shared code"
        print(f"type\t{where}\t{item['line'] or ''}\t{item['severity']}\t{item['message']}")
    errors = sum(1 for item in result["diagnostics"] if item["severity"] == "error")
    print(f"{errors} type error(s), {len(result['diagnostics']) - errors} warning(s)", file=sys.stderr)
    return 1 if errors else 0


def _report_errors(failed: Sequence[Mapping[str, Any]]) -> None:
    """One line per failed cell on stderr, then where it failed: the traceback (cell
    line, shared code, library frames) or the cell that caused it."""

    for cell in failed:
        print(f"error\t{cell['id']}\t{cell['error']}", file=sys.stderr)
        detail = as_mapping(cell.get("errorDetail")) or {}
        traceback = detail.get("traceback")
        if detail.get("origin"):
            print(f"  caused by {detail['origin']}", file=sys.stderr)
        elif isinstance(traceback, str):
            for line in traceback.splitlines()[1:-1]:
                print(f"  {line}", file=sys.stderr)


def _export(
    workbook: ReactiveWorkbook,
    document: SheetDocument,
    cells: Sequence[Mapping[str, Any]],
    directory: Path,
    workbook_dir: Optional[Path] = None,
) -> None:
    """Write each plot/artifact to a file and each note as linked Markdown. Images the notes
    use from the workbook's ``assets/`` folder are copied along, so the links keep working."""

    directory.mkdir(parents=True, exist_ok=True)
    names = {cell.id: cell.name or cell.id for cell in document.cells}
    files: dict[str, str] = {}
    for cell in cells:
        payload = as_mapping(cell.get("richOutput") or cell.get("artifact"))
        if payload is None:
            continue
        if cell.get("artifact"):
            filename = f"{cell['id']}-{Path(payload['filename']).name}"
        else:
            extension = mimetypes.guess_extension(payload["mimeType"]) or ".bin"
            filename = f"{cell['id']}-{names[cell['id']]}{extension}"
        (directory / filename).write_bytes(base64.b64decode(payload["dataBase64"]))
        files[cell["id"]] = filename
        print(f"exported\t{cell['id']}\t{directory / filename}", file=sys.stderr)
    notes = {
        key: f"{definition.id}-{names[definition.id]}.md"
        for definition in document.cells
        if definition.kind == "markdown"
        for key in filter(None, (definition.id, qualify(split_cell_id(definition.id)[0], definition.name) if definition.name else None))
    }
    for definition in document.cells:
        if definition.kind != "markdown":
            continue
        result = next(cell for cell in cells if cell["id"] == definition.id)
        markdown = re.sub(
            r"\]\(#cell-([A-Z]+[1-9][0-9]*)\)",
            lambda match: f"]({files.get(match.group(1), '#cell-' + match.group(1))})",
            str(result["display"]),
        )
        # Resolve note labels relative to the exporting note's sheet.
        note_scope = ReferenceScope(
            {qualify(split_cell_id(cell.id)[0], cell.name): cell.id for cell in document.cells if cell.name},
            split_cell_id(definition.id)[0],
            sheet_prefixes(document.sheet_name, tuple(tab.name for tab in document.sheets)),
        )
        def note_target(reference: str) -> str:
            namespace, dot, attribute = reference.partition(".")
            if "!" in reference:
                return reference
            return (note_scope.qualified(namespace, attribute) if dot else note_scope.coordinate(reference) or note_scope.label(reference)) or reference
        # Links between notes point at the exported note files.
        markdown = re.sub(
            r"\]\(#note-([A-Za-z0-9_!.]+)\)",
            lambda match: f"]({notes.get(note_target(match.group(1)), '#note-' + match.group(1))})",
            markdown,
        )
        if workbook_dir is not None:
            for name in re.findall(r"\]\(assets/([0-9a-f]{16}\.(?:webp|png|jpe?g|gif))[)\s]", markdown):
                source = workbook_dir / "assets" / name
                if source.is_file():
                    (directory / "assets").mkdir(exist_ok=True)
                    shutil.copyfile(source, directory / "assets" / name)
        path = directory / notes[definition.id]
        path.write_text(markdown, encoding="utf-8")
        print(f"exported\t{definition.id}\t{path}", file=sys.stderr)
