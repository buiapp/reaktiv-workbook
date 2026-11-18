# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "pandas",
#   "plotly",
#   "matplotlib",
#   "anywidget",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    bind,
    cell,
    html,
    markdown,
    workbook_config,
    worksheet,
)


class StartWorksheet(Worksheet["ReaktivWorkbookGuideWorkbook"]):
    # loan amount in €
    loan = cell(
        "A1",
        field(250000),
        label="loan",
        view={"widget": {"type": "range", "min": 50000, "max": 800000, "step": 10000}},
    )

    @cell("B1", label="payment")
    @computed
    def payment(self):
        # monthly payment of an annuity loan
        r = self.rate() / 100 / 12
        n = self.years() * 12
        return round(self.loan() * r / (1 - (1 + r) ** -n)) if r else round(self.loan() / n)

    @cell("E1", label="guide_start")
    @markdown
    def guide_start(self):
        return """# Reaktiv Workbook guide

        **Show it, chart it, make it interactive.** This guide is itself a workbook: every example on
        these pages is a live cell you can change. Open **Split** to see them next to the text.

        ## How output works

        Every cell holds a Python value, and **the value decides what you see**. Return a number and you
        see the number; return a chart and you see the chart. There is no separate "chart cell" or
        "widget cell" — the same formula cell shows whatever its value is.

        | Your formula returns | You see | Typical use |
        | --- | --- | --- |
        | a number, text, a list, a dict | the value | results, KPIs |
        | a pandas `DataFrame` / `Series` | a table | data, breakdowns |
        | a Matplotlib figure | an image | static charts, print |
        | a Plotly figure | an interactive chart | exploring data |
        | `html("…")` or anything with `_repr_html_` | styled HTML | cards, boards, badges |
        | an anywidget | a live, interactive widget | custom controls |
        | `artifact(data, "report.csv", "text/csv")` | a download (images preview) | files to hand out |

        You see a value in three places:

        - **In a note**, write the cell's label in double braces: {{ self.workbook.Snippets.braces()('revenue_chart') }}. Charts,
          tables, HTML and widgets appear only for a bare label.
        - **In the grid**, tick *Show rendered in the grid* in the inspector to make the cell a dashboard
          tile, then drag its corner to make it bigger.
        - **In the inspector**, the selected cell's output is always shown in full.

        Tables, charts, HTML and widgets can be **wider than the text**: while editing, hover one and choose
        **Wide** or **Full** in the small toolbar (images: right-click). The note stores it as
        {{ self.workbook.Snippets.braces()('revenue_chart') }} wrapped in a link: `[…](#sheet-output?layout=wide)`.

        ## Which one should I use?

        | I want to… | Use |
        | --- | --- |
        | let readers change a number, pick an option, tick a box | a control in a note — no code ([chapter 2](#note-guide_controls)) |
        | show data as a table | a DataFrame ([chapter 3](#note-guide_tables)) |
        | draw a line, bar, scatter, or pie chart | Plotly or Matplotlib ([chapter 4](#note-guide_charts)) |
        | show cards, a board, a styled summary | an HTML cell ([chapter 5](#note-guide_html)) |
        | build my own control: drag a point, click stars | an anywidget ([chapter 6](#note-guide_widgets)) |

        Rule of thumb: prefer the simplest thing that works. A note control beats a widget; a Plotly chart
        beats a hand-drawn SVG; HTML beats a widget when nobody needs to click it.

        > **How to read the code boxes.** Each box is one cell: its title shows the cell kind and its
        > *label*, the name other cells use. Type the code into a cell (start a formula with `=`) and give
        > it that label in the inspector. Cells refer to each other by label: `price * quantity`.


        ---

        **Next:** [2 · Controls in notes](#note-guide_controls)"""

    # interest rate in percent
    rate = cell(
        "A2",
        field(3.5),
        label="rate",
        view={"widget": {"type": "range", "min": 0, "max": 10, "step": 0.1}},
    )

    @cell("E2", label="guide_controls")
    @markdown
    def guide_controls(self):
        return """# Controls in notes

        A control is a link in a note that is bound to an **input cell**. Moving it rewrites the input cell,
        and everything that depends on it updates. Try it:

        [Loan (€): {{ self.loan() }}](#sheet-input:loan?type=range&min=50000&max=800000&step=10000)

        [Rate (%): {{ self.rate() }}](#sheet-input:rate?type=range&min=0&max=10&step=0.1)

        [Years: {{ self.years() }}](#sheet-input:years?type=range&min=5&max=35&step=1)

        The monthly payment is **{{ f'{self.payment():,}' }} €**.

        {{ self.workbook.Snippets.code_rate() }}

        {{ self.workbook.Snippets.code_payment() }}

        {{ self.workbook.Snippets.code_rate_link() }}

        | type | Control | The input cell holds |
        | --- | --- | --- |
        | `range` | slider with ‹ › steps (`min`, `max`, `step`) | a number |
        | `number` | number field | a number |
        | `checkbox` | tick box | `True` / `False` |
        | `select` | dropdown (`options=A,B,C`) | the chosen text |
        | `text`, `textarea`, `date` | text field, long text, date picker | text |
        | `file`, `folder` | **Browse…** with the CLI; manual path entry in a browser | a path string |
        | `list` | add and remove entries | a list of texts |
        | `multiselect` | tick several (`options=…`) | a list of the ticked options |
        | `button` | button | a click count: cells reading it run on every click |

        While editing a note, hover or focus a direct input reference for **Show as widget**.
        Hover or focus its control for **Show value** to switch back. These saved
        note edits support undo/redo and keep the input value unchanged.

        File/folder selection returns a path on your computer; it does not upload or read
        contents. The Python kernel must be able to access that path.

        Spaces in options are written `%20`: `options=Lose%20fat,Maintain`. In the editor, type `/` and
        choose **Input widget**: it writes the link for you.

        Grid widget bounds can also be Python expressions: enter `income * 2` in **max**,
        or `=choices` in **Options** to use a list-valued cell. The settings update reactively
        and keep the input value unchanged. Notes inherit the cell's widget settings when
        you choose **Auto**; a setting in the note link overrides its inherited value.
        **Label** and **Placeholder** accept text or `=expression`. Under **Visibility and
        state**, configure **Visible**, **Disabled**, **Loading**, and button **Pressed**
        with `True`, `False`, or `=expression`. These settings participate in the graph.
        Buttons can count clicks or toggle a Boolean input. Try the **Reactive app controls**
        example to see labels, choices, and states change together. **Linked input** adds a derived default users can override. Its optional **Computation** field can use `source` and `previous.value` / `previous.source` to preserve a valid selection or clamp a manual value when the source changes. `previous` is `None` initially; only Source reads trigger recomputation:
        enter its formula in the code editor, then change its value through a control or
        the inspector. A dependency change resets the override; the formula stays intact.
        **Reset to derived value** is available in the inspector and overridden note widgets.
        Overrides survive saves and undo. **Split** can pair Notes, Cells or Graph, with a view
        and worksheet picker in each pane. Choose Cells twice to compare worksheets, or
        Notes twice to read two notes. The sheets can be the same or different; each
        pane scrolls and zooms independently. Cell zoom is inside Cells.

        **Equality** in the inspector controls when a value counts as changed. The default
        compares value and type; **Identity** compares Python objects; **Always treat as changed**
        propagates every update. **Custom Python function** accepts a lambda or shared-code
        function taking previous and current values. For example,
        `lambda previous, current: abs(previous - current) < 0.01` ignores tiny numeric changes.
        Return True to keep the previous value and skip dependent updates, or False to update.
        Click **Apply** to save the setting with the cell. Inputs, linked inputs, formulas,
        resources and notes support equality; effects use triggers. Comparisons do not track
        reactive dependencies.


        ---

        **Previous:** [1 · How output works](#note-guide_start) · **Next:** [3 · Tables](#note-guide_tables)"""

    # years to pay back
    years = cell(
        "A3",
        field(25),
        label="years",
        view={"widget": {"type": "range", "min": 5, "max": 35, "step": 1}},
    )

    @cell("E3", label="guide_tables")
    @markdown
    def guide_tables(self):
        return """# Tables

        Return a pandas `DataFrame` and it is shown as a table — in the grid as a summary, in notes and the
        inspector in full. Add `pandas` to the packages first (*Settings → Python environment → Package
        dependencies*; this guide has it already).

        {{ self.workbook.Data.sales() }}

        Best month: **{{ self.workbook.Data.best_month() }}**.

        {{ self.workbook.Snippets.code_sales() }}

        {{ self.workbook.Snippets.code_best_month() }}

        {{ self.workbook.Snippets.code_sales_note() }}

        - {{ self.workbook.Snippets.braces()('sales') }} shows the table itself; an expression such as {{ self.workbook.Snippets.braces()('sales.head(2)') }} shows that
          result as a table too.
        - Format numbers in the table, not in the data: `sales.style.format(...)` returns a *Styler*, which is
          shown as HTML (it needs `jinja2` in the packages).
        - A list of dicts is a table in the inspector, but text in notes — wrap it in `pd.DataFrame(...)`.


        ---

        **Previous:** [2 · Controls in notes](#note-guide_controls) · **Next:** [4 · Charts](#note-guide_charts)"""

    @cell("E4", label="guide_charts")
    @markdown
    def guide_charts(self):
        return """# Charts

        ## Plotly — interactive

        Readers can hover, zoom and toggle series. Add `plotly` to the packages and return the figure.

        {{ self.workbook.Data.revenue_chart() }}

        {{ self.workbook.Snippets.code_revenue_chart() }}

        The chart's style comes from a **function cell**: a formula that ends in `def` holds that function,
        and other cells call it by its label. One place to change the look of every chart:

        {{ self.workbook.Snippets.code_chart_layout() }}

        ## Matplotlib — static

        Good for print-like figures. Close the figure before returning it, so it is not kept in memory.

        {{ self.workbook.Data.trend() }}

        {{ self.workbook.Snippets.code_trend() }}

        When you print or export a note, interactive charts become images automatically.


        ---

        **Previous:** [3 · Tables](#note-guide_tables) · **Next:** [5 · HTML cells](#note-guide_html)"""

    # monthly income in €
    income = cell(
        "A5",
        field(4000),
        label="income",
        view={"widget": {"type": "range", "min": 1000, "max": 10000, "step": 100}},
    )

    @cell("E5", label="guide_html")
    @markdown
    def guide_html(self):
        return """# HTML cells

        When a table or a chart is not the right shape — a Kanban board, KPI cards, a 2×2 matrix, a progress
        tracker — build the HTML in Python and return `html(...)`. It is available in every cell.

        {{ self.workbook.HTML.kpis() }}

        [Open invoices: {{ self.workbook.HTML.open_invoices() }}](#sheet-input:open_invoices?type=range&min=0&max=20&step=1)

        [Margin: {{ self.workbook.HTML.margin() }}](#sheet-input:margin?type=range&min=0&max=0.6&step=0.01)

        A number turns red when it needs attention. Move the sliders above the threshold and back.

        {{ self.workbook.Snippets.code_kpis() }}

        {{ self.workbook.Snippets.code_card_css() }}

        ## Good to know

        - **Escape text you insert** with `from html import escape` — task titles, names, anything typed by a person.
        - **Keep the CSS in an input cell** (like `card_css`): one place to restyle every view.
        - **Use `light-dark(light, dark)` colours** — the output follows the app's light or dark theme.
        - **Make it responsive** with `grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))`: side by
          side on a wide screen, stacked on a phone.
        - **Your styles stay inside.** The output has its own shadow root: its CSS cannot change the app, and the
          app's CSS does not change it (font and text colour are inherited).
        - **No JavaScript.** Scripts, `onclick` and other handlers, frames and forms are removed. Web links open in
          the browser; a link to `#note-summary` opens the note labelled `summary`. For anything clickable,
          write a widget ([chapter 6](#note-guide_widgets)).
        - A plain string containing `<b>` is *text*. HTML is only rendered when the value says it is HTML:
          `html(...)` or a `_repr_html_` method.


        ---

        **Previous:** [4 · Charts](#note-guide_charts) · **Next:** [6 · Your own widgets (anywidget)](#note-guide_widgets)"""

    # saved per month in €
    savings = cell(
        "A6",
        field(800),
        label="savings",
        view={"widget": {"type": "range", "min": 0, "max": 3000, "step": 50}},
    )

    @cell("E6", label="guide_widgets")
    @markdown
    def guide_widgets(self):
        return """# Your own widgets (anywidget)

        [anywidget](https://anywidget.dev) lets you write a widget once — a small Python class plus a bit of
        JavaScript — and use it here, in Jupyter, VS Code, and marimo. Use it when readers should *interact*
        with something no built-in control offers: drag a point, click stars, step through an algorithm.

        How was this guide so far? {{ self.workbook.Widgets.stars() }}

        You gave **{{ self.workbook.Widgets.rating() }}** stars: {{ self.workbook.Widgets.verdict() }}. Click a star — then look at the input cell `rating`
        on the *Widgets* sheet: the widget wrote it.

        ## The idea: widgets are views of input cells

        The data — the rating, a point's coordinates, the current step — lives in ordinary **input cells**.
        The widget shows those cells, and when the reader interacts, it **writes the new value back** to them.
        So the value is saved with the workbook, undo works, the graph shows it, and other cells read the input
        cell, never the widget.

        ```mermaid
        flowchart LR
          rating["● rating (input)"] -- "shown in" --> stars["ƒ stars (widget)"]
          stars -- "a click writes back" --> rating
          rating --> verdict["ƒ verdict"]
        ```

        ## Build one in four steps

        **1. Add the package.** *Settings → Python environment → Package dependencies*: add `anywidget`.

        **2. Define the widget class in a cell.** A formula that ends in a `class` holds that class (label the
        cell like the class). Traits marked `sync=True` are shared with the browser; `_esm` is the JavaScript
        that draws it, `_css` its styles.

        {{ self.workbook.Snippets.code_StarRating() }}

        **3. Keep the data in an input cell and bind it.** `bind(widget, trait=input_cell)` shows the input cell
        in the trait and makes the widget write changes back to it.

        {{ self.workbook.Snippets.code_rating() }}

        {{ self.workbook.Snippets.code_stars() }}

        **4. Show it and use the value.** Put the widget in a note, and read the *input cell* anywhere.

        {{ self.workbook.Snippets.code_verdict() }}

        {{ self.workbook.Snippets.code_stars_note() }}

        Type `2` into `rating` and the stars follow. From the command line,
        `reaktiv-workbook guide.workbook.py --set rating=5 --cell verdict` works without a browser.


        ---

        **Previous:** [5 · HTML cells](#note-guide_html) · **Next:** [7 · Widget rules and the JavaScript side](#note-guide_widget_rules)"""

    @cell("E7", label="guide_widget_rules")
    @markdown
    def guide_widget_rules(self):
        return """# Widget rules and the JavaScript side

        ## Where state lives

        | What | Where it lives | Example |
        | --- | --- | --- |
        | **Data** — what the reader decides | an input cell, bound with `bind` | the rating, a point's x and y |
        | **Derived values** | formula cells that read the input cells | a vector's length, a verdict |
        | **View state** — how it looks right now | inside the widget (a JavaScript variable or an unbound trait) | hover, "is it playing", a drag in progress |

        - **Widgets are leaves.** They can show cells and change input cells, but they cannot create values of
          their own for other cells to depend on.
        - **Read the input cell, not the widget.** `stars.value` in another cell is an error that tells you what to do:

        {{ self.workbook.Snippets.code_error() }}

        - **Bind to input cells only** — not to formulas or plain values: `bind(w, value=3)` has nowhere to write the change.
        - **Bound values must be simple:** numbers, text, `True`/`False`, `None`, lists and dicts of those.
        - **One undo step per gesture.** Changes within a second are one step; `x` and `y` saved together are one step.

        ## The JavaScript side

        `_esm` is an ES module whose default export has a `render` function (and optionally `initialize`).
        `render` gets the `model` and an element `el` to draw into.

        | Call | Does |
        | --- | --- |
        | `model.get("x")` | the current value of a synced trait |
        | `model.set("x", value)` | changes it in the browser; `change:x` listeners run at once |
        | `model.save_changes()` | sends the changes to Python — bound traits are written to their input cells |
        | `model.on("change:x", fn)`, `model.off(…)` | react to changes (from Python, or after a cell recomputed) |
        | `model.send(content, undefined, buffers)` | a custom message to the widget's Python `on_msg` handlers |
        | `model.on("msg:custom", fn)` | messages from Python's `widget.send(...)` |
        | `experimental.invoke("name", msg)` | calls a Python `@anywidget.experimental.command`; a promise of `[response, buffers]` |
        | `model.widget_manager.get_model(id)` | the model of a nested widget |
        | return a function from `render` | cleanup when the view goes away (timers, listeners) |

        ## Patterns that save you time

        **Drag, then save once.** Draw on every `pointermove`, but save on `pointerup`: one write per gesture.

        {{ self.workbook.Snippets.code_drag() }}

        **Copy before you set.** `model.set("x", …)` runs `change:x` listeners at once; a listener that redraws
        from the model would reset your local point before you set `y`.

        {{ self.workbook.Snippets.code_copy_first() }}

        - **Animate in the browser** with `requestAnimationFrame`: no Python on every frame. Only what the reader
          *chooses* goes back to Python.
        - **Follow the theme:** start the CSS with `:host, .panel { color-scheme: light dark; }` and write colours
          as `light-dark(#20231f, #e3e6de)`.
        - **Keyboard too:** give draggable parts `tabindex="0"` and handle the arrow keys.

        ## Where widgets run

        - Each widget runs in a **sandboxed frame**: its code cannot reach the app or your files.
        - Bundle imports into `_esm`: modules from the internet may be blocked.
        - The same class works in Jupyter; there, set the traits directly instead of `bind`.

        ## When something does not work

        - **"Widget error: …" under the widget** — the JavaScript threw; the browser's developer tools show the stack.
        - **Nothing happens on click** — call `model.save_changes()` after `model.set(...)`.
        - **The value jumps back** — a `change:` listener redrew from the old value; copy before you set.
        - **Test without a browser** — `--set` the bound input cells on the command line and read the cells
          that depend on them.

        More complete widgets in the **Examples** menu: *Vectors you can touch*, *Wave laboratory*,
        *Binary search explainer*, and *anywidget demo*.


        ---

        **Previous:** [6 · Your own widgets (anywidget)](#note-guide_widgets) · **Next:** [8 · Math, diagrams, links, and the file](#note-guide_notes)"""

    @cell("E8", label="guide_notes")
    @markdown
    def guide_notes(self):
        return """# Math, diagrams, links, and the file

        Notes are Markdown with live values — values work inside formulas and diagrams too.

        The monthly payment is $P = \\frac{rL}{1-(1+r)^{-n}}$ = **{{ f'{self.payment():,}' }} €**.

        ```mermaid
        flowchart LR
          Income -- "{{ self.income() }}" --> Budget -- "{{ self.savings() }}" --> Savings
        ```

        [Income (€): {{ self.income() }}](#sheet-input:income?type=range&min=1000&max=10000&step=100)

        {{ self.workbook.Snippets.code_math_note() }}

        - `$…$` inline and `$$…$$` display math (LaTeX, rendered with KaTeX).
        - A ` ```mermaid ` code block becomes a diagram: flowcharts, sequences, timelines.
        - `[text](#note-label)` links to another note by its label; the link dialog lists all notes.
        - {{ self.workbook.Snippets.braces()('other_note') }} embeds another note.

        ## Other cell kinds

        | Kind | For | Example |
        | --- | --- | --- |
        | **Input** | values a person changes (controls write them) | `4.5`, `"North"`, `[2, 5, 8]` |
        | **Formula** (`=`) | computed values, charts, HTML, widgets | `price * quantity` |
        | **Function cell** | a helper or class other cells use | a formula ending in `def` or `class` |
        | **Resource** (`~`) | slow or awaited work: HTTP, files | `await fetch_json(url)` |
        | **Effect** (`!`) | actions without a value: print, notify | `print(total)` |
        | **Clock cell** | updates on a schedule | `every(minutes=5)`, `at("08:00", days="mon-fri")` |

        Cell code can have several lines: the last expression is the value, and `return` works
        anywhere, also to stop early (`if not rows: return None`). Effects can `return` to stop too.

        ## Resource parameters and dependency edges

        Async resource cells default to **Automatic** parameters: referenced cells are
        captured before loading, so ordinary reads remain consistent across awaits.
        For finer control, choose **Resource parameters → Explicit** in the inspector.
        Write synchronous parameter code such as `request_url if enabled else None`,
        then use `params` in the async source (`await fetch_json(params)`). A `None`
        parameter leaves the resource idle. A previously loaded value can remain visible.
        Put cell references in the parameter stage; explicit loaders use the captured
        parameters. Apply/discard and drafts include both editors.

        The graph displays reads from the latest evaluation. Conditional branches can
        change its edges; **Not run** means dependencies are not yet observed, and
        **Partial** means an error prevented a complete evaluation. Source references
        remain available for editing. Hiding a view does not turn off calculations.

        ## The file format

        A workbook is one Python file, readable and diffable. New saves use one worksheet class per sheet
        and one workbook class owning all actions. Legacy `@sheet` files still open and upgrade on save.
        In a worksheet method, another local cell is `self.label()`; cross-sheet reads are
        `self.workbook.Other.label()`. In workbook actions, use `self.Sheet.label()`.
        everything else is the code you typed:

        {{ self.workbook.Snippets.code_file() }}

        Check a workbook from the command line with `reaktiv-workbook guide.workbook.py --check`. This guide's code
        boxes are cells too — they live on the *Snippets* sheet.

        A Python script can use a worksheet with `SheetSession.load(path)`. Read values
        with `session.values.total()` and set inputs with `session.inputs.quantity.set(5)`.
        `session.open_editor()` attaches this app to the same running graph, so script
        updates and editor changes stay synchronized. Build the app first, or pass the
        URL of a local app preview. Keep the session context open while the script runs;
        `session.save()` writes the worksheet and its snapshot sidecar.



        ---

        **Previous:** [7 · Widget rules and the JavaScript side](#note-guide_widget_rules)"""


