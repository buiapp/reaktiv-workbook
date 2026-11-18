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

import math
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


class ModelWorksheet(Worksheet["PopulationsWorkbook"]):
    # animals at the beginning
    start = cell(
        "A1",
        field(50),
        label="start",
        view={"widget": {"type": "range", "min": 10, "max": 500, "step": 10}},
    )

    @cell("B1", label="r")
    @computed
    def r(self):
        return self.rate() / 100

    @cell("C1", label="unlimited", view={"display": "rendered", "span": [2, 8]})
    @computed
    def unlimited(self):
        import plotly.graph_objects as go

        t = np.linspace(0, self.years(), 120)
        figure = go.Figure(go.Scatter(x=t, y=self.start() * np.exp(self.r() * t), name="rabbits", line=dict(color="#eb6834", width=3)))
        figure.update_layout(**self.chart_layout()("Growth without limits", "years", "animals"))
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

    @cell("F1", label="p1_unlimited_growth")
    @markdown
    def p1_unlimited_growth(self):
        return """# 1 · Growth without limits

        Rabbits arrive on an island with plenty of food. Every year the population grows by the
        same **percentage**, so it grows faster and faster: exponential growth.

        [Rabbits at the start: {{ self.start() }}](#sheet-input:start?type=range&min=10&max=500&step=10)

        [Growth per year (%): {{ self.rate() }}](#sheet-input:rate?type=range&min=1&max=100&step=1)

        [Years: {{ self.years() }}](#sheet-input:years?type=range&min=5&max=60&step=1)

        {{ self.unlimited() }}

        The population doubles every **{{ self.doubling_time() }} years**. After {{ self.years() }} years there
        would be **{{ self.unlimited_end() }}** rabbits.

        $$N(t) = N_0 \\, e^{rt}$$

        ## Check yourself

        - How long until there are a million rabbits? Is that realistic?
        - What does halving the growth rate do to the doubling time?

        ---

        **Next:** [2 · When food runs short](#note-p2_limited_growth)"""

    # growth per year in percent
    rate = cell(
        "A2",
        field(30),
        label="rate",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B2", label="doubling_time")
    @computed
    def doubling_time(self):
        return round(math.log(2) / self.r(), 1)

    @cell("F2", label="p2_limited_growth")
    @markdown
    def p2_limited_growth(self):
        return """# 2 · When food runs short

        The island can feed only so many animals: its **carrying capacity** $K$. The closer the
        population gets, the slower it grows (logistic growth).

        [Carrying capacity: {{ self.capacity() }}](#sheet-input:capacity?type=range&min=200&max=5000&step=100)

        [Growth per year (%): {{ self.rate() }}](#sheet-input:rate?type=range&min=1&max=100&step=1)

        {{ self.limited() }}

        After {{ self.years() }} years there are **{{ self.limited_end() }}** rabbits instead of
        {{ self.unlimited_end() }}.

        $$N(t) = \\frac{K}{1 + \\frac{K - N_0}{N_0} e^{-rt}}$$

        ## Check yourself

        - When do the two curves start to differ clearly?
        - Set the start population (page 1) above the capacity. What happens?

        ---

        **Previous:** [1 · Growth without limits](#note-p1_unlimited_growth) · **Next:** [3 · Predators and prey](#note-p3_predators_and_prey)"""

    # how many the habitat can feed
    capacity = cell(
        "A3",
        field(2000),
        label="capacity",
        view={"widget": {"type": "range", "min": 200, "max": 5000, "step": 100}},
    )

    @cell("B3", label="unlimited_end")
    @computed
    def unlimited_end(self):
        return round(self.start() * math.exp(self.r() * self.years()))

    @cell("F3", label="p3_predators_and_prey")
    @markdown
    def p3_predators_and_prey(self):
        return """# 3 · Predators and prey

        Now foxes arrive. More rabbits feed more foxes; more foxes eat more rabbits; fewer rabbits
        starve the foxes. Neither population settles: they **cycle**, the foxes lagging behind.

        [Foxes at the start: {{ self.foxes() }}](#sheet-input:foxes?type=range&min=1&max=60&step=1)

        [Hunting success (%): {{ self.hunting() }}](#sheet-input:hunting?type=range&min=0.5&max=6&step=0.5)

        [Growth per year (%): {{ self.rate() }}](#sheet-input:rate?type=range&min=1&max=100&step=1)

        {{ self.cycles() }}

        Rabbits peak at **{{ self.rabbit_peak() }}**, foxes at **{{ self.fox_peak() }}**.

        $$\\frac{dR}{dt} = rR - cRF \\qquad \\frac{dF}{dt} = e\\,cRF - mF$$

        ## Check yourself

        - Which population peaks first? Why?
        - Make the foxes better hunters. Is that good for the foxes in the long run?

        ---

        **Previous:** [2 · When food runs short](#note-p2_limited_growth)"""

    # how long we watch
    years = cell(
        "A4",
        field(25),
        label="years",
        view={"widget": {"type": "range", "min": 5, "max": 60, "step": 1}},
    )

    @cell("B4", label="limited_end")
    @computed
    def limited_end(self):
        return round(self.capacity() / (1 + (self.capacity() - self.start()) / self.start() * math.exp(-self.r() * self.years())))

    # foxes at the beginning
    foxes = cell(
        "A5",
        field(10),
        label="foxes",
        view={"widget": {"type": "range", "min": 1, "max": 60, "step": 1}},
    )

    @cell("B5", label="hunt")
    @computed
    def hunt(self):
        # rabbits and foxes in small time steps (Lotka–Volterra)
        dt, steps = 0.01, int(self.years() / 0.01)
        rabbits, hunters = np.empty(steps), np.empty(steps)
        rabbits[0], hunters[0] = self.start(), self.foxes()
        for i in range(1, steps):
            prey, predator = rabbits[i - 1], hunters[i - 1]
            caught = self.hunting() / 100 * prey * predator
            rabbits[i] = max(prey + dt * (self.r() * prey - caught), 0)
            hunters[i] = max(predator + dt * (0.1 * caught - 0.4 * predator), 0)
        return {"t": np.arange(steps) * dt, "rabbits": rabbits, "foxes": hunters}

    # share of rabbits one fox catches per year, in percent
    hunting = cell(
        "A6",
        field(2),
        label="hunting",
        view={"widget": {"type": "range", "min": 0.5, "max": 6, "step": 0.5}},
    )

    @cell("B6", label="rabbit_peak")
    @computed
    def rabbit_peak(self):
        return round(float(self.hunt()["rabbits"].max()))

    @cell("B7", label="fox_peak")
    @computed
    def fox_peak(self):
        return round(float(self.hunt()["foxes"].max()))

    @cell("C9", label="limited", view={"display": "rendered", "span": [2, 8]})
    @computed
    def limited(self):
        import plotly.graph_objects as go

        t = np.linspace(0, self.years(), 120)
        limited = self.capacity() / (1 + (self.capacity() - self.start()) / self.start() * np.exp(-self.r() * t))
        figure = go.Figure(go.Scatter(x=t, y=limited, name="with limited food", line=dict(color="#1baf7a", width=3)))
        figure.add_scatter(x=t, y=self.start() * np.exp(self.r() * t), name="without limits", line=dict(color="#eb6834", dash="dash"))
        figure.add_hline(y=self.capacity(), line_dash="dot", line_color="#8b8b84", annotation_text="capacity")
        figure.update_layout(**self.chart_layout()("Growth towards the capacity", "years", "animals", yaxis_range=[0, self.capacity() * 1.4]))
        return figure

    @cell("C17", label="cycles", view={"display": "rendered", "span": [2, 8]})
    @computed
    def cycles(self):
        import plotly.graph_objects as go

        figure = go.Figure(go.Scatter(x=self.hunt()["t"], y=self.hunt()["rabbits"], name="rabbits", line=dict(color="#1baf7a", width=3)))
        figure.add_scatter(x=self.hunt()["t"], y=self.hunt()["foxes"], name="foxes", yaxis="y2", line=dict(color="#eb6834", width=3))
        figure.update_layout(**self.chart_layout()("Rabbits and foxes", "years", "rabbits", yaxis2=dict(title="foxes", overlaying="y", side="right", showgrid=False)))
        return figure


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Populations",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class PopulationsWorkbook(Workbook):
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
