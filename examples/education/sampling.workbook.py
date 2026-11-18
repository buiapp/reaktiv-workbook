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


class ModelWorksheet(Worksheet["SamplingAndInferenceWorkbook"]):
    population = cell(
        "A1",
        field("Exponential"),
        label="population",
        view={
            "widget": {
                "type": "select",
                "options": ["Uniform", "Exponential", "Coin flip"],
            }
        },
    )

    @cell("B1", label="theory")
    @computed
    def theory(self):
        # mean and standard deviation of one observation
        return {"Uniform": (0.5, (1 / 12) ** 0.5), "Exponential": (1.0, 1.0), "Coin flip": (0.5, 0.5)}[self.population()]

    @cell("C1", label="population_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def population_graph(self):
        import plotly.graph_objects as go

        figure = go.Figure(go.Histogram(x=self.draw()(20000, 7), nbinsx=40, histnorm="probability density", name="population", marker_color="#8b8b84"))
        figure.add_scatter(x=self.one_sample(), y=[0] * self.sample_size(), mode="markers", name="one sample", marker=dict(color="#2a78d6", size=9, symbol="line-ns-open", line_width=2))
        figure.add_vline(x=self.theory()[0], line_color="#eb6834", annotation_text="μ")
        figure.add_vline(x=self.sample_mean(), line_color="#2a78d6", line_dash="dash", annotation_text="sample mean", annotation_position="bottom right")
        figure.update_layout(**self.chart_layout()(f"{self.population()} population and a sample of {self.sample_size()}", "value", "density", bargap=0.02))
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

    @cell("F1", label="p1_populations_and_samples")
    @markdown
    def p1_populations_and_samples(self):
        return """# 1 · Populations and samples

        We rarely see a whole **population**; we see a **sample** and compute its mean $\\bar x$ as
        an estimate of the unknown population mean $\\mu$. Every new sample gives a different
        estimate.

        [Population: {{ self.population() }}](#sheet-input:population?type=select&options=Uniform,Exponential,Coin%20flip)

        [Sample size n: {{ self.sample_size() }}](#sheet-input:sample_size?type=range&min=1&max=100&step=1)

        [Draw new samples: {{ self.resample() }}](#sheet-input:resample?type=button)

        {{ self.population_graph() }}

        This sample of {{ self.sample_size() }} has the mean **{{ self.sample_mean() }}**; the population mean is
        {{ self.theory()[0] }}.

        ## Check yourself

        - Draw several samples. How far does $\\bar x$ typically land from $\\mu$?
        - What changes when you take 100 observations instead of 10?

        ---

        **Next:** [2 · The central limit theorem](#note-p2_central_limit_theorem)"""

    # observations per sample (n)
    sample_size = cell(
        "A2",
        field(10),
        label="sample_size",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B2", label="draw")
    @computed
    def draw(self):
        def draw(shape, seed):
            rng = np.random.default_rng(seed)
            if self.population() == "Uniform":
                return rng.random(shape)
            if self.population() == "Exponential":
                return rng.standard_exponential(shape)
            return rng.integers(0, 2, shape).astype(float)

        return draw

    @cell("F2", label="p2_central_limit_theorem")
    @markdown
    def p2_central_limit_theorem(self):
        return """# 2 · The central limit theorem

        How do the sample means scatter? Take {{ self.samples() }} samples and look at all their means:
        for any population with finite variance they are approximately **normally distributed**,
        the better the larger $n$.

        [Population: {{ self.population() }}](#sheet-input:population?type=select&options=Uniform,Exponential,Coin%20flip)

        [Sample size n: {{ self.sample_size() }}](#sheet-input:sample_size?type=range&min=1&max=100&step=1)

        {{ self.histogram() }}

        | | Simulation | Theory |
        | --- | ---: | ---: |
        | Standard deviation of the means | {{ self.spread() }} | {{ self.standard_error() }} |

        $$\\bar X_n \\approx \\mathcal N\\!\\left(\\mu,\\ \\frac{\\sigma^2}{n}\\right) \\qquad \\text{standard error} = \\frac{\\sigma}{\\sqrt n}$$

        ## Check yourself

        - With $n = 1$ the histogram shows the population itself. At which $n$ does the
          exponential population look normal?
        - Quadruple $n$. By what factor does the spread shrink?

        ---

        **Previous:** [1 · Populations and samples](#note-p1_populations_and_samples) · **Next:** [3 · Confidence intervals](#note-p3_confidence_intervals)"""

    # every click draws new samples
    resample = cell(
        "A3", field(0), label="resample", view={"widget": {"type": "button"}}
    )

    @cell("B3", label="one_sample")
    @computed
    def one_sample(self):
        return self.draw()(self.sample_size(), self.resample())

    @cell("F3", label="p3_confidence_intervals")
    @markdown
    def p3_confidence_intervals(self):
        return """# 3 · Confidence intervals

        Because $\\bar x$ is approximately normal, we can state how far it may be from $\\mu$:

        $$\\bar x \\pm z \\cdot \\frac{s}{\\sqrt n}$$

        [Confidence level (%): {{ self.confidence() }}](#sheet-input:confidence?type=select&options=90,95,99)

        [Sample size n: {{ self.sample_size() }}](#sheet-input:sample_size?type=range&min=1&max=100&step=1)

        [Draw new samples: {{ self.resample() }}](#sheet-input:resample?type=button)

        {{ self.interval_graph() }}

        With $z =$ {{ self.z() }}, **{{ self.covering() }} of 100** intervals contain $\\mu$. "{{ self.confidence() }} %
        confidence" is a statement about the **method**: in the long run that share of intervals
        covers the true value. Any single interval either does or does not.

        ## Check yourself

        - Why are intervals at 99 % wider than at 90 %?
        - For small $n$ and the exponential population, fewer intervals cover $\\mu$ than
          promised. Which assumptions fail? (Normality of $\\bar x$; $z$ instead of $t$.)

        ---

        **Previous:** [2 · The central limit theorem](#note-p2_central_limit_theorem)"""

    # number of samples for the sampling distribution
    samples = cell("A4", field(3000), label="samples")

    @cell("B4", label="sample_mean")
    @computed
    def sample_mean(self):
        return round(float(self.one_sample().mean()), 3)

    confidence = cell(
        "A5",
        field(95),
        label="confidence",
        view={"widget": {"type": "select", "options": ["90", "95", "99"]}},
    )

    @cell("B5", label="means")
    @computed
    def means(self):
        return self.draw()((self.samples(), self.sample_size()), self.resample() + 1).mean(axis=1)

    @cell("B6", label="spread")
    @computed
    def spread(self):
        return round(float(self.means().std()), 4)

    @cell("B7", label="standard_error")
    @computed
    def standard_error(self):
        return round(self.theory()[1] / self.sample_size()**0.5, 4)

    @cell("B8", label="z")
    @computed
    def z(self):
        return {90: 1.645, 95: 1.960, 99: 2.576}[int(self.confidence())]

    @cell("B9", label="intervals")
    @computed
    def intervals(self):
        # 100 samples, one confidence interval each: (mean, half width)
        data = self.draw()((100, self.sample_size()), self.resample() + 2)
        centers = data.mean(axis=1)
        half = self.z() * (data.std(axis=1, ddof=1) if self.sample_size() > 1 else np.zeros(100)) / self.sample_size()**0.5
        return (centers, half)

    @cell("C9", label="histogram", view={"display": "rendered", "span": [2, 8]})
    @computed
    def histogram(self):
        import plotly.graph_objects as go

        figure = go.Figure(go.Histogram(x=self.means(), nbinsx=50, histnorm="probability density", name="sample means", marker_color="#2a78d6"))
        xs = np.linspace(self.means().min(), self.means().max(), 200)
        mu, sigma = self.theory()[0], self.standard_error()
        figure.add_scatter(x=xs, y=np.exp(-((xs - mu) ** 2) / (2 * sigma**2)) / (sigma * (2 * np.pi) ** 0.5), name="normal curve", line=dict(color="#eb6834", width=3))
        figure.update_layout(**self.chart_layout()(f"Means of {self.samples()} samples, n = {self.sample_size()}", "sample mean", "density", bargap=0.02))
        return figure

    @cell("B10", label="covering")
    @computed
    def covering(self):
        return int((np.abs(self.intervals()[0] - self.theory()[0]) <= self.intervals()[1]).sum())

    @cell("C17", label="interval_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def interval_graph(self):
        import plotly.graph_objects as go

        centers, half = self.intervals()
        hit = np.abs(centers - self.theory()[0]) <= half
        figure = go.Figure()
        for covers, color, label in ((True, "#2a78d6", "covers μ"), (False, "#eb6834", "misses μ")):
            pick = hit == covers
            figure.add_scatter(x=centers[pick], y=np.arange(100)[pick], mode="markers", name=label, marker=dict(color=color, size=5), error_x=dict(type="data", array=half[pick], color=color, thickness=1.2, width=0))
        figure.add_vline(x=self.theory()[0], line_color="#8b8b84", annotation_text="μ")
        figure.update_layout(**self.chart_layout()(f"100 intervals at {self.confidence()} % confidence", "value", "sample number"))
        return figure


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Sampling and inference",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class SamplingAndInferenceWorkbook(Workbook):
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
