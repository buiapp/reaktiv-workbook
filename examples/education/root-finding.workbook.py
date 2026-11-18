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


class ModelWorksheet(Worksheet["RootFindingWorkbook"]):
    function = cell(
        "A1",
        field("Cubic"),
        label="function",
        view={
            "widget": {"type": "select", "options": ["Cubic", "Cosine", "Root of 2"]}
        },
    )

    @cell("B1", label="f")
    @computed
    def f(self):
        return self.functions()[self.function()][0]

    @cell("C1", label="halving", view={"display": "rendered", "span": [2, 8]})
    @computed
    def halving(self):
        import plotly.graph_objects as go

        xs = np.linspace(-0.5, 3.5, 200)
        figure = go.Figure(go.Scatter(x=xs, y=self.f()(xs), name="f(x)", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=self.midpoints(), y=[0] * self.steps(), mode="markers+text", text=[str(i + 1) for i in range(self.steps())], textposition="top center", name="midpoints", marker=dict(color="#eb6834", size=9))
        figure.add_hline(y=0, line_color="#8b8b84")
        figure.update_layout(**self.chart_layout()("Halving the interval [0, 3]", "x", "f(x)", yaxis_range=[-8, 20]))
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

    @cell("F1", label="p1_bisection")
    @markdown
    def p1_bisection(self):
        return """# 1 · Bisection

        To solve $f(x) = 0$, start with an interval on which $f$ changes sign. Take the midpoint,
        keep the half that still contains the sign change, repeat. Slow, but it **cannot fail**.

        [Function: {{ self.function() }}](#sheet-input:function?type=select&options=Cubic,Cosine,Root%20of%202)

        | Name | $f(x)$ |
        | --- | --- |
        | Cubic | $x^3 - 2x - 5$ |
        | Cosine | $\\cos x - x$ |
        | Root of 2 | $x^2 - 2$ |

        [Steps: {{ self.steps() }}](#sheet-input:steps?type=range&min=1&max=12&step=1)

        {{ self.halving() }}

        After {{ self.steps() }} steps the estimate is **{{ self.bisection_estimate() }}** and the root is
        guaranteed to lie within **{{ f'{self.bracket():.2e}' }}** of it.

        $$|x_k - x^*| \\le \\frac{b - a}{2^k}$$

        ## Check yourself

        - How many steps give six correct decimal places on $[0, 3]$?
        - Does the answer depend on the function?

        ---

        **Next:** [2 · Newton's method](#note-p2_newtons_method)"""

    # number of steps for both methods
    steps = cell(
        "A2",
        field(5),
        label="steps",
        view={"widget": {"type": "range", "min": 1, "max": 12, "step": 1}},
    )

    @cell("B2", label="midpoints")
    @computed
    def midpoints(self):
        return self.bisect()(self.f(), 0, 3, self.steps())

    @cell("E2", label="functions")
    @computed
    def functions(self):
        # functions: name → (f, f′)
        return {
            "Cubic": (lambda x: x**3 - 2 * x - 5, lambda x: 3 * x**2 - 2),
            "Cosine": (lambda x: np.cos(x) - x, lambda x: -np.sin(x) - 1),
            "Root of 2": (lambda x: x**2 - 2, lambda x: 2 * x),
        }

    @cell("F2", label="p2_newtons_method")
    @markdown
    def p2_newtons_method(self):
        return """# 2 · Newton's method

        Use more than the sign: replace the curve by its **tangent** at the current guess and go
        to where the tangent crosses the axis.

        $$x_{k+1} = x_k - \\frac{f(x_k)}{f'(x_k)}$$

        [Function: {{ self.function() }}](#sheet-input:function?type=select&options=Cubic,Cosine,Root%20of%202)

        [Newton's start x₀: {{ self.x0() }}](#sheet-input:x0?type=range&min=-4&max=4&step=0.1)

        [Steps: {{ self.steps() }}](#sheet-input:steps?type=range&min=1&max=12&step=1)

        {{ self.tangents() }}

        After at most {{ self.steps() }} steps the estimate is **{{ self.newton_estimate() }}**.

        ## Check yourself

        - Start *Root of 2* at 0. What goes wrong, and why?
        - For *Cubic*, find a start value from which the method first jumps far away.

        ---

        **Previous:** [1 · Bisection](#note-p1_bisection) · **Next:** [3 · Comparing convergence](#note-p3_convergence)"""

    # Newton's starting guess
    x0 = cell(
        "A3",
        field(3),
        label="x0",
        view={"widget": {"type": "range", "min": -4, "max": 4, "step": 0.1}},
    )

    @cell("B3", label="bisection_estimate")
    @computed
    def bisection_estimate(self):
        return round(self.midpoints()[-1], 8)

    @cell("E3", label="bisect")
    @computed
    def bisect(self):
        def bisect(f, left, right, steps):
            """Midpoints of `steps` halvings of [left, right] (f changes sign inside)."""
            midpoints = []
            for _ in range(steps):
                middle = (left + right) / 2
                midpoints.append(middle)
                if f(left) * f(middle) <= 0:
                    right = middle
                else:
                    left = middle
            return midpoints

        return bisect

    @cell("F3", label="p3_convergence")
    @markdown
    def p3_convergence(self):
        return """# 3 · Comparing convergence

        Both methods ran {{ self.steps() }} steps on the same function. On a logarithmic scale bisection is
        a **straight line** (the error halves: linear convergence), Newton **bends downward** (the
        error is roughly squared: quadratic convergence).

        [Function: {{ self.function() }}](#sheet-input:function?type=select&options=Cubic,Cosine,Root%20of%202)

        [Steps: {{ self.steps() }}](#sheet-input:steps?type=range&min=1&max=12&step=1)

        [Newton's start x₀: {{ self.x0() }}](#sheet-input:x0?type=range&min=-4&max=4&step=0.1)

        {{ self.errors() }}

        | Method | Needs | Speed | Fails when |
        | --- | --- | --- | --- |
        | Bisection | a sign change | one bit per step | never |
        | Newton | $f'$, a good start | digits double per step | $f' = 0$, bad start |

        In practice the two are combined: bisection to get close, Newton to finish.

        ## Check yourself

        - From which step on is Newton ahead? Does a poor $x_0$ change that?
        - Why does Newton's curve stop falling near $10^{-16}$?

        ---

        **Previous:** [2 · Newton's method](#note-p2_newtons_method)"""

    @cell("B4", label="bracket")
    @computed
    def bracket(self):
        return 3 / 2**self.steps()

    @cell("E4", label="newton")
    @computed
    def newton(self):
        def newton(f, df, x, steps):
            """The iterates x0, x1, … of Newton's method."""
            xs = [float(x)]
            for _ in range(steps):
                slope = df(xs[-1])
                if slope == 0:
                    break
                xs.append(float(xs[-1] - f(xs[-1]) / slope))
            return xs

        return newton

    @cell("B5", label="iterates")
    @computed
    def iterates(self):
        return self.newton()(self.f(), self.functions()[self.function()][1], self.x0(), self.steps())

    @cell("B6", label="newton_estimate")
    @computed
    def newton_estimate(self):
        return round(self.iterates()[-1], 10)

    @cell("B7", label="root")
    @computed
    def root(self):
        return self.bisect()(self.f(), 0, 3, 60)[-1]

    @cell("B8", label="bisection_errors")
    @computed
    def bisection_errors(self):
        return [abs(x - self.root()) for x in self.midpoints()]

    @cell("B9", label="newton_errors")
    @computed
    def newton_errors(self):
        return [abs(x - self.root()) for x in self.iterates()[1:]]

    @cell("C9", label="tangents", view={"display": "rendered", "span": [2, 8]})
    @computed
    def tangents(self):
        import plotly.graph_objects as go

        xs = np.linspace(-4, 4, 200)
        figure = go.Figure(go.Scatter(x=xs, y=self.f()(xs), name="f(x)", line=dict(color="#2a78d6", width=3)))
        for a, b in zip(self.iterates(), self.iterates()[1:]):
            figure.add_scatter(x=[a, a, b], y=[0, float(self.f()(a)), 0], mode="lines", showlegend=False, line=dict(color="#eb6834", width=1.5))
        figure.add_scatter(x=self.iterates(), y=[0] * len(self.iterates()), mode="markers", name="iterates", marker=dict(color="#7157d9", size=9))
        figure.add_hline(y=0, line_color="#8b8b84")
        figure.update_layout(**self.chart_layout()("Tangents walk to the root", "x", "f(x)", xaxis_range=[-4, 4], yaxis_range=[-12, 30]))
        return figure

    @cell("C17", label="errors", view={"display": "rendered", "span": [2, 8]})
    @computed
    def errors(self):
        import plotly.graph_objects as go

        floor = 1e-16
        figure = go.Figure(go.Scatter(x=list(range(1, self.steps() + 1)), y=[max(e, floor) for e in self.bisection_errors()], name="bisection", line=dict(color="#eb6834", width=3)))
        figure.add_scatter(x=list(range(1, len(self.newton_errors()) + 1)), y=[max(e, floor) for e in self.newton_errors()], name="Newton", line=dict(color="#7157d9", width=3))
        figure.update_layout(**self.chart_layout()("Error after each step", "step", "|x − root|", yaxis_type="log"))
        return figure


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Root finding",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class RootFindingWorkbook(Workbook):
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
