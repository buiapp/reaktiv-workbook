# Custom widgets

Build your own interactive control with the standard
[anywidget](https://anywidget.dev) protocol. There is nothing Reaktiv-specific to
register: a formula returns the widget, and `bind` connects it to input cells. The
widget can live in any Python package.

## A complete widget

```python
import anywidget
import traitlets


class Counter(anywidget.AnyWidget):
    value = traitlets.Int(0).tag(sync=True)

    _esm = """
    function render({ model, el }) {
      const button = document.createElement("button");
      button.type = "button";
      const draw = () => { button.textContent = `Count: ${model.get("value")}`; };
      const increment = () => {
        model.set("value", model.get("value") + 1);
        model.save_changes();
      };
      button.addEventListener("click", increment);
      model.on("change:value", draw);
      el.append(button);
      draw();
      return () => {                      // clean up when the view goes away
        model.off("change:value", draw);
        button.removeEventListener("click", increment);
      };
    }
    export default { render };
    """
```

## Use it in a workbook

1. Install `anywidget` and your package in the workbook's Python (add both to the
   workbook's packages).
2. Create an input cell `count` with the value `0`.
3. Create a formula `counter`:

   ```python
   from third_party_widgets import Counter
   bind(Counter(), value=count)
   ```

4. Show it in a note with `{{ counter }}`, or tick **Show rendered in the grid**.

Clicking the widget updates `count`, and every cell that reads `count` reruns. Editing
`count` updates the widget.

## Rules

- **Data lives in input cells.** Each `bind` keyword is a synchronized trait, and its
  argument must be an input cell (or linked input). Other cells read `count`, never
  `counter.value`; reading a widget's state from another cell is an error.
- Bound values must be Python literals: numbers, strings, booleans, `None`, and lists
  or dicts of those.
- For display-only data, pass a formula's value to the constructor without binding it.
- To change a bound value from Python, write the input cell, not the widget trait.
- Hover, animation and other transient state can stay inside the widget.

## Packaging

- Ship **one self-contained ES module** with all JavaScript dependencies bundled. Relative
  imports and CDN imports don't work (the module loads from a `blob:` URL, often offline).
- The widget runs in a sandboxed iframe. Work inside `el`; don't reach for the parent
  page, storage or file pickers. Do file access in Python cells or actions instead.
- Include the JavaScript and CSS files in both the wheel and the source distribution.

To wrap a chart library (ECharts, for example): sync a specification trait, render it
under `el`, bind selection traits to input cells, resize with the container, and dispose
the chart in the cleanup function.

## Lifecycle

- Rerunning the producing cell replaces the Python widget; the view may be reused for the
  new model. Don't assume one `render` call per Python object.
- Return a cleanup function that removes listeners, observers, timers and chart
  instances.
- Give the content a real height; the frame sizes itself to it.
- Throttle pointer events and batch related changes into one `save_changes()`.

Supported: `model.get`, `set`, `on`, `off`, `save_changes`, `send`, `msg:custom`, nested
models (`widget_manager.get_model`), `experimental.invoke` and binary values. Plain
ipywidgets controls aren't rendered on their own. Exports show a placeholder instead of
the live widget.

## Test checklist

- Install the built wheel in the kernel's environment; check it works without the source
  tree.
- Show the widget in a note and in a grid tile.
- Check both directions: widget → input → formulas, and input → widget. Save, reopen and
  undo.
- Rerun the cell and restart Python: no duplicate listeners or leftover resources.
- Try light and dark themes, keyboard use, and Chromium, Firefox and Safari.
- If the web app is a target, test the package in Pyodide too.

See the *anywidget demo* example for more.
