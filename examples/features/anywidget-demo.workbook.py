# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "anywidget",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import math

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    bind,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["AnywidgetDemoWorkbook"]):
    @cell("A1", label="counter", view={"display": "rendered", "span": [1, 2]})
    @computed
    def counter(self):
        # the counter shows and edits the input cell count
        return bind(self.Counter()(), value=self.count())

    @cell("B1", label="pad", view={"display": "rendered", "span": [1, 5]})
    @computed
    def pad(self):
        # the pad shows and edits the input cells pad_x and pad_y
        return bind(self.XYPad()(), x=self.pad_x(), y=self.pad_y())

    # the dot's x position, 0-100 (the pad writes it)
    pad_x = cell("C1", field(30), label="pad_x")

    @cell("D1", label="Counter")
    @computed
    def Counter(self):
        import anywidget
        import traitlets

        class Counter(anywidget.AnyWidget):
            """The classic anywidget counter: the same class runs in Jupyter, marimo, VS Code…"""

            _esm = """
            function render({ model, el }) {
              const button = document.createElement("button");
              const update = () => { button.textContent = `count is ${model.get("value")}`; };
              button.addEventListener("click", () => {
                model.set("value", model.get("value") + 1);
                model.save_changes();
              });
              model.on("change:value", update);
              update();
              el.append(button);
            }
            export default { render };
            """
            _css = """
            button { padding: 6px 14px; border: 1px solid #c9c2f2; border-radius: 8px;
                     background: #f3f0ff; color: #4b36a8; font: 600 14px system-ui; cursor: pointer; }
            button:hover { background: #e9e3ff; }
            """
            value = traitlets.Int(0).tag(sync=True)

        return Counter

    # the dot's y position, 0-100 (the pad writes it)
    pad_y = cell("C2", field(70), label="pad_y")

    @cell("D2", label="XYPad")
    @computed
    def XYPad(self):
        import anywidget
        import traitlets

        class XYPad(anywidget.AnyWidget):
            """Drag the dot: x and y (0–100) sync back to Python while you drag."""

            _esm = """
            function render({ model, el }) {
              const size = 180;
              const pad = document.createElement("canvas");
              pad.width = pad.height = size;
              pad.style.cssText = "border:1px solid #ddd;border-radius:10px;cursor:crosshair;touch-action:none";
              const context = pad.getContext("2d");
              const draw = () => {
                const x = model.get("x") / 100 * size, y = (1 - model.get("y") / 100) * size;
                context.clearRect(0, 0, size, size);
                context.strokeStyle = "#eee";
                for (let i = 1; i < 4; i++) {
                  context.beginPath(); context.moveTo(i * size / 4, 0); context.lineTo(i * size / 4, size); context.stroke();
                  context.beginPath(); context.moveTo(0, i * size / 4); context.lineTo(size, i * size / 4); context.stroke();
                }
                context.fillStyle = "#eb6834";
                context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill();
              };
              const move = (event) => {
                const box = pad.getBoundingClientRect();
                const clamp = (v) => Math.round(Math.min(100, Math.max(0, v)));
                model.set("x", clamp((event.clientX - box.left) / box.width * 100));
                model.set("y", clamp(100 - (event.clientY - box.top) / box.height * 100));
                model.save_changes();
              };
              pad.addEventListener("pointerdown", (event) => { pad.setPointerCapture(event.pointerId); move(event); });
              pad.addEventListener("pointermove", (event) => { if (event.buttons) move(event); });
              model.on("change:x", draw);
              model.on("change:y", draw);
              draw();
              el.append(pad);
            }
            export default { render };
            """
            x = traitlets.Int(50).tag(sync=True)
            y = traitlets.Int(50).tag(sync=True)

        return XYPad

    price = cell("A3", field(12.5), label="price")

    @cell("C3", label="distance")
    @computed
    def distance(self):
        import math

        # distance from the centre, as a percentage of the maximum
        return round(math.dist((self.pad_x(), self.pad_y()), (50, 50)) / math.dist((0, 0), (50, 50)) * 100)

    @cell("A4", label="total")
    @computed
    def total(self):
        # every click writes `count`, which re-runs this cell
        return self.count() * self.price()

    # how often the counter was clicked (the counter writes it)
    count = cell("A5", field(3), label="count")

    @cell("A7", label="about_widgets")
    @markdown
    def about_widgets(self):
        return """# 🧩 anywidget in Reaktiv Workbook

        These widgets are ordinary [anywidget](https://anywidget.dev) classes, each defined in its own cell (D1, D2) — the same Python classes work in Jupyter, JupyterLab, VS Code, Colab, and marimo.

        Widgets are views of input cells: `bind(Counter(), value=count)` shows the cell `count` in the counter, and a
        click writes the new value back to that cell. Everything that depends on it re-runs, and the value is saved with
        the workbook. What a widget keeps for itself (hover, animation) stays inside it.

        {{ self.counter() }}

        Clicked **{{ self.count() }}** times × {{ self.price() }} = **{{ self.total() }}**.

        {{ self.pad() }}

        The dot is at **({{ self.pad_x() }}, {{ self.pad_y() }})**, {{ self.distance() }}% of the way from the centre to a corner."""


@workbook_config({"formatVersion": 2, "name": "anywidget demo"})
class AnywidgetDemoWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 6, "rows": 12},
        layout={"columnWidths": {"A": 220, "B": 230, "C": 170, "D": 260}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