class DataWorksheet(Worksheet["ReaktivWorkbookGuideWorkbook"]):
    @cell("A1", label="sales")
    @computed
    def sales(self):
        import pandas as pd
        return pd.DataFrame({
            "month": ["Jan", "Feb", "Mar", "Apr"],
            "revenue": [92_000, 98_500, 104_200, 101_700],
        })

    @cell("A2", label="best_month")
    @computed
    def best_month(self):
        return self.sales().loc[self.sales().revenue.idxmax(), "month"]

    @cell("A3", label="chart_layout")
    @computed
    def chart_layout(self):
        def chart_layout(title, **extra):
            """One style for every chart in this workbook."""
            return dict(title=dict(text=title, x=0), template="plotly_white", height=340,
                        margin=dict(l=48, r=16, t=56, b=40), **extra)

        return chart_layout

    @cell("A4", label="revenue_chart")
    @computed
    def revenue_chart(self):
        import plotly.express as px
        figure = px.bar(self.sales(), x="month", y="revenue")
        figure.update_layout(**self.chart_layout()("Revenue per month"))
        return figure

    @cell("A5", label="trend")
    @computed
    def trend(self):
        import matplotlib.pyplot as plt
        figure, axis = plt.subplots(figsize=(6, 2.6))
        axis.plot(self.sales().month, self.sales().revenue, marker="o")
        axis.set_title("Revenue")
        plt.close(figure)
        return figure


