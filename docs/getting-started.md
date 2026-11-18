# Getting started

This tutorial builds a small savings calculator: three inputs, two formulas, a note
with a slider, and a check from the command line.

## 1. Create a workbook

```bash
uvx reaktiv-workbook new savings.workbook.py
```

(`uvx` runs it without installing; with `uv tool install reaktiv-workbook` or
`pip install reaktiv-workbook`, the command is `reaktiv-workbook new savings.workbook.py`.)

The editor opens in your browser. The command keeps running until you press Ctrl+C;
closing the browser tab does not stop it.

## 2. Add inputs

Switch to **Cells**. Type values into the grid and give each one a **label** in the
cell panel (press **I** to open it):

| Cell | Value | Label |
| --- | --- | --- |
| A1 | `200` | `deposit` |
| A2 | `4.0` | `rate_percent` |
| A3 | `10` | `years` |

Inputs are Python literals: numbers, lists, `True`, or strings in quotes (`"EU"`).

## 3. Add formulas

Start a cell with `=` to make it a formula. Refer to other cells by label:

| Cell | Formula | Label |
| --- | --- | --- |
| B1 | `= rate_percent / 100 / 12` | `monthly_rate` |
| B2 | see below | `balance` |

A formula can have several lines; the last expression is its value:

```python
months = years * 12
deposit * ((1 + monthly_rate) ** months - 1) / monthly_rate
```

Change `deposit` and watch `balance` update. Switch to **Graph** to see how the cells
connect.

## 4. Write a note

Select `deposit` and, in the cell panel, choose the **Slider** widget with min `50`,
max `1000` and step `50`. Then switch to **Notes** and write:

```markdown
# Savings plan

[Monthly deposit: {{ deposit }}](#sheet-input:deposit)

After **{{ years }} years** you have **{{ f"{balance:,.0f}" }} €**.
```

`{{ … }}` shows a live value. The link shows `deposit` with its slider. Type `{{` in
the editor to pick a cell, or use **Insert widget**.

## 5. Save and check

Press Ctrl/Cmd+S. Your workbook is now `savings.workbook.py`, a Python file you can
read, diff and commit.

Check it from the terminal. A workbook is not done until this passes:

```bash
reaktiv-workbook check savings.workbook.py
reaktiv-workbook evaluate savings.workbook.py --cell balance
reaktiv-workbook evaluate savings.workbook.py --set deposit=900 --cell balance
```

## Next

- Add a chart: return a Plotly or Matplotlib figure from a formula
  ([Charts and outputs](outputs.md)).
- Add more controls: dropdowns, checkboxes, dates, buttons ([Controls](widgets.md)).
- Explore the bundled examples: **Examples…** in the app, or
  `reaktiv-workbook new --from budget`.
