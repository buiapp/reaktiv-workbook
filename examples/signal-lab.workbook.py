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


class SignalWorksheet(Worksheet["SignalLabWorkbook"]):
    # samples per second
    fs = cell(
        "A1",
        field(1000),
        label="fs",
        view={
            "widget": {
                "type": "range",
                "min": 250,
                "max": 4000,
                "step": 250,
                "label": "Sample rate (Hz)",
            }
        },
    )

    @cell("B1", label="t")
    @computed
    def t(self):
        # one second of sample times
        return np.arange(int(self.fs())) / self.fs()

    @cell("C1", label="time_chart", view={"display": "rendered", "span": [3, 4]})
    @computed
    def time_chart(self):
        import plotly.graph_objects as go

        shown = self.t() < 0.5
        figure = go.Figure()
        figure.add_scatter(x=self.t()[shown], y=self.measured()[shown], name="measured", line=dict(color="#b9bdb4", width=1))
        figure.add_scatter(x=self.t()[shown], y=self.target()[shown], name="true signal", line=dict(color="#1baf7a", width=2, dash="dot"))
        figure.add_scatter(x=self.t()[shown], y=self.filtered()[shown], name="filtered", line=dict(color="#7157d9", width=2.5))
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Time (first 0.5 s)", x=0, font=dict(size=14)),
                             xaxis_title="time (s)", legend=dict(orientation="h", x=1, xanchor="right", y=1.02, yanchor="bottom"))
        return figure

    @cell("F1", label="response_chart", view={"display": "rendered", "span": [2, 4]})
    @computed
    def response_chart(self):
        import plotly.graph_objects as go

        response = np.fft.rfft(self.kernel(), 4096)
        freqs = np.fft.rfftfreq(4096, 1 / self.fs())
        figure = go.Figure(go.Scatter(x=freqs, y=20 * np.log10(np.abs(response) + 1e-9), line=dict(color="#7157d9", width=2)))
        figure.add_vline(x=self.hum(), line_dash="dot", line_color="#eb6834", annotation_text="interference")
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Filter response", x=0, font=dict(size=14)),
                             xaxis_title="frequency (Hz)", yaxis_title="gain (dB)", yaxis_range=[-100, 5],
                             xaxis_range=[0, min(self.fs() / 2, 3 * max(self.hum(), self.cutoff()))])
        return figure

    @cell("H1", label="signal_lab")
    @markdown
    def signal_lab(self):
        return """# 〰️ Signal lab

        Recover a **{{ self.tone() }} Hz** signal buried in **{{ self.hum() }} Hz** interference and noise with a
        windowed-sinc low-pass filter. Every number and plot on this page follows the sliders.

        [Signal tone (Hz): {{ self.tone() }}](#sheet-input:tone?type=range&min=1&max=50&step=1)

        [Interference (Hz): {{ self.hum() }}](#sheet-input:hum?type=range&min=20&max=120&step=5)

        [Noise (σ): {{ self.noise() }}](#sheet-input:noise?type=range&min=0&max=2&step=0.05)

        [Cutoff (Hz): {{ self.cutoff() }}](#sheet-input:cutoff?type=range&min=2&max=120&step=1)

        [Filter taps: {{ self.taps() }}](#sheet-input:taps?type=range&min=11&max=401&step=10)

        [Window: {{ self.window() }}](#sheet-input:window?type=select&options=Hamming,Hann,Blackman,Rectangular)

        The filter lifts the signal-to-noise ratio from **{{ self.snr_before() }} dB** to **{{ self.snr_after() }} dB**:
        **{{ self.gain() }} dB** better.

        {{ self.time_chart() }}

        {{ self.spectrum_chart() }}

        {{ self.response_chart() }}

        Open **Cells** to see each step as its own cell (sample times, measurement, kernel, filtered
        signal) with the plots beside them. Try a cutoff above the interference, or a rectangular window."""

    # the signal we want to keep
    tone = cell(
        "A2",
        field(8),
        label="tone",
        view={
            "widget": {
                "type": "range",
                "min": 1,
                "max": 50,
                "step": 1,
                "label": "Signal tone (Hz)",
            }
        },
    )

    @cell("B2", label="target")
    @computed
    def target(self):
        return np.sin(2 * np.pi * self.tone() * self.t())

    # mains-style interference
    hum = cell(
        "A3",
        field(50),
        label="hum",
        view={
            "widget": {
                "type": "range",
                "min": 20,
                "max": 120,
                "step": 5,
                "label": "Interference (Hz)",
            }
        },
    )

    @cell("B3", label="measured")
    @computed
    def measured(self):
        # what the sensor sees: signal + interference + noise
        rng = np.random.default_rng(7)
        return self.target() + self.hum_level() * np.sin(2 * np.pi * self.hum() * self.t()) + rng.normal(0, self.noise(), self.t().size)

    hum_level = cell(
        "A4",
        field(0.8),
        label="hum_level",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 2,
                "step": 0.1,
                "label": "Interference level",
            }
        },
    )

    @cell("B4", label="kernel")
    @computed
    def kernel(self):
        # windowed-sinc low-pass filter, normalised to unit gain
        n = np.arange(self.taps()) - (self.taps() - 1) / 2
        ideal = 2 * self.cutoff() / self.fs() * np.sinc(2 * self.cutoff() / self.fs() * n)
        shapes = {"Hamming": np.hamming, "Hann": np.hanning, "Blackman": np.blackman, "Rectangular": np.ones}
        kernel = ideal * shapes[self.window()](self.taps())
        return kernel / kernel.sum()

    # standard deviation of white noise
    noise = cell(
        "A5",
        field(0.5),
        label="noise",
        view={
            "widget": {
                "type": "range",
                "min": 0,
                "max": 2,
                "step": 0.05,
                "label": "Noise (σ)",
            }
        },
    )

    @cell("B5", label="filtered")
    @computed
    def filtered(self):
        return np.convolve(self.measured(), self.kernel(), mode="same")

    @cell("C5", label="spectrum_chart", view={"display": "rendered", "span": [3, 4]})
    @computed
    def spectrum_chart(self):
        import plotly.graph_objects as go

        freqs = np.fft.rfftfreq(self.t().size, 1 / self.fs())
        level = lambda x: 20 * np.log10(np.abs(np.fft.rfft(x)) / self.t().size + 1e-9)
        figure = go.Figure()
        figure.add_scatter(x=freqs, y=level(self.measured()), name="measured", line=dict(color="#b9bdb4", width=1))
        figure.add_scatter(x=freqs, y=level(self.filtered()), name="filtered", line=dict(color="#7157d9", width=1.5))
        figure.add_vline(x=self.cutoff(), line_dash="dash", line_color="#eb6834", annotation_text="cutoff")
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text="Spectrum", x=0, font=dict(size=14)),
                             xaxis_title="frequency (Hz)", yaxis_title="dB", xaxis_range=[0, min(self.fs() / 2, 3 * max(self.hum(), self.cutoff()))],
                             legend=dict(orientation="h", x=1, xanchor="right", y=1.02, yanchor="bottom"))
        return figure

    @cell("F5", label="kernel_chart", view={"display": "rendered", "span": [2, 4]})
    @computed
    def kernel_chart(self):
        import plotly.graph_objects as go

        figure = go.Figure(go.Bar(y=self.kernel(), marker_color="#7157d9"))
        figure.update_layout(template="plotly_white", height=300, margin=dict(l=44, r=12, t=40, b=40), title=dict(text=f"Kernel ({self.taps()} taps, {self.window()})", x=0, font=dict(size=14)),
                             xaxis_title="tap", bargap=0)
        return figure

    # low-pass cutoff
    cutoff = cell(
        "A6",
        field(20),
        label="cutoff",
        view={
            "widget": {
                "type": "range",
                "min": 2,
                "max": 120,
                "step": 1,
                "label": "Cutoff (Hz)",
            }
        },
    )

    @cell("B6", label="snr_before")
    @computed
    def snr_before(self):
        # signal-to-noise ratio in dB
        return round(float(10 * np.log10(np.var(self.target()) / np.var(self.measured() - self.target()))), 1)

    # filter length: more taps, steeper edge
    taps = cell(
        "A7",
        field(101),
        label="taps",
        view={
            "widget": {
                "type": "range",
                "min": 11,
                "max": 401,
                "step": 10,
                "label": "Filter taps",
            }
        },
    )

    @cell("B7", label="snr_after")
    @computed
    def snr_after(self):
        return round(float(10 * np.log10(np.var(self.target()) / np.var(self.filtered() - self.target()))), 1)

    window = cell(
        "A8",
        field("Hamming"),
        label="window",
        view={
            "widget": {
                "type": "select",
                "options": ["Hamming", "Hann", "Blackman", "Rectangular"],
                "label": "Window",
            }
        },
    )

    @cell("B8", label="gain")
    @computed
    def gain(self):
        return round(self.snr_after() - self.snr_before(), 1)


@workbook_config({"formatVersion": 2, "name": "Signal lab"})
class SignalLabWorkbook(Workbook):
    Signal = worksheet(SignalWorksheet, grid={"columns": 8, "rows": 8})


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