class HTMLWorksheet(Worksheet["ReaktivWorkbookGuideWorkbook"]):
    # revenue this year in €
    revenue_total = cell("A1", field(1234567), label="revenue_total")

    # the look of the KPI cards
    card_css = cell(
        "B1",
        field(
            '.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }\n.kpi { padding: 12px 14px; border-radius: 10px; background: light-dark(#f2f5ed, #1c1f1a); }\n.kpi b { display: block; font-size: 26px; }\n.kpi span { color: light-dark(#5d6459, #9da397); font-size: 13px; }\n.kpi.warn b { color: #d64545; }'
        ),
        label="card_css",
    )

    # open invoices
    open_invoices = cell(
        "A2",
        field(7),
        label="open_invoices",
        view={"widget": {"type": "range", "min": 0, "max": 20, "step": 1}},
    )

    @cell("B2", label="kpis")
    @computed
    def kpis(self):
        from html import escape
        tiles = [
            (f"{self.revenue_total():,.0f} €", "revenue this year", False),
            (f"{self.open_invoices()}", "open invoices", self.open_invoices() > 5),
            (f"{self.margin():.0%}", "margin", self.margin() < 0.2),
        ]
        cards = "".join(
            f"<div class='kpi{' warn' if warn else ''}'><b>{escape(value)}</b><span>{escape(label)}</span></div>"
            for value, label, warn in tiles
        )
        return html(f"<style>{self.card_css()}</style><div class='kpis'>{cards}</div>")

    # margin (0-1)
    margin = cell(
        "A3",
        field(0.18),
        label="margin",
        view={"widget": {"type": "range", "min": 0, "max": 0.6, "step": 0.01}},
    )


