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
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["PlotlySalesExplorerWorkbook"]):
    region = cell(
        "A1",
        field("All"),
        label="region",
        view={
            "widget": {"type": "select", "options": ["All", "North", "South", "West"]}
        },
    )

    @cell("B1", label="selected")
    @computed
    def selected(self):
        # orders of the selected region
        return [order for order in self.orders() if self.region() == "All" or order[1] == self.region()]

    @cell("C1", label="trend_chart", view={"display": "rendered", "span": [3, 8]})
    @computed
    def trend_chart(self):
        import plotly.graph_objects as go

        figure = go.Figure()
        figure.add_bar(x=list(self.monthly_revenue()), y=list(self.monthly_revenue().values()), name="Actual", marker_color="#2a78d6")
        figure.add_scatter(
            x=[list(self.monthly_revenue())[-1], *self.forecast()],
            y=[list(self.monthly_revenue().values())[-1], *self.forecast().values()],
            name=f"Forecast (+{self.growth()}%/month)",
            mode="lines+markers",
            line=dict(color="#eb6834", dash="dash"),
        )
        figure.update_layout(**self.chart_layout()(f"Revenue · {self.region()}", yaxis_tickprefix="$"))
        return figure

    REGION_COLORS = cell(
        "G1",
        field({"North": "#2a78d6", "South": "#eb6834", "West": "#1baf7a"}),
        label="REGION_COLORS",
    )

    # forecast growth per month, in percent
    growth = cell(
        "A2",
        field(4),
        label="growth",
        view={"widget": {"type": "range", "min": 0, "max": 15, "step": 1}},
    )

    @cell("B2", label="monthly_revenue")
    @computed
    def monthly_revenue(self):
        totals = {}
        for month, _region, revenue, _units in self.selected():
            totals[month] = totals.get(month, 0) + revenue
        return totals

    MONTHS = cell(
        "G2",
        field(
            ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        ),
        label="MONTHS",
    )

    forecast_months = cell(
        "A3",
        field(6),
        label="forecast_months",
        view={"widget": {"type": "range", "min": 1, "max": 6, "step": 1}},
    )

    @cell("B3", label="forecast")
    @computed
    def forecast(self):
        # compound growth from the last actual month
        last = list(self.monthly_revenue().values())[-1]
        start = self.MONTHS().index(list(self.monthly_revenue())[-1]) + 1
        return {self.MONTHS()[start + i]: round(last * (1 + self.growth() / 100) ** (i + 1)) for i in range(self.forecast_months())}

    @cell("G3", label="money")
    @computed
    def money(self):
        def money(amount):
            """$1.2M / $85k / $950 — short currency for KPIs and hover labels."""
            if abs(amount) >= 1_000_000:
                return f"${amount / 1_000_000:.1f}M"
            if abs(amount) >= 1_000:
                return f"${amount / 1_000:.0f}k"
            return f"${amount:,.0f}"

        return money

    orders = cell(
        "A4",
        field(
            [
        # (month, region, revenue, units)
        ("Jan", "North", 92000, 410), ("Jan", "South", 73000, 350), ("Jan", "West", 88000, 395),
        ("Feb", "North", 97000, 430), ("Feb", "South", 79000, 362), ("Feb", "West", 84000, 380),
        ("Mar", "North", 101000, 452), ("Mar", "South", 83000, 371), ("Mar", "West", 94000, 420),
        ("Apr", "North", 108000, 470), ("Apr", "South", 81000, 366), ("Apr", "West", 99000, 441),
        ("May", "North", 115000, 498), ("May", "South", 91000, 402), ("May", "West", 106000, 460),
        ("Jun", "North", 121000, 520), ("Jun", "South", 96000, 418), ("Jun", "West", 112000, 488),
    ]
        ),
        label="orders",
    )

    @cell("B4", label="total_revenue")
    @computed
    def total_revenue(self):
        return sum(order[2] for order in self.selected())

    @cell("G4", label="chart_layout")
    @computed
    def chart_layout(self):
        def chart_layout(title, **extra):
            """One look for every chart in this workbook."""
            return dict(
                title=dict(text=title, x=0, font=dict(size=15)),
                template="plotly_white",
                height=380,
                margin=dict(l=48, r=16, t=56, b=40),
                legend=dict(orientation="h", y=-0.18),
                **extra,
            )

        return chart_layout

    @cell("B5", label="year_outlook")
    @computed
    def year_outlook(self):
        return self.total_revenue() + sum(self.forecast().values())

    @cell("A7", label="explorer")
    @markdown
    def explorer(self):
        return """# 📈 Plotly sales explorer

        [Region: {{ self.region() }}](#sheet-input:region?type=select&options=All,North,South,West)

        [Growth: {{ self.growth() }}](#sheet-input:growth?type=range&min=0&max=15&step=1)

        **{{ self.region() }}** made **{{ self.money()(self.total_revenue()) }}** in the first half. With **{{ self.growth() }}%** growth per month the outlook for the year is **{{ self.money()(self.year_outlook()) }}**.

        {{ self.trend_chart() }}

        ## Where it comes from

        {{ self.region_chart() }}

        {{ self.units_chart() }}

        Charts are interactive: hover for values, drag to zoom, double-click to reset. Every chart is an ordinary Python cell returning a `plotly` figure; `money()` and `chart_layout()` are function cells (G3, G4), so the graph shows which charts use them."""

    @cell("C9", label="region_chart", view={"display": "rendered", "span": [2, 8]})
    @computed
    def region_chart(self):
        import plotly.graph_objects as go

        by_region = {}
        for _month, name, revenue, _units in self.orders():
            by_region[name] = by_region.get(name, 0) + revenue
        return go.Figure(
            go.Pie(
                labels=list(by_region),
                values=list(by_region.values()),
                hole=0.55,
                marker_colors=[self.REGION_COLORS()[name] for name in by_region],
                pull=[0.08 if name == self.region() else 0 for name in by_region],
            ),
            layout=self.chart_layout()("Revenue by region"),
        )

    @cell("E9", label="units_chart", view={"display": "rendered", "span": [2, 8]})
    @computed
    def units_chart(self):
        import plotly.graph_objects as go

        figure = go.Figure()
        for name, color in self.REGION_COLORS().items():
            rows = [order for order in self.orders() if order[1] == name]
            figure.add_scatter(
                x=[order[3] for order in rows],
                y=[order[2] for order in rows],
                text=[order[0] for order in rows],
                mode="markers",
                name=name,
                marker=dict(color=color, size=11, opacity=0.35 if self.region() not in ("All", name) else 0.9),
                hovertemplate="%{text}: %{x} units, $%{y:,.0f}<extra>" + name + "</extra>",
            )
        figure.update_layout(**self.chart_layout()("Units vs revenue", xaxis_title="Units", yaxis_tickprefix="$"))
        return figure


@workbook_config({"formatVersion": 2, "name": "Plotly sales explorer"})
class PlotlySalesExplorerWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 8, "rows": 18},
        layout={
            "columnWidths": {
                "A": 170,
                "B": 180,
                "C": 240,
                "D": 240,
                "E": 240,
                "F": 240,
                "G": 260,
            },
            "zoom": 0.9,
        },
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
