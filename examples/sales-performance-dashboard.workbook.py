# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "pandas",
#   "matplotlib",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field, resource
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    artifact,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["SalesPerformanceDashboardWorkbook"]):
    selected_region = cell(
        "A1",
        field("All"),
        label="selected_region",
        view={
            "widget": {"type": "select", "options": ["All", "North", "South", "West"]}
        },
    )

    @cell("B1", label="filtered_orders")
    @computed
    def filtered_orders(self):
        rows = self.orders_feed.value()
        columns = ("month", "region", "channel", "sales", "returned")
        rows = [dict(zip(columns, row)) if not isinstance(row, dict) else row for row in rows]
        if self.selected_region() != "All":
            rows = [row for row in rows if row["region"] == self.selected_region()]
        if self.selected_channel() != "All":
            rows = [row for row in rows if row["channel"] == self.selected_channel()]
        if not self.include_returns():
            rows = [row for row in rows if not row["returned"]]
        return rows

    @cell("C1", label="orders_feed", resource_mode="simple")
    @resource
    def orders_feed(self):
        return {"data_url": self.data_url(), "orders": self.orders()}

    @orders_feed.loader
    async def _orders_feed_loader(self, resource_params):
        url = resource_params.params["data_url"]
        if not url:
            return resource_params.params["orders"]
        import json
        from urllib.request import urlopen

        with urlopen(url, timeout=10) as response:
            payload = json.load(response)
        rows = payload.get("orders", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise ValueError("The data URL must return a JSON list or an object with an 'orders' list.")
        return rows

    @cell("D1", label="monthly_sales_chart")
    @computed
    def monthly_sales_chart(self):
        import io
        import matplotlib.pyplot as plt
        import pandas as pd

        frame = pd.DataFrame(self.filtered_orders())
        totals = frame.groupby("month", sort=False)["sales"].sum()
        figure, axes = plt.subplots(figsize=(8.2, 3.6))
        colors = ["#7157d9" if value >= 0 else "#d66161" for value in totals]
        axes.bar(totals.index, totals.values, color=colors, width=0.68)
        axes.axhline(0, color="#556052", linewidth=0.8)
        axes.set(title=f"Monthly net sales · {self.selected_region()}", ylabel="Sales")
        axes.grid(axis="y", alpha=0.18)
        axes.spines[["top", "right"]].set_visible(False)
        figure.tight_layout()
        output = io.BytesIO()
        figure.savefig(output, format="png", dpi=144, bbox_inches="tight")
        plt.close(figure)
        return artifact(output, "monthly-sales.png", "image/png")

    @cell("E1", label="executive_report")
    @markdown
    def executive_report(self):
        return """# Sales performance report

        Use the controls below to explore the report without editing Python or spreadsheet cells.

        [Region: {{ self.selected_region() }}](#sheet-input:selected_region?type=select&options=All,North,South,West)

        [Growth target: {{ self.growth_target() }}](#sheet-input:growth_target?type=range&min=0&max=0.25&step=0.01)

        [Include returns: {{ self.include_returns() }}](#sheet-input:include_returns?type=checkbox)

        [Channel: {{ self.selected_channel() }}](#sheet-input:selected_channel?type=select&options=All,Direct,Online,Partner)

        ## Executive summary

        | KPI | Current view |
        | --- | ---: |
        | Net sales | **{{ self.headline_metrics()['net_sales'] }}** |
        | Average positive order | {{ self.headline_metrics()['average_order'] }} |
        | Included records | {{ self.headline_metrics()['records'] }} |
        | Growth | {{ self.growth_attainment()['actual'] }} |
        | Target | {{ self.growth_attainment()['target'] }} |
        | Assessment | **{{ self.growth_attainment()['status'] }}** |

        ### Channel mix

        | Channel | Share of net sales |
        | --- | ---: |
        | Direct | {{ self.channel_mix().get('Direct', '0.0%') }} |
        | Online | {{ self.channel_mix().get('Online', '0.0%') }} |
        | Partner | {{ self.channel_mix().get('Partner', '0.0%') }} |

        {{ self.monthly_sales_chart() }}

        {{ self.regional_sales_chart() }}

        ## Bring your own data

        [JSON data URL: {{ self.data_url() }}](#sheet-input:data_url?type=text)

        Leave the URL blank for the embedded, offline-safe demo. To load web data, enter a
        CORS-enabled URL returning a JSON list (or an object with an `orders` list) containing
        `month`, `region`, `channel`, `sales`, and `returned` fields. The async resource reloads
        the report while keeping the calculation graph reactive.

        > This report, its controls, calculations, and chart are stored in one reviewable Python file.
        Changing a control updates only its reactive dependents."""

    growth_target = cell(
        "A2",
        field(0.08),
        label="growth_target",
        view={"widget": {"type": "range", "min": 0, "max": 0.25, "step": 0.01}},
    )

    @cell("B2", label="headline_metrics")
    @computed
    def headline_metrics(self):
        rows = self.filtered_orders()
        sales = float(sum(row["sales"] for row in rows))
        positive_sales = [row["sales"] for row in rows if row["sales"] > 0]
        average = float(sum(positive_sales) / len(positive_sales))
        return {
            "net_sales": f"${sales:,.0f}",
            "average_order": f"${average:,.0f}",
            "records": len(rows),
        }

    @cell("C2", label="channel_mix")
    @computed
    def channel_mix(self):
        totals = {}
        for row in self.filtered_orders():
            totals[row["channel"]] = totals.get(row["channel"], 0) + row["sales"]
        total = float(sum(totals.values()))
        return {
            channel: f"{value / total:.1%}" if total else "0.0%"
            for channel, value in totals.items()
        }

    @cell("D2", label="regional_sales_chart")
    @computed
    def regional_sales_chart(self):
        import io
        import matplotlib.pyplot as plt
        import pandas as pd

        frame = pd.DataFrame(self.filtered_orders())
        totals = frame.groupby("region")["sales"].sum().sort_values()
        figure, axes = plt.subplots(figsize=(8.2, 2.8))
        axes.barh(totals.index, totals.values, color="#8aa64a")
        axes.set(title="Net sales by region", xlabel="Sales")
        axes.grid(axis="x", alpha=0.18)
        axes.spines[["top", "right"]].set_visible(False)
        figure.tight_layout()
        output = io.BytesIO()
        figure.savefig(output, format="png", dpi=144, bbox_inches="tight")
        plt.close(figure)
        return artifact(output, "regional-sales.png", "image/png")

    include_returns = cell(
        "A3",
        field(False),
        label="include_returns",
        view={"widget": {"type": "checkbox"}},
    )

    @cell("B3", label="growth_attainment")
    @computed
    def growth_attainment(self):
        totals = {}
        for row in self.filtered_orders():
            totals[row["month"]] = totals.get(row["month"], 0) + row["sales"]
        values = list(totals.values())
        baseline = float(sum(values[:3]) / len(values[:3]))
        current = float(sum(values[3:]) / len(values[3:]))
        actual_growth = 0.0 if baseline == 0 else current / baseline - 1
        return {
            "actual": f"{actual_growth:.1%}",
            "target": f"{self.growth_target():.1%}",
            "status": "On track" if actual_growth >= self.growth_target() else "Below target",
        }

    selected_channel = cell(
        "A4",
        field("All"),
        label="selected_channel",
        view={
            "widget": {
                "type": "select",
                "options": ["All", "Direct", "Online", "Partner"],
            }
        },
    )

    data_url = cell(
        "A5", field(""), label="data_url", view={"widget": {"type": "text"}}
    )

    orders = cell(
        "A6",
        field(
            [("Jan", "North", "Direct", 92000, False), ("Jan", "South", "Partner", 73000, False), ("Jan", "West", "Online", 88000, False), ("Feb", "North", "Direct", 97000, False), ("Feb", "South", "Online", 79000, False), ("Feb", "West", "Partner", -9000, True), ("Mar", "North", "Partner", 101000, False), ("Mar", "South", "Direct", 83000, False), ("Mar", "West", "Online", 94000, False), ("Apr", "North", "Online", 108000, False), ("Apr", "South", "Partner", -7000, True), ("Apr", "West", "Direct", 99000, False), ("May", "North", "Direct", 115000, False), ("May", "South", "Online", 91000, False), ("May", "West", "Partner", 106000, False), ("Jun", "North", "Online", 121000, False), ("Jun", "South", "Direct", 96000, False), ("Jun", "West", "Partner", 112000, False)]
        ),
        label="orders",
    )


@workbook_config({"formatVersion": 2, "name": "Sales performance dashboard"})
class SalesPerformanceDashboardWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 12, "rows": 20},
        layout={
            "columnWidths": {"A": 190, "B": 180, "C": 210, "D": 330, "E": 440},
            "rowHeights": {"1": 88, "2": 170, "3": 80},
            "zoom": 0.9,
        },
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