class WidgetsWorksheet(Worksheet["ReaktivWorkbookGuideWorkbook"]):
    @cell("A1", label="StarRating")
    @computed
    def StarRating(self):
        import anywidget
        import traitlets

        class StarRating(anywidget.AnyWidget):
            """Five stars; clicking one sets the rating."""

            _esm = """
            function render({ model, el }) {
              const draw = () => {
                el.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
                  const star = document.createElement("button");
                  star.textContent = n <= model.get("value") ? "★" : "☆";
                  star.setAttribute("aria-label", `${n} stars`);
                  star.addEventListener("click", () => {
                    model.set("value", n);      // change it in the browser…
                    model.save_changes();       // …and send it to Python
                  });
                  return star;
                }));
              };
              model.on("change:value", draw);   // redraw when the value changes
              draw();
            }
            export default { render };
            """

            _css = """
            button { font-size: 30px; border: 0; background: none; color: #e0a100; cursor: pointer; }
            """

            value = traitlets.Int(0).tag(sync=True)

        return StarRating

    @cell("B1", label="stars")
    @computed
    def stars(self):
        return bind(self.StarRating()(), value=self.rating())

    # the rating, 0-5 (the stars write it)
    rating = cell("A2", field(4), label="rating")

    @cell("B2", label="verdict")
    @computed
    def verdict(self):
        return "Loved it" if self.rating() >= 4 else "It was fine" if self.rating() >= 2 else "Not for me"


