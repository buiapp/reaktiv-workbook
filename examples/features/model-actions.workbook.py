# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

import asyncio

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    action,
    artifact,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class Sheet1Worksheet(Worksheet["OrderActionsWorkbook"]):
    quantity = cell("A1", field(1), label="quantity")

    @cell("B1", label="total")
    @computed
    def total(self):
        return self.quantity() * 12.5

    @cell("D1", label="order_note")
    @markdown
    def order_note(self):
        return """# Order commands

        Quantity: **{{ self.quantity() }}** · Total: **{{ self.total() }}**

        [Batch size: {{ self.batch_size() }}](#sheet-input:batch_size?type=number&min=1&max=20&step=1)

        [Add 1](#sheet-input:add_one?type=button) [Add batch](#sheet-input:add_batch?type=button)

        [Reset order](#sheet-action:reset_order)

        [Prepare CSV](#sheet-input:export_button?type=button)

        Buttons run explicitly. Changing batch size never places an order. Open Actions to
        edit arguments, inspect the latest result, or cancel the async export."""

    batch_size = cell(
        "A2",
        field(3),
        label="batch_size",
        view={"widget": {"type": "number", "min": 1, "max": 20, "step": 1}},
    )

    @cell("B2", label="last_added")
    @computed
    def last_added(self):
        return self.workbook.add_items.result()

    add_one = cell(
        "A3",
        field(0),
        label="add_one",
        view={
            "display": "rendered",
            "widget": {
                "type": "button",
                "label": "Add 1",
                "buttonMode": "action",
                "action": "add_items",
                "actionArguments": {"amount": {"value": 1}},
            },
        },
    )

    add_batch = cell(
        "A4",
        field(0),
        label="add_batch",
        view={
            "display": "rendered",
            "widget": {
                "type": "button",
                "label": "Add batch",
                "buttonMode": "action",
                "action": "add_items",
                "actionArguments": {"amount": {"cell": "A2"}},
            },
        },
    )

    export_button = cell(
        "A5",
        field(0),
        label="export_button",
        view={
            "display": "rendered",
            "widget": {
                "type": "button",
                "label": "Prepare CSV",
                "buttonMode": "action",
                "action": "prepare_csv",
                "actionArguments": {"delay": {"default": True}},
            },
        },
    )


@workbook_config(
    {
        "formatVersion": 2,
        "name": "Order actions",
        "actionBindings": {"add_items": {"amount": {"cell": "A2"}}},
    }
)
class OrderActionsWorkbook(Workbook):
    Sheet1 = worksheet(Sheet1Worksheet, grid={"columns": 6, "rows": 12})

    @action(label="Add items")
    def add_items(self, amount: int = 1) -> int:
        """Add a batch to the order. The button captures batch_size when clicked."""
        self.Sheet1.quantity.set(self.Sheet1.quantity() + amount)
        return self.Sheet1.quantity()

    @action(label="Reset order")
    def reset_order(self):
        self.Sheet1.quantity.set(1)

    @action(label="Prepare CSV")
    async def prepare_csv(self, delay: float = 1.0):
        """Simulate an async export. Use Cancel action while waiting."""
        quantity = self.Sheet1.quantity()
        await asyncio.sleep(delay)
        return artifact(f"quantity,total\n{quantity},{quantity * 12.5}\n", filename="order.csv", media_type="text/csv")


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
