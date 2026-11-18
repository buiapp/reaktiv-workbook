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


class ModelWorksheet(Worksheet["GasesWorkbook"]):
    # amount of gas in mol
    amount = cell(
        "A1",
        field(1),
        label="amount",
        view={"widget": {"type": "range", "min": 0.1, "max": 5, "step": 0.1}},
    )

    @cell("B1", label="kelvin")
    @computed
    def kelvin(self):
        return self.celsius() + 273.15

    @cell("C1", label="boyle", view={"display": "rendered", "span": [2, 8]})
    @computed
    def boyle(self):
        import plotly.graph_objects as go

        volumes = np.linspace(1, 60, 120)
        figure = go.Figure(go.Scatter(x=volumes, y=self.amount() * self.R() * self.kelvin() / volumes, name=f"{self.celsius()} °C", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=[self.volume()], y=[self.pressure()], mode="markers", name="now", marker=dict(color="#7157d9", size=12))
        figure.update_layout(**self.chart_layout()("Pressure against volume", "volume (L)", "pressure (kPa)", yaxis_range=[0, 600]))
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

    @cell("F1", label="p1_pressure_and_volume")
    @markdown
    def p1_pressure_and_volume(self):
        return """# 1 · Pressure and volume

        Squeeze a gas into less space and its particles hit the walls more often: the **pressure**
        rises. At constant temperature, pressure and volume are inversely proportional
        (**Boyle's law**).

        [Volume V (L): {{ self.volume() }}](#sheet-input:volume?type=range&min=1&max=60&step=0.5)

        {{ self.boyle() }}

        The pressure is **{{ self.pressure() }} kPa**. The product $p \\cdot V$ is **{{ self.product() }}** and
        stays the same while you move the slider.

        ## Check yourself

        - Halve the volume. What happens to the pressure?
        - Which shape does the curve have? Compare with *Functions*.

        ---

        **Next:** [2 · Temperature and the kelvin scale](#note-p2_temperature)"""

    # temperature in °C
    celsius = cell(
        "A2",
        field(20),
        label="celsius",
        view={"widget": {"type": "range", "min": -100, "max": 300, "step": 5}},
    )

    @cell("B2", label="pressure")
    @computed
    def pressure(self):
        return round(self.amount() * self.R() * self.kelvin() / self.volume(), 1)

    @cell("F2", label="p2_temperature")
    @markdown
    def p2_temperature(self):
        return """# 2 · Temperature and the kelvin scale

        Heat the gas in a closed container and the pressure rises along a **straight line**.
        Extended to the left, the line reaches zero pressure at −273.15 °C: **absolute zero**.
        Counting from there gives the kelvin scale.

        [Temperature (°C): {{ self.celsius() }}](#sheet-input:celsius?type=range&min=-100&max=300&step=5)

        {{ self.heating() }}

        **{{ self.celsius() }} °C** is **{{ self.kelvin() }} K**, and the pressure is **{{ self.pressure() }} kPa**.

        $$T = \\vartheta + 273.15$$

        ## Check yourself

        - Double the temperature in °C, then in K. Which one doubles the pressure?
        - Why can no gas be colder than 0 K?

        ---

        **Previous:** [1 · Pressure and volume](#note-p1_pressure_and_volume) · **Next:** [3 · The ideal gas law](#note-p3_ideal_gas_law)"""

    # volume in litres
    volume = cell(
        "A3",
        field(24),
        label="volume",
        view={"widget": {"type": "range", "min": 1, "max": 60, "step": 0.5}},
    )

    @cell("B3", label="product")
    @computed
    def product(self):
        return round(self.amount() * self.R() * self.kelvin())

    @cell("F3", label="p3_ideal_gas_law")
    @markdown
    def p3_ideal_gas_law(self):
        return """# 3 · The ideal gas law

        Pages 1 and 2 are two views of one equation, which also contains the **amount** of gas:

        $$p \\cdot V = n \\cdot R \\cdot T \\qquad R = 8.314\\ \\text{kPa·L/(mol·K)}$$

        [Amount n (mol): {{ self.amount() }}](#sheet-input:amount?type=range&min=0.1&max=5&step=0.1)

        [Temperature (°C): {{ self.celsius() }}](#sheet-input:celsius?type=range&min=-100&max=300&step=5)

        [Volume V (L): {{ self.volume() }}](#sheet-input:volume?type=range&min=1&max=60&step=0.5)

        The gas presses with **{{ self.pressure() }} kPa** = **{{ self.atmospheres() }} atm**. At this
        temperature and normal air pressure, one mole of *any* ideal gas fills
        **{{ self.molar_volume() }} L**.

        ## Which gas?

        The law does not care which gas it is, but the **mass** does:

        [Gas: {{ self.gas() }}](#sheet-input:gas?type=select&options=Helium,Air,Carbon%20dioxide)

        {{ self.amount() }} mol of {{ self.gas() }} weighs {{ self.molar_mass() }} g per mole, so its density is
        **{{ self.density() }} g/L**. Air under the same conditions has {{ self.air_density() }} g/L: a balloon
        filled with {{ self.gas() }} **{{ self.balloon() }}**.

        ## Check yourself

        - Find the volume of 1 mol at 0 °C and 1 atm.
        - Does the answer to "rises or sinks" depend on temperature? Why not?

        ---

        **Previous:** [2 · Temperature and the kelvin scale](#note-p2_temperature)"""

    # gas constant in kPa·L/(mol·K)
    R = cell("A4", field(8.314), label="R")

    @cell("B4", label="atmospheres")
    @computed
    def atmospheres(self):
        return round(self.pressure() / 101.325, 2)

    gas = cell(
        "A5",
        field("Helium"),
        label="gas",
        view={
            "widget": {"type": "select", "options": ["Helium", "Air", "Carbon dioxide"]}
        },
    )

    @cell("B5", label="molar_volume")
    @computed
    def molar_volume(self):
        return round(self.R() * self.kelvin() / 101.325, 1)

    @cell("B6", label="molar_mass")
    @computed
    def molar_mass(self):
        return {"Helium": 4.0, "Air": 28.97, "Carbon dioxide": 44.01}[self.gas()]

    @cell("B7", label="density")
    @computed
    def density(self):
        return round(self.molar_mass() * self.amount() / self.volume(), 3)

    @cell("B8", label="air_density")
    @computed
    def air_density(self):
        return round(28.97 * self.amount() / self.volume(), 3)

    @cell("B9", label="balloon")
    @computed
    def balloon(self):
        return "rises" if self.density() < self.air_density() else "sinks" if self.density() > self.air_density() else "floats"

    @cell("C9", label="heating", view={"display": "rendered", "span": [2, 8]})
    @computed
    def heating(self):
        import plotly.graph_objects as go

        temperatures = np.linspace(-273.15, 300, 100)
        figure = go.Figure(go.Scatter(x=temperatures, y=self.amount() * self.R() * (temperatures + 273.15) / self.volume(), name="pressure", line=dict(color="#eb6834", width=3)))
        figure.add_scatter(x=[self.celsius()], y=[self.pressure()], mode="markers", name="now", marker=dict(color="#7157d9", size=12))
        figure.add_vline(x=-273.15, line_dash="dot", line_color="#8b8b84", annotation_text="absolute zero")
        figure.update_layout(**self.chart_layout()("Pressure against temperature", "temperature (°C)", "pressure (kPa)"))
        return figure


@workbook_config(
    {"formatVersion": 2, "name": "Gases", "layout": {"noteOrder": ["F1", "F2", "F3"]}}
)
class GasesWorkbook(Workbook):
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
