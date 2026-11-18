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


class Sheet1Worksheet(Worksheet["WaveLaboratoryWorkbook"]):
    @cell("A1", label="WaveScope")
    @computed
    def WaveScope(self):
        import anywidget
        import traitlets


        class WaveScope(anywidget.AnyWidget):
            """A sine wave with frequency and amplitude sliders and a tracer."""

            _esm = """
        function render({ model, el }) {
          el.innerHTML = `
            <div class="panel">
              <div class="controls">
                <label>Frequency <input id="frequency" type="range" min="1" max="6" step="0.5"><output id="f"></output></label>
                <label>Amplitude <input id="amplitude" type="range" min="0.1" max="1" step="0.1"><output id="a"></output></label>
                <button id="play">Play tracer</button>
              </div>
              <svg viewBox="0 0 600 220" role="img" aria-label="Sine wave">
                <path class="axis" d="M30 110H570 M30 20V200" />
                <path id="curve" fill="none" stroke="#7157d9" stroke-width="3" />
                <circle id="marker" r="6" fill="#eb6834" />
              </svg>
            </div>`;
          const frequency = el.querySelector('#frequency'), amplitude = el.querySelector('#amplitude');
          const curve = el.querySelector('#curve'), marker = el.querySelector('#marker'), play = el.querySelector('#play');
          const point = (t) => [30 + t * 540, 110 - Number(amplitude.value) * 80 * Math.sin(2 * Math.PI * Number(frequency.value) * t)];
          const draw = () => {
            el.querySelector('#f').textContent = frequency.value;
            el.querySelector('#a').textContent = amplitude.value;
            curve.setAttribute('d', Array.from({ length: 241 }, (_, i) => (i ? 'L' : 'M') + point(i / 240).join(' ')).join(''));
          };
          const fromModel = () => { frequency.value = model.get('frequency'); amplitude.value = model.get('amplitude'); draw(); };
          // Redraw while dragging; tell Python on release (one recalculation per change).
          for (const input of [frequency, amplitude]) {
            input.addEventListener('input', draw);
            input.addEventListener('change', () => { model.set(input.id, Number(input.value)); model.save_changes(); });
          }
          model.on('change:frequency', fromModel);
          model.on('change:amplitude', fromModel);
          // The tracer is view state: it animates without running Python on every frame.
          let running = false, progress = 0, last = 0, frame = 0;
          play.addEventListener('click', () => { running = !running; play.textContent = running ? 'Pause tracer' : 'Play tracer'; });
          const tick = (time) => {
            if (running && last) progress = (progress + (time - last) / 5000) % 1;
            last = time;
            const [x, y] = point(progress);
            marker.setAttribute('cx', x); marker.setAttribute('cy', y);
            frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
          fromModel();
          return () => cancelAnimationFrame(frame);
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
            frequency = traitlets.Float(2.0).tag(sync=True)
            amplitude = traitlets.Float(0.7).tag(sync=True)

        return WaveScope

    @cell("B1", label="wave", view={"display": "rendered", "span": [3, 7]})
    @computed
    def wave(self):
        # the widget shows and edits the input cells frequency and amplitude
        return bind(self.WaveScope()(), frequency=self.frequency(), amplitude=self.amplitude())

    @cell("F1", label="wave_lesson")
    @markdown
    def wave_lesson(self):
        return """# Wave laboratory

        Frequency counts the cycles in the window; amplitude is the height. Change the sliders and
        watch the curve. **Play tracer** follows the curve in the browser, without running Python
        on every frame.

        {{ self.wave() }}

        | Quantity | Value |
        | --- | --- |
        | Frequency $f$ | **{{ self.frequency() }}** cycles |
        | Period $T = 1/f$ | {{ self.period() }} |
        | Peak to peak $2A$ | {{ self.peak_to_peak() }} |
        | RMS value $A/\\sqrt 2$ | {{ self.rms() }} |

        ## Try it

        1. Double the frequency. How many crests fit in the same width, and what happens to $T$?
        2. Halve the amplitude. Does the number of crests change?
        3. Start the tracer, then move a slider. The tracer keeps running.

        The widget is an ordinary [anywidget](https://anywidget.dev) class (cell A1): the same class
        works in Jupyter, VS Code, and marimo. Its sliders are bound to the input cells
        `frequency` and `amplitude` (`bind(WaveScope(), frequency=frequency, …)`): moving a slider
        writes the cell, the cells B8–B10 read it, and the value is saved with the workbook. Whether the
        tracer is playing is the widget's own state and stays inside it."""

    # cycles in the window (the widget's slider writes it)
    frequency = cell("A2", field(2.0), label="frequency")

    # height of the wave (the widget's slider writes it)
    amplitude = cell("A3", field(0.7), label="amplitude")

    @cell("B8", label="period")
    @computed
    def period(self):
        return round(1 / self.frequency(), 3)

    @cell("B9", label="peak_to_peak")
    @computed
    def peak_to_peak(self):
        return round(2 * self.amplitude(), 2)

    @cell("B10", label="rms")
    @computed
    def rms(self):
        return round(self.amplitude() / math.sqrt(2), 3)


@workbook_config({"formatVersion": 2, "name": "Wave laboratory"})
class WaveLaboratoryWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 8, "rows": 16},
        layout={"columnWidths": {"A": 220, "B": 220, "C": 220, "D": 220, "F": 300}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
