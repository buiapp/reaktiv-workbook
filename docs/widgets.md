# Controls

A control (slider, dropdown, checkbox, …) shows an input cell and writes your changes
back to it. The input holds the value; formulas and charts read the input. The same
input can have its control in the grid and in any number of notes.

## Add a control

1. Select an input cell and choose a **Widget** in the cell panel.
2. To show it in the grid, tick **Show rendered in the grid**.
3. To show it in a note, use **Insert widget**, or write
   `[Region: {{ region }}](#sheet-input:region)`.

Notes use the cell's widget type and settings, so a control looks the same everywhere.

| Widget | Value | Settings |
| --- | --- | --- |
| Number, Slider | number | min, max, step |
| Checkbox | `True` / `False` | |
| Text, Long text | string | placeholder |
| Date | string (`2026-07-01`) | |
| Dropdown, Radio buttons | string | options |
| List | list of strings | add and remove entries |
| Multiple choice | list of strings | options |
| File path, Folder path | string | |
| Button | click count, `True`/`False`, or nothing | count clicks, toggle, or run an [action](actions.md) |

A **count** button's value goes up on each click, so whatever reads it reruns on
every click.

## Settings that follow other cells

Most settings accept a literal or `=` followed by a Python expression:

| Setting | Example |
| --- | --- |
| Max | `=upper_limit * 2` |
| Options | `=available_devices` (a list of strings) |
| Label | `="Stop" if running else "Start"` |
| Disabled | `=not ready` |
| Visible, Loading, Pressed | `=working` |

When a setting changes, the input keeps its value. A choice that disappears from the
options stays visible as unavailable instead of silently changing the selection.
In a note link you can also pass settings: `?max={{ upper_limit }}`. Try the
*Reactive app controls* example.

## When an edit reaches the cell

Sliders update while you drag (at least every 400 ms) and once more on release. Text
and number fields update on Enter or when you leave the field. To update while typing,
set **Update delay (ms)** (`debounce`), for example `0` for every keystroke. Keep
instant updates for cheap calculations.

## File and folder paths

The value is a path string. With `reaktiv-workbook edit` or `run`, **Browse…** picks a
file or folder on your computer; otherwise type the path. The control never reads or
uploads the file: read it in a formula, resource or action.

## Custom controls

For anything the built-in controls can't do, write an
[anywidget](outputs.md#interactive-widgets-anywidget). See
[Custom widgets](third-party-widgets.md).
