"""HTML output for cells.

A formula that returns ``html("<div class='card'>…</div>")`` — or any value with
``_repr_html_``, as in Jupyter — is shown as that HTML in notes, tiles, and the inspector.
The app sanitises it (no scripts, event handlers, frames, or forms) and renders it in a
shadow root, so its ``<style>`` only styles this output. For interactive HTML with
JavaScript, use an anywidget.
"""

from __future__ import annotations

from typing import Any


class HTML:
    """Markup to show as HTML; ``str()`` of the cell value stays short."""

    __slots__ = ("markup",)

    def __init__(self, markup: Any) -> None:
        self.markup = markup if isinstance(markup, str) else str(markup)

    def _repr_html_(self) -> str:
        return self.markup

    def __repr__(self) -> str:
        return f"HTML({len(self.markup):,} characters)"

    __str__ = __repr__

    def __eq__(self, other: object) -> bool:
        return isinstance(other, HTML) and other.markup == self.markup

    def __hash__(self) -> int:
        return hash(self.markup)


def html(markup: Any) -> HTML:
    """Show ``markup`` as HTML: ``html(f"<b>{total:,}</b> tasks")``."""

    return markup if isinstance(markup, HTML) else HTML(markup)
