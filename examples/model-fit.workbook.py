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


class ModelWorksheet(Worksheet["ModelFittingWorkbook"]):
    # degree of the fitted polynomial
    degree = cell(
        "A1",
        field(3),
        label="degree",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 15,
                "step": 1,
                "label": "Polynomial degree",
            }
        },
    )

    @cell("B1", label="x")
    @computed
    def x(self):
        return np.random.default_rng(self.resample()).uniform(0, 1, self.samples())

    @cell("C1", label="fit_chart", view={"display": "rendered", "span": [3, 5]})
    @computed
    def fit_chart(self):
        import plotly.graph_objects as go

        grid = np.linspace(0, 1, 300)
        figure = go.Figure()
        figure.add_scatter(x=self.x()[~self.is_test()], y=self.y()[~self.is_test()], mode="markers", name="train", marker=dict(color="#2a78d6", size=7))
        figure.add_scatter(x=self.x()[self.is_test()], y=self.y()[self.is_test()], mode="markers", name="test", marker=dict(color="#eb6834", size=7))
        figure.add_scatter(x=grid, y=np.sin(2 * np.pi * grid), name="truth", line=dict(color="#1baf7a", width=2, dash="dot"))
        figure.add_scatter(x=grid, y=self.model()(grid), name=f"degree {self.degree()}", line=dict(color="#7157d9", width=3))
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Fit", x=0, font=dict(size=14)), yaxis_range=[-2, 2], legend=dict(orientation="h", x=1, xanchor="right", y=1.02, yanchor="bottom"))
        return figure

    @cell("F1", label="residual_chart", view={"display": "rendered", "span": [2, 5]})
    @computed
    def residual_chart(self):
        import plotly.graph_objects as go

        residuals = self.y() - self.model()(self.x())
        figure = go.Figure()
        figure.add_scatter(x=self.x()[~self.is_test()], y=residuals[~self.is_test()], mode="markers", name="train", marker=dict(color="#2a78d6"))
        figure.add_scatter(x=self.x()[self.is_test()], y=residuals[self.is_test()], mode="markers", name="test", marker=dict(color="#eb6834"))
        figure.add_hline(y=0, line_color="#a3a3a3")
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Residuals", x=0, font=dict(size=14)), yaxis_range=[-1.5, 1.5], legend=dict(orientation="h", x=1, xanchor="right", y=1.02, yanchor="bottom"))
        return figure

    @cell("H1", label="model_fit")
    @markdown
    def model_fit(self):
        return """# 📈 Model fitting

        Fit a polynomial to noisy samples of a sine and watch the classic trade-off: too simple
        underfits, too flexible memorises the noise. Every number and plot follows the sliders.

        [Polynomial degree: {{ self.degree() }}](#sheet-input:degree?type=range&min=0&max=15&step=1)

        [Noise (σ): {{ self.noise() }}](#sheet-input:noise?type=range&min=0&max=1&step=0.05)

        [Samples: {{ self.samples() }}](#sheet-input:samples?type=range&min=10&max=200&step=5)

        [New sample: {{ self.resample() }}](#sheet-input:resample?type=button)

        Train error **{{ self.train_rmse() }}**, test error **{{ self.test_rmse() }}**. The lowest test error is at
        degree **{{ self.best_degree() }}**. {{ self.verdict() }}

        {{ self.fit_chart() }}

        {{ self.error_chart() }}

        Raise the degree past {{ self.best_degree() }} and watch the test error climb while the train error keeps
        falling. More samples or less noise move the sweet spot. Open **Cells** to see every step, or
        **Graph** to see what depends on what."""

    # standard deviation of the noise
    noise = cell(
        "A2",
        field(0.25),
        label="noise",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 1,
                "step": 0.05,
                "label": "Noise (σ)",
            }
        },
    )

    @cell("B2", label="y")
    @computed
    def y(self):
        return np.sin(2 * np.pi * self.x()) + np.random.default_rng(self.resample() + 1).normal(0, self.noise(), self.samples())

    samples = cell(
        "A3",
        field(30),
        label="samples",
        view={
            "widget": {
                "type": "range",
                "min": 10,
                "max": 200,
                "step": 5,
                "label": "Samples",
            }
        },
    )

    @cell("B3", label="is_test")
    @computed
    def is_test(self):
        # True for the held-out test samples
        return np.random.default_rng(self.resample() + 2).random(self.samples()) < self.test_share()

    # share of the samples held out for testing
    test_share = cell(
        "A4",
        field(0.3),
        label="test_share",
        view={
            "widget": {
                "type": "range",
                "min": 0.1,
                "max": 0.5,
                "step": 0.05,
                "label": "Test share",
            }
        },
    )

    @cell("B4", label="model")
    @computed
    def model(self):
        # least squares; the degree is capped at what the training points allow
        train = ~self.is_test()
        return np.polynomial.Polynomial.fit(self.x()[train], self.y()[train], min(self.degree(), int(train.sum()) - 1))

    # each click draws a new sample
    resample = cell(
        "A5",
        field(0),
        label="resample",
        view={"widget": {"type": "button", "label": "New sample"}},
    )

    @cell("B5", label="train_rmse")
    @computed
    def train_rmse(self):
        return round(float(np.sqrt(np.mean((self.model()(self.x()[~self.is_test()]) - self.y()[~self.is_test()]) ** 2))), 3)

    @cell("B6", label="test_rmse")
    @computed
    def test_rmse(self):
        return round(float(np.sqrt(np.mean((self.model()(self.x()[self.is_test()]) - self.y()[self.is_test()]) ** 2))), 3)

    @cell("C6", label="error_chart", view={"display": "rendered", "span": [3, 5]})
    @computed
    def error_chart(self):
        import plotly.graph_objects as go

        figure = go.Figure()
        figure.add_scatter(x=self.errors()["degree"], y=self.errors()["train"], mode="lines+markers", name="train", line=dict(color="#2a78d6"))
        figure.add_scatter(x=self.errors()["degree"], y=self.errors()["test"], mode="lines+markers", name="test", line=dict(color="#eb6834"))
        figure.add_vline(x=self.degree(), line_dash="dash", line_color="#7157d9", annotation_text="current")
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Error by degree", x=0, font=dict(size=14)),
                             xaxis_title="degree", yaxis_title="RMSE", yaxis_range=[0, 1.2], legend=dict(orientation="h", x=1, xanchor="right", y=1.02, yanchor="bottom"))
        return figure

    @cell("B7", label="errors")
    @computed
    def errors(self):
        # train and test error for every degree
        train = ~self.is_test()
        errors = {"degree": list(range(16)), "train": [], "test": []}
        for d in errors["degree"]:
            fit = np.polynomial.Polynomial.fit(self.x()[train], self.y()[train], min(d, int(train.sum()) - 1))
            errors["train"].append(float(np.sqrt(np.mean((fit(self.x()[train]) - self.y()[train]) ** 2))))
            errors["test"].append(float(np.sqrt(np.mean((fit(self.x()[~train]) - self.y()[~train]) ** 2))))
        return errors

    @cell("B8", label="best_degree")
    @computed
    def best_degree(self):
        return self.errors()["degree"][int(np.argmin(self.errors()["test"]))]

    @cell("B9", label="verdict")
    @computed
    def verdict(self):
        if self.degree() < self.best_degree():
            return "Underfitting: the curve is too simple for the data."
        if self.test_rmse() > 1.25 * min(self.errors()["test"]):
            return "Overfitting: it follows the noise, and the test error grows."
        return "A good fit: low test error without chasing the noise."


@workbook_config({"formatVersion": 2, "name": "Model fitting"})
class ModelFittingWorkbook(Workbook):
    Model = worksheet(ModelWorksheet, grid={"columns": 8, "rows": 10})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
