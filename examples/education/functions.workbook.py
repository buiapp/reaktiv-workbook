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


class ModelWorksheet(Worksheet["FunctionsWorkbook"]):
    # m: how much y changes when x grows by 1
    slope = cell(
        "A1",
        field(1.5),
        label="slope",
        view={"widget": {"type": "range", "min": -4, "max": 4, "step": 0.5}},
    )

    @cell("B1", label="line_zero")
    @computed
    def line_zero(self):
        return round(-self.intercept() / self.slope(), 3) if self.slope() != 0 else None

    @cell("C1", label="line_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def line_graph(self):
        import plotly.graph_objects as go

        xs = np.linspace(-8, 8, 2)
        figure = go.Figure(go.Scatter(x=xs, y=self.slope() * xs + self.intercept(), name="f(x)", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=[0], y=[self.intercept()], mode="markers", name="y-intercept", marker=dict(color="#7157d9", size=11))
        if self.line_zero() is not None:
            figure.add_scatter(x=[self.line_zero()], y=[0], mode="markers", name="zero", marker=dict(color="#eb6834", size=11))
        figure.update_layout(**self.chart_layout()("f(x) = m·x + n", "x", "f(x)", xaxis_range=[-8, 8], yaxis_range=[-12, 12]))
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

    @cell("F1", label="p1_linear_functions")
    @markdown
    def p1_linear_functions(self):
        return """# 1 · Linear functions

        A linear function $f(x) = m x + n$ changes by the same amount in every step. Its graph is a
        straight line: $m$ is the **slope**, $n$ the **y-intercept**.

        [Slope m: {{ self.slope() }}](#sheet-input:slope?type=range&min=-4&max=4&step=0.5)

        [Intercept n: {{ self.intercept() }}](#sheet-input:intercept?type=range&min=-8&max=8&step=0.5)

        {{ self.line_graph() }}

        The line **{{ self.direction() }}**, crosses the y-axis at **{{ self.intercept() }}** and has its zero
        at $x =$ **{{ self.line_zero() }}**, because $m x + n = 0 \\Rightarrow x = -\\dfrac{n}{m}$.

        ## Check yourself

        - Which slope makes the line horizontal? What happens to the zero?
        - Find two different lines with the zero at $x = 2$.

        ---

        **Next:** [2 · Quadratic functions](#note-p2_quadratic_functions)"""

    # n: where the line crosses the y-axis
    intercept = cell(
        "A2",
        field(-2),
        label="intercept",
        view={"widget": {"type": "range", "min": -8, "max": 8, "step": 0.5}},
    )

    @cell("B2", label="direction")
    @computed
    def direction(self):
        return "rises" if self.slope() > 0 else "falls" if self.slope() < 0 else "is horizontal"

    @cell("F2", label="p2_quadratic_functions")
    @markdown
    def p2_quadratic_functions(self):
        return """# 2 · Quadratic functions

        Add a squared term and the line bends into a **parabola**: $f(x) = a x^2 + b x + c$.

        [a: {{ self.a() }}](#sheet-input:a?type=range&min=-3&max=3&step=0.5)

        [b: {{ self.b() }}](#sheet-input:b?type=range&min=-8&max=8&step=0.5)

        [c: {{ self.c() }}](#sheet-input:c?type=range&min=-10&max=10&step=0.5)

        {{ self.parabola() }}

        The **discriminant** $D = b^2 - 4ac$ is **{{ self.discriminant() }}**, so $f(x) = 0$ has
        **{{ self.verdict() }}**: {{ self.roots() }}. The **vertex** is at {{ self.vertex() }}.

        $$x_{1,2} = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

        ## Check yourself

        - Set $a = 0$. Which function from page 1 is left?
        - Move the curve up with `c` until the zeros disappear. What is the discriminant then?

        ---

        **Previous:** [1 · Linear functions](#note-p1_linear_functions) · **Next:** [3 · Exponential growth](#note-p3_exponential_growth)"""

    # opens upward when positive, downward when negative
    a = cell(
        "A3",
        field(1),
        label="a",
        view={"widget": {"type": "range", "min": -3, "max": 3, "step": 0.5}},
    )

    @cell("B3", label="discriminant")
    @computed
    def discriminant(self):
        return self.b()**2 - 4 * self.a() * self.c()

    @cell("F3", label="p3_exponential_growth")
    @markdown
    def p3_exponential_growth(self):
        return """# 3 · Exponential growth

        A linear function **adds** the same amount in every step. An exponential function
        **multiplies** by the same factor: $f(x) = f_0 \\cdot q^x$.

        [Start value: {{ self.start() }}](#sheet-input:start?type=range&min=10&max=500&step=10)

        [Growth per step (%): {{ self.percent() }}](#sheet-input:percent?type=range&min=1&max=100&step=1)

        {{ self.growth_graph() }}

        Growing by {{ self.percent() }} % per step means multiplying by **{{ self.factor() }}**. After ten steps
        the value is **{{ self.after_ten() }}**; adding the same first increase each time gives only
        **{{ self.linear_after_ten() }}**. The value doubles every **{{ self.doubling_steps() }} steps**.

        ## Check yourself

        - At which percentage does the value double in exactly one step?
        - Why does the gap between the two curves keep growing?

        ---

        **Previous:** [2 · Quadratic functions](#note-p2_quadratic_functions)"""

    # moves the vertex left and right
    b = cell(
        "A4",
        field(-2),
        label="b",
        view={"widget": {"type": "range", "min": -8, "max": 8, "step": 0.5}},
    )

    @cell("B4", label="roots")
    @computed
    def roots(self):
        # real solutions of a·x² + b·x + c = 0
        if self.a() == 0:
            found = [] if self.b() == 0 else [-self.c() / self.b()]
        elif self.discriminant() < 0:
            found = []
        else:
            root = self.discriminant() ** 0.5
            found = sorted({(-self.b() - root) / (2 * self.a()), (-self.b() + root) / (2 * self.a())})
        return [round(x, 3) for x in found]

    # where the curve crosses the y-axis
    c = cell(
        "A5",
        field(-3),
        label="c",
        view={"widget": {"type": "range", "min": -10, "max": 10, "step": 0.5}},
    )

    @cell("B5", label="vertex")
    @computed
    def vertex(self):
        return (round(-self.b() / (2 * self.a()), 3), round(self.c() - self.b()**2 / (4 * self.a()), 3)) if self.a() != 0 else None

    # value at step 0
    start = cell(
        "A6",
        field(100),
        label="start",
        view={"widget": {"type": "range", "min": 10, "max": 500, "step": 10}},
    )

    @cell("B6", label="verdict")
    @computed
    def verdict(self):
        return "a line, not a parabola" if self.a() == 0 else {0: "no real roots", 1: "one double root", 2: "two roots"}[len(self.roots())]

    # growth per step in percent
    percent = cell(
        "A7",
        field(20),
        label="percent",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B7", label="factor")
    @computed
    def factor(self):
        return 1 + self.percent() / 100

    @cell("B8", label="doubling_steps")
    @computed
    def doubling_steps(self):
        return round(math.log(2) / math.log(self.factor()), 1)

    @cell("B9", label="after_ten")
    @computed
    def after_ten(self):
        return round(self.start() * self.factor()**10)

    @cell("C9", label="parabola", view={"display": "rendered", "span": [2, 8]})
    @computed
    def parabola(self):
        import plotly.graph_objects as go

        xs = np.linspace(-8, 8, 161)
        figure = go.Figure(go.Scatter(x=xs, y=self.a() * xs**2 + self.b() * xs + self.c(), name="f(x)", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=self.roots(), y=[0] * len(self.roots()), mode="markers", name="zeros", marker=dict(color="#eb6834", size=11))
        if self.vertex():
            figure.add_scatter(x=[self.vertex()[0]], y=[self.vertex()[1]], mode="markers", name="vertex", marker=dict(color="#7157d9", size=11, symbol="diamond"))
        figure.update_layout(**self.chart_layout()("f(x) = a·x² + b·x + c", "x", "f(x)", yaxis_range=[-20, 20]))
        return figure

    @cell("B10", label="linear_after_ten")
    @computed
    def linear_after_ten(self):
        return round(self.start() + 10 * self.start() * self.percent() / 100)

    @cell("C17", label="growth_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def growth_graph(self):
        import plotly.graph_objects as go

        steps = np.arange(0, 11)
        figure = go.Figure(go.Scatter(x=steps, y=self.start() * self.factor()**steps, name="exponential: × factor", line=dict(color="#1baf7a", width=3)))
        figure.add_scatter(x=steps, y=self.start() + steps * self.start() * self.percent() / 100, name="linear: + the same amount", line=dict(color="#8b8b84", dash="dash"))
        figure.update_layout(**self.chart_layout()("Ten steps of growth", "step", "value"))
        return figure


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Functions",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class FunctionsWorkbook(Workbook):
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
