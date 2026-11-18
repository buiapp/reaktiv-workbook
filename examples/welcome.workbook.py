# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "plotly",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    action,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class WelcomeWorksheet(Worksheet["WelcomeToReaktivWorkbookWorkbook"]):
    # price of one cup, in euros
    price = cell(
        "A1",
        field(3.5),
        label="price",
        view={
            "widget": {
                "type": "range",
                "min": 1,
                "max": 8,
                "step": 0.5,
                "label": "Price per cup",
            }
        },
    )

    @cell("B1", label="revenue")
    @computed
    def revenue(self):
        return self.price() * self.sold()

    @cell("C1", label="price_chart", view={"display": "rendered", "span": [2, 6]})
    @computed
    def price_chart(self):
        import plotly.graph_objects as go

        prices = [step / 10 for step in range(10, 81)]
        figure = go.Figure()
        figure.add_scatter(x=prices, y=[(p - self.cost()) * self.cups() * (3.5 / p) ** 1.6 * self.days() for p in prices], mode="lines", name="Profit per month",
                           line=dict(color="#7157d9", width=3))
        figure.add_scatter(x=[self.price()], y=[self.monthly_profit()], mode="markers", name="Your price",
                           marker=dict(color="#eb6834", size=14))
        figure.update_layout(template="plotly_white", height=320, margin=dict(l=48, r=16, t=40, b=40),
                             title=dict(text="Profit per month at each price", x=0, font=dict(size=14)),
                             xaxis_title="price per cup (€)", yaxis_title="profit (€)", showlegend=False)
        return figure

    @cell("E1", label="welcome")
    @markdown
    def welcome(self):
        return """# Welcome to Reaktiv Workbook 👋

        A workbook is a **reactive model with notes**: you write down how things are calculated
        once, and every number, sentence and chart that depends on a value updates the moment you
        change it. Nothing else reruns.

        This workbook is a tiny coffee stand. Move the sliders:

        [Price per cup: {{ self.price() }}](#sheet-input:price?type=range&min=1&max=8&step=0.5)

        [Cups per day at 3.50 €: {{ self.cups() }}](#sheet-input:cups?type=range&min=0&max=400&step=10)

        At this price you sell **{{ self.sold() }}** cups a day, make **{{ self.euro()(self.revenue()) }}** and keep
        **{{ self.euro()(self.profit()) }}** after costs — about **{{ self.euro()(self.monthly_profit()) }}** a month.
        The most profitable price is **{{ self.euro()(self.best_price()) }}**.

        {{ self.price_chart() }}

        The notes on the left explain what just happened, one idea at a time."""

    # cups a day at the usual price of 3.50 €
    cups = cell(
        "A2",
        field(120),
        label="cups",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 400,
                "step": 10,
                "label": "Cups per day at 3.50 €",
            }
        },
    )

    @cell("B2", label="profit")
    @computed
    def profit(self):
        return (self.price() - self.cost()) * self.sold()

    @cell("E2", label="cell_basics")
    @markdown
    def cell_basics(self):
        return """# 1 · Cells

        Everything in a workbook is a **cell**. Open the **Cells** view to see them in a grid:

        - **Inputs** hold values you set: `price`, `cups`, `cost`. A widget is just a nicer way
          to change an input.
        - **Formulas** compute a value from other cells: `revenue` is `price * cups`. You never
          run them by hand.
        - **Notes** like this one are cells too. Put a label or a short expression between double
          curly braces and its current value appears in the text: profit per cup is
          **{{ self.euro()(self.price() - self.cost()) }}**.

        Every cell has a position (like `B1`) and, ideally, a **label** (like `revenue`). Formulas
        use labels, so moving a cell never breaks anything."""

    # what one cup costs you
    cost = cell(
        "A3",
        field(1.2),
        label="cost",
        view={
            "widget": {"type": "number", "min": 0, "step": 0.1, "label": "Cost per cup"}
        },
    )

    @cell("B3", label="days")
    @computed
    def days(self):
        return {"Weekdays": 22, "Every day": 30, "Weekends": 8}[self.schedule()]

    @cell("E3", label="reactivity")
    @markdown
    def reactivity(self):
        return """# 2 · Reactivity

        When an input changes, Reaktiv Workbook knows exactly which cells read it. Only those
        recompute — then the cells that read *them*, and so on.

        Change the cost per cup:

        [Cost per cup: {{ self.cost() }}](#sheet-input:cost?type=number&min=0&step=0.1)

        `profit`, `monthly_profit` and `best_price` update; `revenue` and `sold` do not,
        because they never read `cost`.
        Open the **Graph** view to see these connections as arrows. Select a cell to highlight
        what it reads and what reads it."""

    schedule = cell(
        "A4",
        field("Weekdays"),
        label="schedule",
        view={
            "widget": {
                "type": "select",
                "options": ["Weekdays", "Every day", "Weekends"],
                "label": "Open on",
            }
        },
    )

    @cell("B4", label="monthly_profit")
    @computed
    def monthly_profit(self):
        return self.profit() * self.days()

    @cell("E4", label="widgets")
    @markdown
    def widgets(self):
        return """# 3 · Widgets and charts

        Inputs can be shown as sliders, number fields, dropdowns, checkboxes, dates, lists and
        buttons — in a note or in the grid.

        [Open on: {{ self.schedule() }}](#sheet-input:schedule?type=select&options=Weekdays,Every%20day,Weekends)

        That is **{{ self.days() }}** days a month. A formula can return a chart (Plotly, Matplotlib), a
        table (pandas) or HTML, and a note shows it like any other value — this chart is the
        `price_chart` cell:

        {{ self.price_chart() }}"""

    # sales recorded with the action
    sales = cell("A5", field([]), label="sales")

    @cell("B5", label="recorded")
    @computed
    def recorded(self):
        return sum(self.sales())

    @cell("E5", label="actions")
    @markdown
    def actions(self):
        return """# 4 · Actions

        Formulas must not change things — they only compute. To *do* something (record a sale,
        send a request, write a file) a workbook has **actions**: Python methods you run with a
        button.

        [Record a sale](#sheet-action:record_sale) [Start over](#sheet-action:start_over)

        Recorded so far: **{{ self.euro()(self.recorded()) }}** in **{{ len(self.sales()) }}** sales. The action wrote
        to the `sales` input, and everything that reads it updated."""

    @cell("B6", label="euro")
    @computed
    def euro(self):
        def euro(value):
            """€1,234.50"""
            return f"€{value:,.2f}"

        return euro

    @cell("E6", label="python_file")
    @markdown
    def python_file(self):
        return """# 5 · It is a Python file

        Saving writes an ordinary Python file: one class per worksheet, one attribute or method
        per cell. You can read it in a code review, track it with Git, and run it:

        ```python
        book = WelcomeWorkbook()
        book.Welcome.price.set(4)
        book.Welcome.monthly_profit()   # recomputed for the new price
        ```

        **Next steps**

        - Press **Edit** to change cells and notes; **View** keeps the page clean for reading.
        - Try the other examples: a monthly budget, a trip planner, dashboards and planners.
        - From a terminal: `reaktiv-workbook edit my.workbook.py` creates your own workbook, and
          `reaktiv-workbook run my.workbook.py` shows it as an app."""

    @cell("B7", label="sold")
    @computed
    def sold(self):
        # fewer people buy when the price goes up
        return round(self.cups() * (3.5 / self.price()) ** 1.6)

    @cell("B8", label="best_price")
    @computed
    def best_price(self):
        # the price with the most profit per month
        prices = [step / 10 for step in range(10, 81)]
        return max(prices, key=lambda p: (p - self.cost()) * self.cups() * (3.5 / p) ** 1.6)


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Welcome to Reaktiv Workbook",
        "layout": {
            "noteOrder": ["E1", "E2", "E3", "E4", "E5", "E6"],
            "noteParents": {"E2": "E1", "E3": "E1", "E4": "E1", "E5": "E1", "E6": "E1"},
        },
    }
)
class WelcomeToReaktivWorkbookWorkbook(Workbook):
    Welcome = worksheet(WelcomeWorksheet, grid={"columns": 8, "rows": 8})

    @action(label="Record a sale")
    def record_sale(self):
        """Sell one cup at the current price."""
        self.Welcome.sales.update(lambda sales: [*sales, self.Welcome.price()])

    @action(label="Start over")
    def start_over(self):
        """Clear the recorded sales."""
        self.Welcome.sales.set([])


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
