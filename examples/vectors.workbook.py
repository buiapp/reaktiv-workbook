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


class Sheet1Worksheet(Worksheet["VectorsYouCanTouchWorkbook"]):
    @cell("A1", label="VectorPad")
    @computed
    def VectorPad(self):
        import anywidget
        import traitlets


        class VectorPad(anywidget.AnyWidget):
            """A vector you can drag; x and y sync back to Python."""

            _esm = """
        function render({ model, el }) {
          el.innerHTML = `
            <div class="panel">
              <p><strong>Drag the point</strong>, or focus it and use the arrow keys.</p>
              <svg viewBox="0 0 600 260" aria-label="Vector and its components">
                <path class="axis" d="M140 130H460 M300 5V255" />
                <path id="projection" fill="none" stroke="#8b8b84" stroke-dasharray="5 5" />
                <path id="arrow" stroke="#7157d9" stroke-width="4" />
                <circle id="dot" r="10" fill="#7157d9" tabindex="0" role="button" aria-label="Move the vector's end point" style="touch-action:none;cursor:grab" />
              </svg>
              <p id="status" class="muted" aria-live="polite"></p>
            </div>`;
          const svg = el.querySelector('svg'), dot = el.querySelector('#dot');
          const arrow = el.querySelector('#arrow'), projection = el.querySelector('#projection'), status = el.querySelector('#status');
          let point = { x: model.get('x'), y: model.get('y') }, dragging = false;
          const clamp = (n) => Math.round(Math.max(-5, Math.min(5, n)) * 10) / 10;
          const draw = () => {
            const x = 300 + point.x * 24, y = 130 - point.y * 24;
            dot.setAttribute('cx', x); dot.setAttribute('cy', y);
            arrow.setAttribute('d', `M300 130L${x} ${y}`);
            projection.setAttribute('d', `M300 130H${x}V${y}`);
            status.textContent = `x = ${point.x}, y = ${point.y}`;
          };
          // Draw while dragging; save both coordinates together when the point is released.
          // Copy the point first: model.set('x', …) fires change:x, which reads the model's old y.
          const commit = () => { const { x, y } = point; model.set('x', x); model.set('y', y); model.save_changes(); };
          const position = (event) => {
            const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
            return { x: clamp((p.x - 300) / 24), y: clamp((130 - p.y) / 24) };
          };
          dot.addEventListener('pointerdown', (event) => { dragging = true; dot.setPointerCapture(event.pointerId); });
          dot.addEventListener('pointermove', (event) => { if (dragging) { point = position(event); draw(); } });
          dot.addEventListener('pointerup', () => { if (dragging) { dragging = false; commit(); } });
          dot.addEventListener('pointercancel', () => { dragging = false; });
          dot.addEventListener('keydown', (event) => {
            const delta = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[event.key];
            if (!delta) return;
            event.preventDefault();
            point = { x: clamp(point.x + delta[0]), y: clamp(point.y + delta[1]) };
            draw(); commit();
          });
          const fromModel = () => { if (!dragging) { point = { x: model.get('x'), y: model.get('y') }; draw(); } };
          model.on('change:x', fromModel);
          model.on('change:y', fromModel);
          draw();
        }
        export default { render };
        """
            _css = """:host, .panel { color-scheme: light dark; }
        .panel { display: grid; gap: 12px; padding: 14px 16px; font: 14px/1.45 system-ui, sans-serif;
          color: light-dark(#20231f, #e3e6de); }
        .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
        label { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
        input[type=range] { accent-color: #7157d9; }
        button { padding: 5px 12px; border: 1px solid light-dark(#cfd6c8, #3a3f36); border-radius: 7px;
          background: light-dark(#fff, #1b1e18); color: inherit; font: inherit; cursor: pointer; }
        button:disabled { opacity: .45; cursor: default; }
        svg { display: block; width: 100%; height: auto; overflow: visible; }
        .axis { stroke: light-dark(#cfd6c8, #3a3f36); }
        .muted { color: light-dark(#5d6459, #9da397); }
        """
            x = traitlets.Float(3.0).tag(sync=True)
            y = traitlets.Float(4.0).tag(sync=True)

        return VectorPad

    @cell("B1", label="vector", view={"display": "rendered", "span": [3, 8]})
    @computed
    def vector(self):
        # the widget shows and edits the input cells vector_x and vector_y
        return bind(self.VectorPad()(), x=self.vector_x(), y=self.vector_y())

    @cell("F1", label="vector_lesson")
    @markdown
    def vector_lesson(self):
        return """# Vectors you can touch

        A vector has a horizontal and a vertical component. Its length follows Pythagoras and its
        direction is an angle:

        $$|v| = \\sqrt{x^2 + y^2} \\qquad \\varphi = \\operatorname{atan2}(y, x)$$

        {{ self.vector() }}

        The vector $({{ self.vector_x() }}, {{ self.vector_y() }})$ has length **{{ self.length() }}** and points at
        **{{ self.angle() }}°**, in quadrant {{ self.quadrant() }}.

        The point's coordinates live in the input cells `vector_x` and `vector_y`: dragging writes them, and everything else reads them. Type a value into one of them and the point moves.

        ## Experiment

        - Start with the **3–4–5 triangle**. Find another vector of length 5.
        - Drag across the origin. Can a component be negative while the length stays positive?
        - Which angles do the four quadrants cover?"""

    # the vector's horizontal component (the widget writes it)
    vector_x = cell("A2", field(3.0), label="vector_x")

    # the vector's vertical component (the widget writes it)
    vector_y = cell("A3", field(4.0), label="vector_y")

    @cell("B9", label="length")
    @computed
    def length(self):
        return round(math.hypot(self.vector_x(), self.vector_y()), 3)

    @cell("B10", label="angle")
    @computed
    def angle(self):
        return round(math.degrees(math.atan2(self.vector_y(), self.vector_x())), 1)

    @cell("B11", label="quadrant")
    @computed
    def quadrant(self):
        return "one of the axes" if self.vector_x() == 0 or self.vector_y() == 0 else ["I", "II", "III", "IV"][(self.vector_y() < 0) * 2 + ((self.vector_x() < 0) != (self.vector_y() < 0))]


@workbook_config({"formatVersion": 2, "name": "Vectors you can touch"})
class VectorsYouCanTouchWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 8, "rows": 16},
        layout={"columnWidths": {"A": 220, "B": 220, "C": 220, "D": 220, "F": 300}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
