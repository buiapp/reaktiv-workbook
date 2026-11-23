# Notes

A note is a page of Markdown that reads from your cells. Values, charts and controls
in it stay up to date, so the explanation never drifts from the numbers.

The **Notes** view edits a note like a document: Markdown shortcuts work as you type
(`# `, `- `, `**bold**`), selecting text shows a formatting toolbar, and `/` opens a
menu of blocks (headings, lists, tables, images, code, math, live values).

## What you can write

| Write | Result |
| --- | --- |
| `{{ balance }}` | A live value. Any expression works: `{{ f"{balance:,.0f}" }}`, `{{ total / count }}` |
| `{{ chart }}` | A cell's chart, table, HTML or widget (only for a bare reference) |
| `{{ summary }}` | A cell holding a Markdown string, formatted like the note (bare reference; turn off with *Render text results as Markdown*) |
| `[Rate: {{ rate }}](#sheet-input:rate)` | The input `rate` with its control (slider, dropdown, …) |
| `[Add items](#sheet-action:add_items)` | A button that runs an [action](actions.md) |
| `[Chapter 2](#note-p2_free_fall)` | A link to another note, by its label |
| `[Budget](#cell-B2)` | A link to a cell |
| `$E = mc^2$`, `$$ … $$` | Math (LaTeX); `{{ }}` works inside |
| ```` ```mermaid ```` block | A diagram; `{{ }}` works inside |
| ```` ```python ```` block | Highlighted code (any language) |

While editing:

- Type `{{` to pick a cell. Click a live value to see the cells it reads.
- **Insert widget** adds a control for an input. Its type and settings come from the
  input cell, so it looks the same in every note and in the grid.
- Hover a value to make it **Normal**, **Wide** or **Full** width. Right-click an image
  or chart to resize it.
- In split view, drag a cell from the grid onto a note to insert it as a live value.

## Reading and editing

The **View / Edit** switch in the top bar (Ctrl/Cmd+Shift+E) applies to the whole
workbook. In View mode the text is locked, but controls, charts and links keep working.
Workbooks you open start in View mode; new ones in Edit mode.

## Images

Paste, drop or upload images (**Image…** or `/image`). They are shrunk and stored as
files in an `assets/` folder next to the workbook, so the Python file stays small.
Keep `assets/` with the workbook when you move or share it.

In the browser app, saving a workbook with images downloads a `.workbook.py.zip`
containing the file and its images. Open the ZIP directly in the app.

## Organizing notes

- **+** in the notes list adds a page. Drag notes to reorder them, or onto another note
  to nest them.
- Markdown cells created in the grid are text and headings for the sheet, not pages.
  **Show in Notes** in the cell panel turns one into a page.
- The **Contents** button lists the note's headings.

## Print and export

The export button in the notes list prints notes or exports them as Markdown or a
standalone HTML file, with the current values, tables and charts. Controls become plain
text. From the command line, `reaktiv-workbook evaluate FILE --note plan` prints a note
and `reaktiv-workbook export FILE out/` writes every note and chart.

## Writing good notes

- Lead with the result, then the controls, then the explanation.
- Format numbers in the note (`{{ f"{x:,.0f}" }}`); keep the cell's value a number.
- Bind controls to input cells so readers can explore without touching formulas.
