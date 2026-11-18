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


class Sheet1Worksheet(Worksheet["BinarySearchExplainerWorkbook"]):
    # the sorted list to search (add or remove numbers)
    numbers = cell(
        "A1",
        field([2, 5, 8, 12, 16, 23, 38, 56, 72]),
        label="numbers",
        view={"display": "rendered", "span": [1, 4], "widget": {"type": "list"}},
    )

    @cell("B1", label="steps")
    @computed
    def steps(self):
        # every comparison of a binary search for `target`
        values = sorted(int(value) for value in self.numbers())
        low, high, steps = 0, len(values) - 1, []
        while low <= high:
            mid = (low + high) // 2
            value = values[mid]
            if value == self.target():
                explanation = f"Inspect {value}: found it."
            elif value < self.target():
                explanation = f"Inspect {value}: smaller than {self.target()}, so discard the left half."
            else:
                explanation = f"Inspect {value}: larger than {self.target()}, so discard the right half."
            steps.append({"low": low, "high": high, "mid": mid, "explanation": explanation})
            if value == self.target():
                break
            if value < self.target():
                low = mid + 1
            else:
                high = mid - 1
        return steps

    @cell("C1", label="search", view={"display": "rendered", "span": [3, 6]})
    @computed
    def search(self):
        # the widget shows the search; which step it shows is the input cell search_step
        return bind(self.SearchStepper()(numbers=sorted(int(value) for value in self.numbers()), steps=self.steps()), step=self.search_step())

    @cell("F1", label="search_lesson")
    @markdown
    def search_lesson(self):
        return """# Binary search: halve the possibilities

        A **sorted** list lets us discard half of the candidates after every comparison. The
        outlined number is the one being inspected; faded numbers are already excluded.

        {{ self.search() }}

        You are looking at step **{{ min(self.search_step(), len(self.steps()) - 1) + 1 }}** of {{ len(self.steps()) }} — the stepper writes the input cell `search_step`, so the step is saved with the workbook.

        Searching for **{{ self.target() }}**: {{ self.outcome() }}. A list of {{ len(self.numbers()) }} numbers never
        needs more than **{{ self.worst_case() }}** comparisons ($\\lfloor \\log_2 n \\rfloor + 1$); a linear
        scan may need all {{ len(self.numbers()) }}.

        ## Predict before clicking

        Is the target larger or smaller than the outlined number? Which half can you safely discard?
        Then change the list or the target in the cells and step through again."""

    # the number we look for
    target = cell("A5", field(23), label="target")

    # which comparison the stepper shows (0 = the first; the widget writes it)
    search_step = cell("A6", field(0), label="search_step")

    @cell("A7", label="SearchStepper")
    @computed
    def SearchStepper(self):
        import anywidget
        import traitlets


        class SearchStepper(anywidget.AnyWidget):
            """Steps through a binary search, one comparison at a time."""

            _esm = """
        function render({ model, el }) {
          el.innerHTML = `
            <div class="panel">
              <div id="row" style="display:flex;gap:6px;flex-wrap:wrap"></div>
              <p id="status" aria-live="polite"></p>
              <div class="controls">
                <button id="back">Previous</button><button id="next">Next step</button><button id="reset">Reset</button>
              </div>
            </div>`;
          const row = el.querySelector('#row'), status = el.querySelector('#status');
          const back = el.querySelector('#back'), next = el.querySelector('#next'), reset = el.querySelector('#reset');
          const go = (step) => { model.set('step', step); model.save_changes(); };
          const draw = () => {
            const steps = model.get('steps'), numbers = model.get('numbers');
            const step = Math.max(0, Math.min(steps.length - 1, model.get('step')));
            const current = steps[step];
            row.replaceChildren(...numbers.map((value, index) => {
              const box = document.createElement('div');
              box.textContent = value;
              const inside = current && index >= current.low && index <= current.high;
              box.style.cssText = `padding:10px 12px;border-radius:8px;border:1px solid ${index === current?.mid ? '#7157d9' : 'light-dark(#cfd6c8,#3a3f36)'};`
                + `opacity:${inside ? 1 : 0.3};font-weight:${index === current?.mid ? 700 : 400}`;
              return box;
            }));
            status.textContent = current ? `Step ${step + 1} of ${steps.length}: ${current.explanation}` : 'The list is empty.';
            back.disabled = reset.disabled = step === 0;
            next.disabled = step >= steps.length - 1;
          };
          back.addEventListener('click', () => go(model.get('step') - 1));
          next.addEventListener('click', () => go(model.get('step') + 1));
          reset.addEventListener('click', () => go(0));
          model.on('change', draw);
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
            numbers = traitlets.List([]).tag(sync=True)
            steps = traitlets.List([]).tag(sync=True)
            step = traitlets.Int(0).tag(sync=True)

        return SearchStepper

    @cell("C7", label="outcome")
    @computed
    def outcome(self):
        found = bool(self.steps()) and self.steps()[-1]["explanation"].endswith("found it.")
        return f"found in {len(self.steps())} comparisons" if found else f"not in the list ({len(self.steps())} comparisons)"

    @cell("C8", label="worst_case")
    @computed
    def worst_case(self):
        return math.floor(math.log2(len(self.numbers()))) + 1 if self.numbers() else 0


@workbook_config({"formatVersion": 2, "name": "Binary search explainer"})
class BinarySearchExplainerWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        grid={"columns": 8, "rows": 16},
        layout={"columnWidths": {"A": 220, "B": 230, "C": 220, "D": 220, "F": 300}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
