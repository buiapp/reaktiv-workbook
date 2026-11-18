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


class ModelWorksheet(Worksheet["MotionWorkbook"]):
    # speed at the beginning in m/s
    start_speed = cell(
        "A1",
        field(5),
        label="start_speed",
        view={"widget": {"type": "range", "min": 0, "max": 30, "step": 1}},
    )

    @cell("B1", label="end_speed")
    @computed
    def end_speed(self):
        return round(self.start_speed() + self.acceleration() * self.duration(), 2)

    @cell("C1", label="motion_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def motion_graph(self):
        import plotly.graph_objects as go

        t = np.linspace(0, self.duration(), 60)
        figure = go.Figure(go.Scatter(x=t, y=self.start_speed() * t + self.acceleration() * t**2 / 2, name="distance (m)", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=t, y=self.start_speed() + self.acceleration() * t, name="speed (m/s)", yaxis="y2", line=dict(color="#eb6834", width=3))
        figure.update_layout(**self.chart_layout()("Distance and speed over time", "time (s)", "distance (m)", yaxis2=dict(title="speed (m/s)", overlaying="y", side="right", showgrid=False)))
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

    @cell("F1", label="p1_speeding_up")
    @markdown
    def p1_speeding_up(self):
        return """# 1 · Speeding up and slowing down

        **Acceleration** is how much the speed changes per second. With constant acceleration the
        speed is a straight line and the distance a parabola.

        [Start speed (m/s): {{ self.start_speed() }}](#sheet-input:start_speed?type=range&min=0&max=30&step=1)

        [Acceleration (m/s²): {{ self.acceleration() }}](#sheet-input:acceleration?type=range&min=-5&max=5&step=0.5)

        [Time (s): {{ self.duration() }}](#sheet-input:duration?type=range&min=1&max=20&step=1)

        {{ self.motion_graph() }}

        After **{{ self.duration() }} s** the speed is **{{ self.end_speed() }} m/s** and the distance
        **{{ self.travelled() }} m**.

        $$v = v_0 + a t \\qquad s = v_0 t + \\tfrac{1}{2} a t^2$$

        ## Check yourself

        - Brake: choose a negative acceleration. When does the car stand still?
        - With $a = 0$, which kind of function is the distance?

        ---

        **Next:** [2 · Free fall](#note-p2_free_fall)"""

    # change of speed per second in m/s²
    acceleration = cell(
        "A2",
        field(2),
        label="acceleration",
        view={"widget": {"type": "range", "min": -5, "max": 5, "step": 0.5}},
    )

    @cell("B2", label="travelled")
    @computed
    def travelled(self):
        return round(self.start_speed() * self.duration() + self.acceleration() * self.duration()**2 / 2, 2)

    @cell("F2", label="p2_free_fall")
    @markdown
    def p2_free_fall(self):
        return """# 2 · Free fall

        Dropping something is the same motion with $v_0 = 0$ and $a = g$, the gravitational
        acceleration. The mass does not appear in the formulas.

        [Height (m): {{ self.height() }}](#sheet-input:height?type=range&min=1&max=100&step=1)

        [Gravity (m/s²): {{ self.gravity() }}](#sheet-input:gravity?type=range&min=1.6&max=25&step=0.01)

        {{ self.fall_graph() }}

        From **{{ self.height() }} m** the fall takes **{{ self.fall_time() }} s** and ends at
        **{{ self.impact_speed() }} m/s**, which is **{{ self.impact_kmh() }} km/h**.

        $$h = \\tfrac{1}{2} g t^2 \\;\\Rightarrow\\; t = \\sqrt{\\frac{2h}{g}} \\qquad v = g t$$

        ## Check yourself

        - Four times the height: how much longer is the fall?
        - Set gravity to 1.62 (the Moon). How does the fall time change?

        ---

        **Previous:** [1 · Speeding up and slowing down](#note-p1_speeding_up) · **Next:** [3 · Throwing: two motions at once](#note-p3_projectile_motion)"""

    # how long we watch, in s
    duration = cell(
        "A3",
        field(10),
        label="duration",
        view={"widget": {"type": "range", "min": 1, "max": 20, "step": 1}},
    )

    @cell("B3", label="fall_time")
    @computed
    def fall_time(self):
        return round(math.sqrt(2 * self.height() / self.gravity()), 2)

    @cell("F3", label="p3_projectile_motion")
    @markdown
    def p3_projectile_motion(self):
        return """# 3 · Throwing: two motions at once

        A thrown ball moves **sideways at constant speed** (page 1 with $a = 0$) while it **falls**
        (page 2). Together they make a parabola. Gravity is the value from page 2.

        [Launch speed (m/s): {{ self.speed() }}](#sheet-input:speed?type=range&min=5&max=40&step=1)

        [Launch angle (°): {{ self.angle() }}](#sheet-input:angle?type=range&min=5&max=85&step=1)

        [Gravity (m/s²): {{ self.gravity() }}](#sheet-input:gravity?type=range&min=1.6&max=25&step=0.01)

        {{ self.path() }}

        | Quantity | Value |
        | --- | --- |
        | Time in the air | **{{ self.flight_time() }} s** |
        | Distance | **{{ self.distance() }} m** |
        | Greatest height | **{{ self.max_height() }} m** |

        $$t = \\frac{2 v \\sin\\theta}{g} \\qquad d = \\frac{v^2 \\sin 2\\theta}{g} \\qquad h = \\frac{(v \\sin\\theta)^2}{2g}$$

        ## Check yourself

        - Which angle gives the greatest distance? Try 30°, 45°, and 60°.
        - 30° and 60° reach the same distance. What is different?

        ---

        **Previous:** [2 · Free fall](#note-p2_free_fall)"""

    # drop height in m
    height = cell(
        "A4",
        field(20),
        label="height",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B4", label="impact_speed")
    @computed
    def impact_speed(self):
        return round(self.gravity() * self.fall_time(), 2)

    # 9.81 on Earth, 1.62 on the Moon, 24.8 on Jupiter
    gravity = cell(
        "A5",
        field(9.81),
        label="gravity",
        view={"widget": {"type": "range", "min": 1.6, "max": 25, "step": 0.01}},
    )

    @cell("B5", label="impact_kmh")
    @computed
    def impact_kmh(self):
        return round(self.impact_speed() * 3.6, 1)

    # launch speed in m/s
    speed = cell(
        "A6",
        field(20),
        label="speed",
        view={"widget": {"type": "range", "min": 5, "max": 40, "step": 1}},
    )

    @cell("B6", label="theta")
    @computed
    def theta(self):
        return math.radians(self.angle())

    # launch angle in degrees
    angle = cell(
        "A7",
        field(45),
        label="angle",
        view={"widget": {"type": "range", "min": 5, "max": 85, "step": 1}},
    )

    @cell("B7", label="flight_time")
    @computed
    def flight_time(self):
        return round(2 * self.speed() * math.sin(self.theta()) / self.gravity(), 2)

    @cell("B8", label="distance")
    @computed
    def distance(self):
        return round(self.speed()**2 * math.sin(2 * self.theta()) / self.gravity(), 2)

    @cell("B9", label="max_height")
    @computed
    def max_height(self):
        return round((self.speed() * math.sin(self.theta())) ** 2 / (2 * self.gravity()), 2)

    @cell("C9", label="fall_graph", view={"display": "rendered", "span": [2, 8]})
    @computed
    def fall_graph(self):
        import plotly.graph_objects as go

        t = np.linspace(0, self.fall_time(), 60)
        figure = go.Figure(go.Scatter(x=t, y=self.height() - self.gravity() * t**2 / 2, name="height", line=dict(color="#2a78d6", width=3)))
        figure.update_layout(**self.chart_layout()("A falling ball", "time (s)", "height (m)", yaxis_rangemode="tozero"))
        return figure

    @cell("C17", label="path", view={"display": "rendered", "span": [2, 8]})
    @computed
    def path(self):
        import plotly.graph_objects as go

        t = np.linspace(0, self.flight_time(), 80)
        x = self.speed() * math.cos(self.theta()) * t
        y = self.speed() * math.sin(self.theta()) * t - self.gravity() * t**2 / 2
        figure = go.Figure(go.Scatter(x=x, y=y, name="path", line=dict(color="#2a78d6", width=3)))
        figure.add_scatter(x=[self.distance() / 2], y=[self.max_height()], mode="markers", name="highest point", marker=dict(color="#eb6834", size=11))
        figure.update_layout(**self.chart_layout()("Path of the ball", "distance (m)", "height (m)", yaxis_rangemode="tozero"))
        return figure


@workbook_config(
    {"formatVersion": 2, "name": "Motion", "layout": {"noteOrder": ["F1", "F2", "F3"]}}
)
class MotionWorkbook(Workbook):
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
