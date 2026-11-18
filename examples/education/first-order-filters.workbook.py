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


class ModelWorksheet(Worksheet["FirstOrderFiltersWorkbook"]):
    # R in kΩ
    resistance = cell(
        "A1",
        field(10),
        label="resistance",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B1", label="tau_ms")
    @computed
    def tau_ms(self):
        return round(self.resistance() * self.capacitance() * 1e-3, 4)

    @cell("C1", label="step", view={"display": "rendered", "span": [2, 8]})
    @computed
    def step(self):
        import plotly.graph_objects as go

        t = np.linspace(0, 5 * self.tau_ms(), 200)
        figure = go.Figure(go.Scatter(x=t, y=1 - np.exp(-t / self.tau_ms()), name="capacitor voltage", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=t, y=np.exp(-t / self.tau_ms()), name="resistor voltage", line=dict(color="#eb6834", dash="dash"))
        figure.add_vline(x=self.tau_ms(), line_dash="dot", line_color="#8b8b84", annotation_text="τ")
        figure.update_layout(**self.chart_layout()("Response to a 1 V step", "time (ms)", "voltage (V)"))
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

    @cell("F1", label="p1_charging")
    @markdown
    def p1_charging(self):
        return """# 1 · Charging a capacitor

        A resistor in series with a capacitor. Switch on 1 V: the capacitor cannot jump, it charges
        through the resistor with the **time constant** $\\tau = RC$.

        ```mermaid
        flowchart LR
            IN((V_in)) --- R[R = {{ self.resistance() }} kΩ] --- OUT((V_C))
            OUT --- C[C = {{ self.capacitance() }} nF] --- GND((GND))
        ```

        [R (kΩ): {{ self.resistance() }}](#sheet-input:resistance?type=range&min=1&max=100&step=1)

        [C (nF): {{ self.capacitance() }}](#sheet-input:capacitance?type=range&min=1&max=100&step=1)

        {{ self.step() }}

        $\\tau =$ **{{ self.tau_ms() }} ms**: after one $\\tau$ the capacitor has 63 % of the final voltage,
        after $3\\tau =$ {{ self.settle_ms() }} ms about 95 %.

        $$v_C(t) = 1 - e^{-t/\\tau} \\qquad v_R(t) = e^{-t/\\tau}$$

        ## Check yourself

        - Double R. What happens to the charging time?
        - The two voltages always add up to 1 V. Why?

        ---

        **Next:** [2 · The same circuit as a low-pass](#note-p2_frequency_response)"""

    # C in nF
    capacitance = cell(
        "A2",
        field(10),
        label="capacitance",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B2", label="settle_ms")
    @computed
    def settle_ms(self):
        return round(3 * self.tau_ms(), 4)

    @cell("F2", label="p2_frequency_response")
    @markdown
    def p2_frequency_response(self):
        return """# 2 · The same circuit as a low-pass

        A slow capacitor cannot follow a fast signal. Feed a sine wave instead of a step and the
        voltage across C shrinks as the frequency rises: a **low-pass filter**.

        [Signal frequency (Hz): {{ self.frequency() }}](#sheet-input:frequency?type=range&min=10&max=100000&step=10)

        [R (kΩ): {{ self.resistance() }}](#sheet-input:resistance?type=range&min=1&max=100&step=1)

        [C (nF): {{ self.capacitance() }}](#sheet-input:capacitance?type=range&min=1&max=100&step=1)

        {{ self.bode() }}

        | Quantity | Value |
        | --- | --- |
        | Cutoff frequency $f_c$ | **{{ self.cutoff() }} Hz** |
        | Gain at {{ self.frequency() }} Hz | {{ self.gain() }} ({{ self.gain_db() }} dB) |
        | Phase shift | {{ self.phase() }}° |

        $$H(f) = \\frac{1}{1 + j\\,f/f_c} \\qquad f_c = \\frac{1}{2\\pi R C} = \\frac{1}{2\\pi\\tau}$$

        At $f_c$ the gain is $1/\\sqrt 2$ (−3 dB) and the phase −45°; far above it the gain falls
        by 20 dB per decade.

        ## Check yourself

        - Design a cutoff near 1 kHz. Is there only one solution?
        - How is $f_c$ related to the time constant from page 1?

        ---

        **Previous:** [1 · Charging a capacitor](#note-p1_charging) · **Next:** [3 · Low-pass and high-pass](#note-p3_low_and_high_pass)"""

    # signal frequency in Hz
    frequency = cell(
        "A3",
        field(1000),
        label="frequency",
        view={"widget": {"type": "range", "min": 10, "max": 100000, "step": 10}},
    )

    @cell("B3", label="cutoff")
    @computed
    def cutoff(self):
        return round(1 / (2 * math.pi * self.resistance() * 1e3 * self.capacitance() * 1e-9), 1)

    @cell("F3", label="p3_low_and_high_pass")
    @markdown
    def p3_low_and_high_pass(self):
        return """# 3 · Low-pass and high-pass

        Page 1 showed two voltages: across C and across R. Take the output across the
        **resistor** instead and the same circuit passes fast signals and blocks slow ones.

        [Signal frequency (Hz): {{ self.frequency() }}](#sheet-input:frequency?type=range&min=10&max=100000&step=10)

        [R (kΩ): {{ self.resistance() }}](#sheet-input:resistance?type=range&min=1&max=100&step=1)

        {{ self.both() }}

        At {{ self.frequency() }} Hz the low-pass output is **{{ self.gain_db() }} dB** and the high-pass output
        **{{ self.high_gain_db() }} dB**. The curves cross at $f_c =$ {{ self.cutoff() }} Hz, both at −3 dB.

        $$|H_\\text{LP}| = \\frac{1}{\\sqrt{1 + (f/f_c)^2}} \\qquad |H_\\text{HP}| = \\frac{f/f_c}{\\sqrt{1 + (f/f_c)^2}}$$

        Their squares add up to 1 at every frequency: the signal power is split between R and C.

        ## Check yourself

        - Which output would you use to remove mains hum (50 Hz) from an audio signal?
        - Which one to smooth a noisy sensor reading?

        ---

        **Previous:** [2 · The same circuit as a low-pass](#note-p2_frequency_response)"""

    @cell("B4", label="ratio")
    @computed
    def ratio(self):
        return self.frequency() / self.cutoff()

    @cell("B5", label="gain")
    @computed
    def gain(self):
        return round(1 / math.sqrt(1 + self.ratio()**2), 4)

    @cell("B6", label="gain_db")
    @computed
    def gain_db(self):
        return round(20 * math.log10(self.gain()), 2)

    @cell("B7", label="phase")
    @computed
    def phase(self):
        return round(-math.degrees(math.atan(self.ratio())), 1)

    @cell("B8", label="high_gain")
    @computed
    def high_gain(self):
        return round(self.ratio() / math.sqrt(1 + self.ratio()**2), 4)

    @cell("B9", label="high_gain_db")
    @computed
    def high_gain_db(self):
        return round(20 * math.log10(self.high_gain()), 2)

    @cell("C9", label="bode", view={"display": "rendered", "span": [2, 8]})
    @computed
    def bode(self):
        import plotly.graph_objects as go

        f = np.logspace(1, 5, 200)
        figure = go.Figure(go.Scatter(x=f, y=-10 * np.log10(1 + (f / self.cutoff()) ** 2), name="low-pass", line=dict(color="#2a78d6", width=3)))
        figure.add_vline(x=self.cutoff(), line_dash="dot", line_color="#8b8b84", annotation_text="cutoff")
        figure.add_scatter(x=[self.frequency()], y=[self.gain_db()], mode="markers", name="signal", marker=dict(color="#7157d9", size=12))
        figure.update_layout(**self.chart_layout()("Magnitude response", "frequency (Hz)", "gain (dB)", xaxis_type="log", yaxis_range=[-45, 3]))
        return figure

    @cell("C17", label="both", view={"display": "rendered", "span": [2, 8]})
    @computed
    def both(self):
        import plotly.graph_objects as go

        f = np.logspace(1, 5, 200)
        figure = go.Figure(go.Scatter(x=f, y=-10 * np.log10(1 + (f / self.cutoff()) ** 2), name="low-pass (across C)", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=f, y=-10 * np.log10(1 + (self.cutoff() / f) ** 2), name="high-pass (across R)", line=dict(color="#eb6834", width=3))
        figure.add_scatter(x=[self.frequency(), self.frequency()], y=[self.gain_db(), self.high_gain_db()], mode="markers", name="signal", marker=dict(color="#7157d9", size=12))
        figure.update_layout(**self.chart_layout()("One circuit, two filters", "frequency (Hz)", "gain (dB)", xaxis_type="log", yaxis_range=[-45, 3]))
        return figure


@workbook_config(
    {
        "formatVersion": 2,
        "name": "First-order filters",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class FirstOrderFiltersWorkbook(Workbook):
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
