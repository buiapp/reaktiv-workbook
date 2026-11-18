# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "numpy",
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "plotly",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import numpy as np

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class ModelWorksheet(Worksheet["MarketsWorkbook"]):
    # quantity people want at a price of zero
    demand_max = cell(
        "A1",
        field(120),
        label="demand_max",
        view={"widget": {"type": "range", "min": 60, "max": 200, "step": 5}},
    )

    @cell("B1", label="demanded")
    @computed
    def demanded(self):
        return max(self.demand_max() - self.demand_slope() * self.test_price(), 0)

    @cell("C1", label="market", view={"display": "rendered", "span": [2, 8]})
    @computed
    def market(self):
        import plotly.graph_objects as go

        prices = np.linspace(0, 30, 61)
        figure = go.Figure(go.Scatter(x=self.demand_max() - self.demand_slope() * prices, y=prices, name="demand", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=self.supply_slope() * prices, y=prices, name="supply", line=dict(color="#eb6834", width=3))
        figure.add_hline(y=self.test_price(), line_dash="dot", line_color="#8b8b84", annotation_text="price to try")
        figure.add_scatter(x=[self.quantity()], y=[self.price()], mode="markers", name="equilibrium", marker=dict(color="#7157d9", size=12))
        figure.update_layout(**self.chart_layout()("Market for one product", "quantity", "price (€)", xaxis_range=[0, 200], yaxis_range=[0, 30]))
        return figure

    @cell("E1", label="chart_layout")
    @computed
    def chart_layout(self):
        # one look for every chart of the course
        def chart_layout(title, x_title, y_title, **extra):
            settings = dict(
                title=dict(text=title, x=0, font=dict(size=15)),
                template="plotly_white",
                height=340,
                margin=dict(l=56, r=16, t=56, b=48),
                xaxis_title=x_title,
                yaxis_title=y_title,
                legend=dict(orientation="h", y=-0.28),
            )
            settings.update(extra)
            return settings

        return chart_layout

    @cell("F1", label="p1_demand_and_supply")
    @markdown
    def p1_demand_and_supply(self):
        return """# 1 · Demand and supply

        Buyers want more when the price is low: the **demand** line falls. Sellers offer more when
        it is high: the **supply** line rises. Try a price and see whether the two sides agree.

        [Price to try (€): {{ self.test_price() }}](#sheet-input:test_price?type=range&min=0&max=30&step=0.5)

        {{ self.market() }}

        At **{{ self.test_price() }} €**, buyers want **{{ self.demanded() }}** units and sellers offer
        **{{ self.supplied() }}**: there is **{{ self.situation() }}**.

        $$Q_d = a - b \\cdot P \\qquad Q_s = d \\cdot P$$

        ## Check yourself

        - Find the price at which nothing is left over and nobody goes without.
        - What do sellers do when there is a surplus?

        ---

        **Next:** [2 · Equilibrium](#note-p2_equilibrium)"""

    # how much less they buy per € of price
    demand_slope = cell(
        "A2",
        field(4),
        label="demand_slope",
        view={"widget": {"type": "range", "min": 1, "max": 10, "step": 0.5}},
    )

    @cell("B2", label="supplied")
    @computed
    def supplied(self):
        return self.supply_slope() * self.test_price()

    @cell("F2", label="p2_equilibrium")
    @markdown
    def p2_equilibrium(self):
        return """# 2 · Equilibrium

        The price you just found is the **equilibrium**: the only price at which the quantity
        demanded equals the quantity supplied. Change the market and it moves.

        [Demand at price 0: {{ self.demand_max() }}](#sheet-input:demand_max?type=range&min=60&max=200&step=5)

        [Demand falls per €: {{ self.demand_slope() }}](#sheet-input:demand_slope?type=range&min=1&max=10&step=0.5)

        [Supply rises per €: {{ self.supply_slope() }}](#sheet-input:supply_slope?type=range&min=1&max=12&step=0.5)

        {{ self.market() }}

        The market settles at **{{ self.price() }} €** and **{{ self.quantity() }} units**.

        $$Q_d = Q_s \\;\\Rightarrow\\; P^* = \\frac{a}{b + d}$$

        ## Check yourself

        - The product becomes fashionable (more demand). What happens to price and quantity?
        - Production gets cheaper (steeper supply). What happens now?

        ---

        **Previous:** [1 · Demand and supply](#note-p1_demand_and_supply) · **Next:** [3 · A tax](#note-p3_a_tax)"""

    # how much more is offered per € of price
    supply_slope = cell(
        "A3",
        field(6),
        label="supply_slope",
        view={"widget": {"type": "range", "min": 1, "max": 12, "step": 0.5}},
    )

    @cell("B3", label="situation")
    @computed
    def situation(self):
        gap = round(self.supplied() - self.demanded(), 1)
        return f"a surplus of {gap} units" if gap > 0 else f"a shortage of {-gap} units" if gap < 0 else "balance"

    @cell("F3", label="p3_a_tax")
    @markdown
    def p3_a_tax(self):
        return """# 3 · A tax

        The state takes a tax per unit from the sellers. They need a higher price to offer the same
        quantity: the supply line shifts **up by the tax**.

        [Tax per unit (€): {{ self.tax() }}](#sheet-input:tax?type=range&min=0&max=10&step=0.5)

        [Demand falls per €: {{ self.demand_slope() }}](#sheet-input:demand_slope?type=range&min=1&max=10&step=0.5)

        {{ self.taxed_market() }}

        The price rises from {{ self.price() }} € to **{{ self.taxed_price() }} €**, the quantity falls from
        {{ self.quantity() }} to **{{ self.taxed_quantity() }}**. Sellers keep **{{ self.seller_gets() }} €** per unit
        and the state collects **{{ self.tax_revenue() }} €**. Buyers carry **{{ self.buyer_share() }} %** of the
        tax, although the sellers pay it.

        ## Check yourself

        - Make buyers less price-sensitive (smaller demand slope). Who carries more of the tax?
        - Which tax brings the state the most revenue? Is it the highest one?

        ---

        **Previous:** [2 · Equilibrium](#note-p2_equilibrium)"""

    # a price to try out, in €
    test_price = cell(
        "A4",
        field(8),
        label="test_price",
        view={"widget": {"type": "range", "min": 0, "max": 30, "step": 0.5}},
    )

    @cell("B4", label="price")
    @computed
    def price(self):
        return round(self.demand_max() / (self.demand_slope() + self.supply_slope()), 2)

    # tax per unit in €, paid by sellers
    tax = cell(
        "A5",
        field(5),
        label="tax",
        view={"widget": {"type": "range", "min": 0, "max": 10, "step": 0.5}},
    )

    @cell("B5", label="quantity")
    @computed
    def quantity(self):
        return round(self.demand_max() - self.demand_slope() * self.price(), 1)

    @cell("B6", label="taxed_price")
    @computed
    def taxed_price(self):
        return round((self.demand_max() + self.supply_slope() * self.tax()) / (self.demand_slope() + self.supply_slope()), 2)

    @cell("B7", label="taxed_quantity")
    @computed
    def taxed_quantity(self):
        return round(self.demand_max() - self.demand_slope() * self.taxed_price(), 1)

    @cell("B8", label="seller_gets")
    @computed
    def seller_gets(self):
        return round(self.taxed_price() - self.tax(), 2)

    @cell("B9", label="tax_revenue")
    @computed
    def tax_revenue(self):
        return round(self.tax() * self.taxed_quantity(), 2)

    @cell("C9", label="taxed_market", view={"display": "rendered", "span": [2, 8]})
    @computed
    def taxed_market(self):
        import plotly.graph_objects as go

        prices = np.linspace(0, 30, 61)
        figure = go.Figure(go.Scatter(x=self.demand_max() - self.demand_slope() * prices, y=prices, name="demand", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=self.supply_slope() * prices, y=prices, name="supply", line=dict(color="#8b8b84", dash="dash"))
        figure.add_scatter(x=self.supply_slope() * (prices - self.tax()), y=prices, name="supply with tax", line=dict(color="#eb6834", width=3))
        figure.add_scatter(x=[self.quantity(), self.taxed_quantity()], y=[self.price(), self.taxed_price()], mode="markers", name="before → after", marker=dict(color="#7157d9", size=12))
        figure.update_layout(**self.chart_layout()("The market with a tax", "quantity", "price (€)", xaxis_range=[0, 200], yaxis_range=[0, 30]))
        return figure

    @cell("B10", label="buyer_share")
    @computed
    def buyer_share(self):
        return round((self.taxed_price() - self.price()) / self.tax() * 100) if self.tax() else 0


@workbook_config(
    {"formatVersion": 2, "name": "Markets", "layout": {"noteOrder": ["F1", "F2", "F3"]}}
)
class MarketsWorkbook(Workbook):
    Model = worksheet(
        ModelWorksheet,
        grid={"columns": 8, "rows": 30},
        layout={
            "columnWidths": {"A": 190, "B": 230, "C": 250, "D": 250, "E": 230, "F": 280}
        },
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
