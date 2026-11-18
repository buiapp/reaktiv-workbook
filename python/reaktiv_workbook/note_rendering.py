"""Evaluate compiled note parts and resolve outputs through the output owner."""
from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Any

from .artifact import Artifact
from .rich_output import HTML_MIME_TYPE, is_anywidget, rich_output_markdown
from .tables import table_markdown, table_payload
from .value_encoding import NOTE_TABLE_KINDS, format_display


def _unwrap_outputs(
    parts: Sequence[tuple[bool, Any, str | None]], mode: str
) -> list[tuple[bool, Any, str | None]]:
    """Drop the ``[`` … ``](#sheet-output?…)`` around an output value; with ``mode="mark"``,
    a wide or full-width value is put between layout comments instead."""
    result = list(parts)
    for index in range(1, len(result) - 1):
        before, current, after = result[index - 1], result[index], result[index + 1]
        if not current[0] or before[0] or after[0] or not str(before[1]).endswith("["):
            continue
        match = re.match(r"\]\(#sheet-output\?([^)\s]*)\)", str(after[1]))
        if match is None:
            continue
        layout = next((part[7:] for part in match.group(1).split("&") if part.startswith("layout=")), "")
        opening, closing = "", ""
        if mode == "mark" and layout in ("wide", "full"):
            opening, closing = f"\n\n<!--reaktiv-layout:{layout}-->\n\n", "\n\n<!--/reaktiv-layout-->\n\n"
        result[index - 1] = (False, str(before[1])[:-1] + opening, None)
        result[index + 1] = (False, closing + str(after[1])[match.end():], None)
    return result


def render_markdown(
    parts: list[tuple[bool, Any, str | None]],
    namespace: dict[str, Any],
    rich_payload: Callable[[str, Any], dict[str, Any] | None],
    table_for: Callable[[str, Any], dict[str, Any] | None],
    *,
    embed_images: bool = False,
    outputs: str = "keep",
) -> str:
    """Render a Markdown cell.

    ``outputs`` handles ``[{{ x }}](#sheet-output?…)`` (a value's size or layout in the note
    editor): ``"keep"`` as written (the app maps the display back onto the source),
    ``"unwrap"`` drops the wrapper (self-contained Markdown), ``"mark"`` also puts
    ``<!--reaktiv-layout:wide-->`` … ``<!--/reaktiv-layout-->`` around wide values.

    Images produced by a referenced cell (``{{ C1 }}``) are linked as
    ``![Plot](#cell-C1)`` unless ``embed_images`` is set: the image payload
    already travels with that cell, so every note does not re-encode and
    re-send it. Use :meth:`render_note` for self-contained Markdown.
    """

    rendered: list[str] = []
    for is_expression, value, reference in _unwrap_outputs(parts, outputs) if outputs != "keep" else parts:
        if not is_expression:
            rendered.append(value)
            continue
        evaluated = eval(value, namespace)
        if isinstance(evaluated, Artifact):
            if reference is not None and not embed_images:
                rendered.append(evaluated.to_markdown(link=f"#cell-{reference}"))
            else:
                rendered.append(evaluated.to_markdown())
            continue
        if is_anywidget(evaluated):
            # Interactive only in the app; exported Markdown names the widget.
            rendered.append(f"*{type(evaluated).__name__} widget*")
            continue
        if reference is not None and not embed_images:
            payload = rich_payload(reference, evaluated)
            if payload is not None:
                alt = "HTML" if payload["mimeType"] == HTML_MIME_TYPE else "Plot"
                rendered.append(f"![{alt}](#cell-{reference})")
                continue
        table = (
            table_for(reference, evaluated)
            if reference is not None
            else table_payload(evaluated)
        )
        if table is not None and table["kind"] in NOTE_TABLE_KINDS:
            rendered.append(table_markdown(table))
            continue
        rendered.append(rich_output_markdown(evaluated) or format_display(evaluated))
    return "".join(rendered)

