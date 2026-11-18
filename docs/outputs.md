# Charts and outputs

Return a chart, table or HTML from a formula and the workbook shows it: in the grid,
in the cell panel, and in any note that mentions the cell with `{{ name }}`.

## Charts

**Plotly** figures are interactive (hover, zoom, legend):

```python
import plotly.express as px
px.line(history, x="month", y="balance")
```

**Matplotlib**: return the figure, after closing it:

```python
import matplotlib.pyplot as plt
figure, axes = plt.subplots()
axes.plot(history)
plt.close(figure)
figure
```

Values with `_repr_png_`, `_repr_svg_` or `_repr_mimebundle_` (as in Jupyter) display
too.

**Long signals.** A Plotly trace with more than 50 000 points is shown resampled (peaks
stay visible); zooming in fetches the real samples. `resampled(figure, points=5000)`
does the same for any figure.

## Tables

A pandas DataFrame or Series shows as a scrollable table (first 200 rows and 40
columns). `{{ frame }}` or `{{ frame.head() }}` in a note renders a table; the grid
shows a summary such as `▦ DataFrame 12 × 6`.

## HTML

Return `html(...)` for cards, boards and styled summaries. Any value with
`_repr_html_` works too (for example a pandas `Styler`).

```python
from html import escape
cards = "".join(f"<div class='card'>{escape(task)}</div>" for task in open_tasks)
html(f"<style>{board_css}</style><div class='board'>{cards}</div>")
```

Scripts and event handlers are removed, and styles never leak into the app. Use
`light-dark(light, dark)` colours to follow the theme, and `escape()` text you insert.

## Files to download

`artifact(data, filename, media_type)` offers a file for download (CSV, PDF, an image).
`data` can be bytes, text or a `BytesIO`. Downloads appear in the **Artifacts** drawer.

```python
artifact(frame.to_csv(index=False), "report.csv", "text/csv")
```

Charts and artifacts are limited to 20 MiB each. They are regenerated when the workbook
runs; the file stores only the code that makes them.

## Interactive widgets (anywidget)

A formula can return an [anywidget](https://anywidget.dev). Keep its data in input
cells and connect them with `bind`:

```python
bind(VectorPad(), x=vector_x, y=vector_y)
```

The widget shows `vector_x` and `vector_y` and writes changes back to them. Other cells
read the inputs, never the widget: `vector_x`, not `vector.x`. Because the data lives in
inputs, it is saved, can be undone, and can be set from the command line.

To build your own, see [Custom widgets](third-party-widgets.md).

## Dashboards

Tick **Show rendered in the grid** in the cell panel to turn a cell into a tile: charts
fill it, tables scroll, numbers appear large, and inputs become controls. Drag the
tile's corner to span several cells.
