# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "plotly",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import math

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class BudgetWorksheet(Worksheet["MonthlyBudgetWorkbook"]):
    income = cell(
        "A1",
        field(3200),
        label="income",
        view={
            "widget": {"type": "number", "min": 0, "step": 50, "label": "Net income"}
        },
    )

    @cell("B1", label="spending")
    @computed
    def spending(self):
        return {"Housing": self.housing(), "Food": self.food(), "Transport": self.transport(), "Fun": self.fun(), "Other": self.other()}

    @cell("C1", label="spending_chart", view={"display": "rendered", "span": [2, 6]})
    @computed
    def spending_chart(self):
        import plotly.graph_objects as go

        return go.Figure(
            go.Pie(labels=list(self.spending()), values=list(self.spending().values()), hole=0.55, sort=False,
                   marker_colors=["#7157d9", "#2a78d6", "#1baf7a", "#eb6834", "#a3a3a3"]),
            layout=dict(template="plotly_white", height=300, margin=dict(l=8, r=8, t=8, b=8),
                        annotations=[dict(text=f"€{self.spent():,.0f}", showarrow=False, font=dict(size=18))]),
        )

    @cell("E1", label="savings_chart", view={"display": "rendered", "span": [3, 6]})
    @computed
    def savings_chart(self):
        import plotly.graph_objects as go

        months = list(range(0, 13))
        figure = go.Figure()
        figure.add_scatter(x=months, y=[max(self.saved(), 0) * m for m in months], mode="lines+markers", name="Savings",
                           line=dict(color="#1baf7a", width=3))
        figure.add_hline(y=self.goal(), line_dash="dash", line_color="#eb6834", annotation_text="goal")
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=48, r=16, t=16, b=40),
                             xaxis_title="months", yaxis_title="saved (€)", showlegend=False)
        return figure

    @cell("H1", label="budget")
    @markdown
    def budget(self):
        return """# 💶 Monthly budget

        Set your income and move the sliders. Everything below follows.

        [Net income: {{ self.income() }}](#sheet-input:income?type=number&min=0&step=50)

        ## Where the money goes

        [Housing: {{ self.housing() }}](#sheet-input:housing?type=range&min=0&max=3000&step=10)

        [Food: {{ self.food() }}](#sheet-input:food?type=range&min=0&max=1500&step=10)

        [Transport: {{ self.transport() }}](#sheet-input:transport?type=range&min=0&max=800&step=10)

        [Fun & eating out: {{ self.fun() }}](#sheet-input:fun?type=range&min=0&max=1200&step=10)

        [Other: {{ self.other() }}](#sheet-input:other?type=range&min=0&max=1000&step=10)

        {{ self.spending_chart() }}

        You spend **€{{ round(self.spent()) }}** and keep **€{{ round(self.saved()) }}** — **{{ round(self.savings_rate() * 100) }}%**
        of your income.

        {{ self.verdict() }}

        ## Saving for a goal

        [Savings goal: {{ self.goal() }}](#sheet-input:goal?type=number&min=0&step=500)

        {{ self.goal_text() }}

        {{ self.savings_chart() }}"""

    housing = cell(
        "A2",
        field(1150),
        label="housing",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 3000,
                "step": 10,
                "label": "Housing",
            }
        },
    )

    @cell("B2", label="spent")
    @computed
    def spent(self):
        return sum(self.spending().values())

    food = cell(
        "A3",
        field(420),
        label="food",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 1500,
                "step": 10,
                "label": "Food",
            }
        },
    )

    @cell("B3", label="saved")
    @computed
    def saved(self):
        return self.income() - self.spent()

    transport = cell(
        "A4",
        field(180),
        label="transport",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 800,
                "step": 10,
                "label": "Transport",
            }
        },
    )

    @cell("B4", label="savings_rate")
    @computed
    def savings_rate(self):
        return self.saved() / self.income() if self.income() else 0

    fun = cell(
        "A5",
        field(260),
        label="fun",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 1200,
                "step": 10,
                "label": "Fun & eating out",
            }
        },
    )

    @cell("B5", label="months_to_goal")
    @computed
    def months_to_goal(self):
        # months until the goal; None when nothing is saved
        return math.ceil(self.goal() / self.saved()) if self.saved() > 0 else None

    other = cell(
        "A6",
        field(150),
        label="other",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 1000,
                "step": 10,
                "label": "Other",
            }
        },
    )

    @cell("B6", label="verdict")
    @computed
    def verdict(self):
        if self.savings_rate() >= 0.2:
            return "✅ Great: you save at least a fifth of your income."
        if self.savings_rate() >= 0.1:
            return "👍 Good: aim for 20% if you can."
        if self.saved() > 0:
            return "⚠️ Tight: small cuts in the biggest category help most."
        return "🛑 You spend more than you earn this month."

    goal = cell(
        "A7",
        field(6000),
        label="goal",
        view={
            "widget": {"type": "number", "min": 0, "step": 500, "label": "Savings goal"}
        },
    )

    @cell("B7", label="goal_text")
    @computed
    def goal_text(self):
        if self.months_to_goal() is None:
            return "Save something each month to reach it."
        return f"At this pace you reach it in {self.months_to_goal()} months."


@workbook_config({"formatVersion": 2, "name": "Monthly budget"})
class MonthlyBudgetWorkbook(Workbook):
    Budget = worksheet(BudgetWorksheet, grid={"columns": 10, "rows": 8})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