class SnippetsWorksheet(Worksheet["ReaktivWorkbookGuideWorkbook"]):
    @cell("A1", label="code_rate")
    @computed
    def code_rate(self):
        return self.show_code()('# interest rate in percent\n3.5', 'Input · rate')

    @cell("C1", label="show_code")
    @computed
    def show_code(self):
        def show_code(code, title=""):
            """A code box for the guide's notes (HTML, so {{ … }} in code is shown, not run)."""
            from html import escape
            head = f"<div class='head'>{escape(title)}</div>" if title else ""
            return html(
                "<style>"
                "figure { margin: 0; overflow: hidden; border: 1px solid light-dark(#dde2d6, #2b2f27); border-radius: 10px;"
                " background: light-dark(#f2f5ed, #171a15); }"
                ".head { padding: 6px 12px; border-bottom: 1px solid light-dark(#dde2d6, #2b2f27);"
                " color: light-dark(#5d6459, #9da397); font: 600 12px ui-monospace, Menlo, monospace; }"
                "pre { margin: 0; padding: 12px; overflow-x: auto; font: 13px/1.55 ui-monospace, Menlo, monospace;"
                " font-variant-ligatures: none; white-space: pre; }"
                "</style>"
                f"<figure>{head}<pre>{escape(code)}</pre></figure>"
            )

        return show_code

    @cell("A2", label="code_payment")
    @computed
    def code_payment(self):
        return self.show_code()('# monthly payment of an annuity loan\nr = rate / 100 / 12\nn = years * 12\nreturn round(loan * r / (1 - (1 + r) ** -n)) if r else round(loan / n)', 'Formula · payment')

    @cell("C2", label="braces")
    @computed
    def braces(self):
        def braces(name):
            """`{{ name }}` as text, to mention the note syntax inside a note."""
            return "{{ " + name + " }}"

        return braces

    @cell("A3", label="code_rate_link")
    @computed
    def code_rate_link(self):
        return self.show_code()('[Rate (%): {{ rate }}](#sheet-input:rate?type=range&min=0&max=10&step=0.1)', 'In a note')

    @cell("A4", label="code_sales")
    @computed
    def code_sales(self):
        return self.show_code()('import pandas as pd\nreturn pd.DataFrame({\n    "month": ["Jan", "Feb", "Mar", "Apr"],\n    "revenue": [92_000, 98_500, 104_200, 101_700],\n})', 'Formula · sales')

    @cell("A5", label="code_best_month")
    @computed
    def code_best_month(self):
        return self.show_code()('sales.loc[sales.revenue.idxmax(), "month"]', 'Formula · best_month')

    @cell("A6", label="code_sales_note")
    @computed
    def code_sales_note(self):
        return self.show_code()('{{ sales }}\n\nBest month: {{ best_month }}', 'In a note')

    @cell("A7", label="code_chart_layout")
    @computed
    def code_chart_layout(self):
        return self.show_code()('def chart_layout(title, **extra):\n    """One style for every chart in this workbook."""\n    return dict(title=dict(text=title, x=0), template="plotly_white", height=340,\n                margin=dict(l=48, r=16, t=56, b=40), **extra)', 'Formula · chart_layout')

    @cell("A8", label="code_revenue_chart")
    @computed
    def code_revenue_chart(self):
        return self.show_code()('import plotly.express as px\nfigure = px.bar(sales, x="month", y="revenue")\nfigure.update_layout(**chart_layout("Revenue per month"))\nreturn figure', 'Formula · revenue_chart')

    @cell("A9", label="code_trend")
    @computed
    def code_trend(self):
        return self.show_code()('import matplotlib.pyplot as plt\nfigure, axis = plt.subplots(figsize=(6, 2.6))\naxis.plot(sales.month, sales.revenue, marker="o")\naxis.set_title("Revenue")\nplt.close(figure)\nreturn figure', 'Formula · trend')

    @cell("A10", label="code_card_css")
    @computed
    def code_card_css(self):
        return self.show_code()("# the look of the KPI cards\n'.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }\\n.kpi { padding: 12px 14px; border-radius: 10px; background: light-dark(#f2f5ed, #1c1f1a); }\\n.kpi b { display: block; font-size: 26px; }\\n.kpi span { color: light-dark(#5d6459, #9da397); font-size: 13px; }\\n.kpi.warn b { color: #d64545; }'", 'Input · card_css')

    @cell("A11", label="code_kpis")
    @computed
    def code_kpis(self):
        return self.show_code()('from html import escape\ntiles = [\n    (f"{revenue_total:,.0f} €", "revenue this year", False),\n    (f"{open_invoices}", "open invoices", open_invoices > 5),\n    (f"{margin:.0%}", "margin", margin < 0.2),\n]\ncards = "".join(\n    f"<div class=\'kpi{\' warn\' if warn else \'\'}\'><b>{escape(value)}</b><span>{escape(label)}</span></div>"\n    for value, label, warn in tiles\n)\nreturn html(f"<style>{card_css}</style><div class=\'kpis\'>{cards}</div>")', 'Formula · kpis')

    @cell("A12", label="code_StarRating")
    @computed
    def code_StarRating(self):
        return self.show_code()('import anywidget\nimport traitlets\n\nclass StarRating(anywidget.AnyWidget):\n    """Five stars; clicking one sets the rating."""\n\n    _esm = """\n    function render({ model, el }) {\n      const draw = () => {\n        el.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {\n          const star = document.createElement("button");\n          star.textContent = n <= model.get("value") ? "★" : "☆";\n          star.setAttribute("aria-label", `${n} stars`);\n          star.addEventListener("click", () => {\n            model.set("value", n);      // change it in the browser…\n            model.save_changes();       // …and send it to Python\n          });\n          return star;\n        }));\n      };\n      model.on("change:value", draw);   // redraw when the value changes\n      draw();\n    }\n    export default { render };\n    """\n\n    _css = """\n    button { font-size: 30px; border: 0; background: none; color: #e0a100; cursor: pointer; }\n    """\n\n    value = traitlets.Int(0).tag(sync=True)', 'Formula · StarRating')

    @cell("A13", label="code_rating")
    @computed
    def code_rating(self):
        return self.show_code()('# the rating, 0-5 (the stars write it)\n4', 'Input · rating')

    @cell("A14", label="code_stars")
    @computed
    def code_stars(self):
        return self.show_code()('bind(StarRating(), value=rating)', 'Formula · stars')

    @cell("A15", label="code_verdict")
    @computed
    def code_verdict(self):
        return self.show_code()('"Loved it" if rating >= 4 else "It was fine" if rating >= 2 else "Not for me"', 'Formula · verdict')

    @cell("A16", label="code_stars_note")
    @computed
    def code_stars_note(self):
        return self.show_code()('How was the workshop? {{ stars }}\n\nYou gave **{{ rating }}** stars: {{ verdict }}.', 'In a note')

    @cell("A17", label="code_drag")
    @computed
    def code_drag(self):
        return self.show_code()('dot.addEventListener("pointermove", (event) => { if (dragging) { point = position(event); draw(); } });\ndot.addEventListener("pointerup", () => { dragging = false; commit(); });', 'JavaScript · drag, then save once')

    @cell("A18", label="code_copy_first")
    @computed
    def code_copy_first(self):
        return self.show_code()('const commit = () => {\n  const { x, y } = point;          // copy first: set() runs change listeners at once\n  model.set("x", x);\n  model.set("y", y);\n  model.save_changes();            // x and y travel together\n};', 'JavaScript · copy before you set')

    @cell("A19", label="code_error")
    @computed
    def code_error(self):
        return self.show_code()("WidgetStateError: Cell B3 reads StarRating.value, but a widget's state is not part of the graph.\nKeep the value in an input cell and bind it: bind(widget, value=my_input), then read my_input.", 'What you get when a cell reads a widget')

    @cell("A20", label="code_math_note")
    @computed
    def code_math_note(self):
        return self.show_code()('The monthly payment is $P = \\frac{rL}{1-(1+r)^{-n}}$ = **{{ payment }}** €.\n\n```mermaid\nflowchart LR\n  Income -- "{{ income }}" --> Budget -- "{{ savings }}" --> Savings\n```\n\nBack to [the controls](#note-guide_controls)', 'In a note')

    @cell("A21", label="code_file")
    @computed
    def code_file(self):
        return self.show_code()('class WidgetsWorksheet(Worksheet["GuideWorkbook"]):\n\n    # the rating, 0-5 (the stars write it)\n    rating = cell("A2", field(4), label="rating")\n\n    @cell("B1", label="stars")\n    @computed\n    def stars(self):\n        return bind(self.StarRating()(), value=self.rating())\n\n    @cell("B2", label="verdict")\n    @computed\n    def verdict(self):\n        return "Loved it" if self.rating() >= 4 else "It was fine" if self.rating() >= 2 else "Not for me"', 'guide.workbook.py')


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Reaktiv Workbook guide",
        "layout": {"noteOrder": ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]},
    }
)
class ReaktivWorkbookGuideWorkbook(Workbook):
    Start = worksheet(
        StartWorksheet,
        grid={"columns": 6, "rows": 12},
        layout={"columnWidths": {"A": 200, "B": 220, "E": 260}},
    )
    Data = worksheet(
        DataWorksheet,
        grid={"columns": 4, "rows": 8},
        layout={"columnWidths": {"A": 260}},
    )
    HTML = worksheet(
        HTMLWorksheet,
        grid={"columns": 4, "rows": 6},
        layout={"columnWidths": {"A": 200, "B": 260}},
    )
    Widgets = worksheet(
        WidgetsWorksheet,
        grid={"columns": 4, "rows": 6},
        layout={"columnWidths": {"A": 220, "B": 240}},
    )
    Snippets = worksheet(
        SnippetsWorksheet,
        grid={"columns": 3, "rows": 30},
        layout={"columnWidths": {"A": 240, "B": 240, "C": 240}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
