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


class ModelWorksheet(Worksheet["HowAlgorithmsScaleWorkbook"]):
    # input size
    n = cell(
        "A1",
        field(1000),
        label="n",
        view={"widget": {"type": "range", "min": 10, "max": 100000, "step": 10}},
    )

    @cell("B1", label="operations")
    @computed
    def operations(self):
        return {
            "log n": math.log2(self.n()),
            "n": self.n(),
            "n log n": self.n() * math.log2(self.n()),
            "n²": self.n()**2,
            "n³": self.n()**3,
        }

    @cell("C1", label="growth", view={"display": "rendered", "span": [2, 8]})
    @computed
    def growth(self):
        import plotly.graph_objects as go

        sizes = np.logspace(1, 5, 60)
        curves = {"log n": np.log2(sizes), "n": sizes, "n log n": sizes * np.log2(sizes), "n²": sizes**2, "n³": sizes**3}
        figure = go.Figure()
        for (name, values), color in zip(curves.items(), ("#1baf7a", "#2a78d6", "#7157d9", "#eb6834", "#8b8b84")):
            figure.add_scatter(x=sizes, y=values, name=name, line=dict(color=color, width=2.5))
        figure.add_vline(x=self.n(), line_dash="dot", line_color="#8b8b84", annotation_text="n")
        figure.update_layout(**self.chart_layout()("Operations against input size", "input size n", "operations", xaxis_type="log", yaxis_type="log"))
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

    @cell("F1", label="p1_growth")
    @markdown
    def p1_growth(self):
        return """# 1 · Growth, not speed

        How long an algorithm takes depends on how its work **grows** with the input size $n$, not
        on the machine. Big-O notation names that growth.

        [Input size n: {{ self.n() }}](#sheet-input:n?type=range&min=10&max=100000&step=10)

        {{ self.growth() }}

        On a machine doing {{ f'{self.speed():,}' }} simple operations per second, $n =$ {{ self.n() }} takes:

        | Growth | Time |
        | --- | ---: |
        | $O(\\log n)$ | {{ self.times()['log n'] }} |
        | $O(n)$ | {{ self.times()['n'] }} |
        | $O(n \\log n)$ | {{ self.times()['n log n'] }} |
        | $O(n^2)$ | {{ self.times()['n²'] }} |
        | $O(n^3)$ | {{ self.times()['n³'] }} |

        ## Check yourself

        - Multiply $n$ by 10. How does each time change?
        - A faster computer or a better algorithm: which helps more for large $n$?

        ---

        **Next:** [2 · Searching](#note-p2_searching)"""

    # simple operations a machine does per second
    speed = cell("A2", field(100000000), label="speed")

    @cell("B2", label="times")
    @computed
    def times(self):
        def readable(seconds):
            for limit, unit, factor in ((1e-6, "ns", 1e9), (1e-3, "µs", 1e6), (1, "ms", 1e3), (120, "s", 1), (7200, "min", 1 / 60), (172800, "h", 1 / 3600)):
                if seconds < limit:
                    return f"{seconds * factor:.3g} {unit}"
            return f"{seconds / 86400:.3g} days"
        return {name: readable(count / self.speed()) for name, count in self.operations().items()}

    @cell("E2", label="bubble_sort_comparisons")
    @computed
    def bubble_sort_comparisons(self):
        def bubble_sort_comparisons(values):
            values, count = list(values), 0
            for end in range(len(values) - 1, 0, -1):
                for i in range(end):
                    count += 1
                    if values[i] > values[i + 1]:
                        values[i], values[i + 1] = values[i + 1], values[i]
            return count

        return bubble_sort_comparisons

    @cell("F2", label="p2_searching")
    @markdown
    def p2_searching(self):
        return """# 2 · Searching: $O(n)$ against $O(\\log n)$

        Find one number in a **sorted** list of {{ self.n() }} numbers. A linear scan checks them one by
        one; binary search looks at the middle and discards half of the list each time. Both
        searches really run here.

        [Input size n: {{ self.n() }}](#sheet-input:n?type=range&min=10&max=100000&step=10)

        [Position of the item (%): {{ self.position() }}](#sheet-input:position?type=range&min=1&max=100&step=1)

        | Search for item {{ self.target() }} | Steps |
        | --- | ---: |
        | Linear scan | **{{ self.linear_steps() }}** |
        | Binary search | **{{ self.binary_steps() }}** (never more than {{ self.binary_worst() }}) |

        Doubling the list adds *one* step to binary search, and up to $n$ steps to the scan.

        ## Check yourself

        - Where must the item be for the linear scan to win?
        - Why does binary search need a sorted list?

        ---

        **Previous:** [1 · Growth, not speed](#note-p1_growth) · **Next:** [3 · Sorting](#note-p3_sorting)"""

    # where the searched item is, in percent of the list
    position = cell(
        "A3",
        field(70),
        label="position",
        view={"widget": {"type": "range", "min": 1, "max": 100, "step": 1}},
    )

    @cell("B3", label="target")
    @computed
    def target(self):
        return max(1, round(self.n() * self.position() / 100))

    @cell("E3", label="merge_sort_comparisons")
    @computed
    def merge_sort_comparisons(self):
        def merge_sort_comparisons(values):
            if len(values) < 2:
                return list(values), 0
            middle = len(values) // 2
            left, a = merge_sort_comparisons(values[:middle])
            right, b = merge_sort_comparisons(values[middle:])
            merged, count, i, j = [], a + b, 0, 0
            while i < len(left) and j < len(right):
                count += 1
                if left[i] <= right[j]:
                    merged.append(left[i]); i += 1
                else:
                    merged.append(right[j]); j += 1
            return merged + left[i:] + right[j:], count

        return merge_sort_comparisons

    @cell("F3", label="p3_sorting")
    @markdown
    def p3_sorting(self):
        return """# 3 · Sorting: $O(n^2)$ against $O(n \\log n)$

        Sorting makes binary search possible. Bubble sort compares neighbours again and again;
        merge sort splits the list, sorts the halves, and merges them. The comparisons are
        **counted** while both sort the same shuffled list.

        [List length: {{ self.list_size() }}](#sheet-input:list_size?type=range&min=10&max=400&step=10)

        [Shuffle: {{ self.shuffle() }}](#sheet-input:shuffle?type=button)

        {{ self.sorting() }}

        For {{ self.list_size() }} numbers bubble sort needs **{{ self.bubble() }}** comparisons, merge sort
        **{{ self.merge() }}**: {{ self.advantage() }} times fewer.

        ## Check yourself

        - Double the list. By what factor does each count grow? Compare with page 1.
        - Does shuffling change bubble sort's count? Merge sort's? Why?

        ---

        **Previous:** [2 · Searching](#note-p2_searching)"""

    # length of the list to sort
    list_size = cell(
        "A4",
        field(100),
        label="list_size",
        view={"widget": {"type": "range", "min": 10, "max": 400, "step": 10}},
    )

    @cell("B4", label="linear_steps")
    @computed
    def linear_steps(self):
        return self.target()

    # every click shuffles the list
    shuffle = cell("A5", field(0), label="shuffle", view={"widget": {"type": "button"}})

    @cell("B5", label="binary_steps")
    @computed
    def binary_steps(self):
        # binary search for `target` in the sorted list 1 … n
        low, high, count = 1, self.n(), 0
        while low <= high:
            count += 1
            middle = (low + high) // 2
            if middle == self.target():
                break
            if middle < self.target():
                low = middle + 1
            else:
                high = middle - 1
        return count

    @cell("B6", label="binary_worst")
    @computed
    def binary_worst(self):
        return math.floor(math.log2(self.n())) + 1

    @cell("B7", label="numbers")
    @computed
    def numbers(self):
        return list(np.random.default_rng(self.shuffle()).permutation(self.list_size()))

    @cell("B8", label="bubble")
    @computed
    def bubble(self):
        return self.bubble_sort_comparisons()(self.numbers())

    @cell("B9", label="merge")
    @computed
    def merge(self):
        return self.merge_sort_comparisons()(self.numbers())[1]

    @cell("C9", label="sorting", view={"display": "rendered", "span": [2, 8]})
    @computed
    def sorting(self):
        import plotly.graph_objects as go

        sizes = [10, 25, 50, 100, 200, 400]
        rng = np.random.default_rng(self.shuffle())
        lists = [list(rng.permutation(size)) for size in sizes]
        figure = go.Figure(go.Scatter(x=sizes, y=[self.bubble_sort_comparisons()(v) for v in lists], name="bubble sort", mode="lines+markers", line=dict(color="#eb6834", width=3)))
        figure.add_scatter(x=sizes, y=[self.merge_sort_comparisons()(v)[1] for v in lists], name="merge sort", mode="lines+markers", line=dict(color="#7157d9", width=3))
        figure.add_vline(x=self.list_size(), line_dash="dot", line_color="#8b8b84", annotation_text="your list")
        figure.update_layout(**self.chart_layout()("Comparisons counted while sorting", "list length", "comparisons"))
        return figure

    @cell("B10", label="advantage")
    @computed
    def advantage(self):
        return round(self.bubble() / self.merge(), 1)


@workbook_config(
    {
        "formatVersion": 2,
        "name": "How algorithms scale",
        "layout": {"noteOrder": ["F1", "F2", "F3"]},
    }
)
class HowAlgorithmsScaleWorkbook(Workbook):
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
