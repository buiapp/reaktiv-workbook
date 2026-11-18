# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
#   "matplotlib",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    artifact,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["RichPlotsAndFilesWorkbook"]):
    monthly_revenue = cell(
        "A1",
        field([82000, 91000, 88000, 104000, 117000, 126000]),
        label="monthly_revenue",
    )

    @cell("B1", label="report")
    @markdown
    def report(self):
        return """# Revenue report

        Return a Matplotlib figure from a formula and it is displayed directly:

        {{ self.revenue_plot() }}

        Change `monthly_revenue` and the plot updates reactively. Use an
        `Artifact` only when an output should be a downloadable file, such as
        {{ self.revenue_csv() }}."""

    @cell("A2", label="revenue_plot")
    @computed
    def revenue_plot(self):
        import matplotlib.pyplot as plt

        figure, axes = plt.subplots(figsize=(7, 3.2))
        axes.plot(self.monthly_revenue(), marker="o", color="#7157d9")
        axes.set(title="Monthly revenue", xlabel="Month", ylabel="Revenue")
        axes.grid(alpha=0.2)
        figure.tight_layout()
        plt.close(figure)
        return figure

    @cell("A3", label="revenue_csv")
    @computed
    def revenue_csv(self):
        rows = ["month,revenue"] + [
            f"{month},{revenue}"
            for month, revenue in enumerate(self.monthly_revenue(), start=1)
        ]
        return artifact("\n".join(rows), "monthly-revenue.csv", "text/csv")


@workbook_config({"formatVersion": 2, "name": "Rich plots and files"})
class RichPlotsAndFilesWorkbook(Workbook):
    Sheet1 = worksheet(
        Sheet1Worksheet,
        layout={"columnWidths": {"A": 260, "B": 360}, "rowHeights": {"2": 220}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
