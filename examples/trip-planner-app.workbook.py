# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "reaktiv>=0.25.0",
#   "reaktiv-workbook>=0.1.0",
# ]
# ///

"""A Reaktiv Workbook (Python format 2)."""

from datetime import date
import random

from reaktiv import computed, field
from reaktiv_workbook import (
    Workbook,
    Worksheet,
    cell,
    markdown,
    workbook_config,
    worksheet,
)


class AppWorksheet(Worksheet["TripPlannerWorkbook"]):
    # what is already in the bag
    packing = cell(
        "A1",
        field(["Passport", "Charger", "Rain jacket"]),
        label="packing",
        view={"display": "rendered", "span": [1, 5], "widget": {"type": "list"}},
    )

    activities = cell(
        "B1",
        field(["Hiking", "Museums"]),
        label="activities",
        view={
            "display": "rendered",
            "span": [1, 2],
            "widget": {
                "type": "multiselect",
                "options": ["Hiking", "Swimming", "Museums", "Food tour"],
            },
        },
    )

    @cell("C1", label="missing")
    @computed
    def missing(self):
        # gear the chosen activities need that is not packed yet
        packed = {item.lower() for item in self.packing()}
        return [item for activity in self.activities() for item in self.GEAR().get(activity, []) if item.lower() not in packed]

    @cell("D1", label="trip_planner")
    @markdown
    def trip_planner(self):
        return """# 🧳 Trip planner

        A small app made of **input widgets**: every control below writes to an input cell, and
        the cells that read it update at once.

        ## Plan

        [Departure: {{ self.departure() }}](#sheet-input:departure?type=date)

        [Activities: {{ self.activities() }}](#sheet-input:activities?type=multiselect&options=Hiking,Swimming,Museums,Food%20tour)

        [Notes for the booking: {{ self.booking_notes() }}](#sheet-input:booking_notes?type=textarea)

        ## Packing list

        [Packing list: {{ self.packing() }}](#sheet-input:packing?type=list)

        **{{ len(self.packing()) }} items packed**, {{ len(self.missing()) }} missing · departure {{ self.when() }}.

        **Still missing for your activities:** {{ ', '.join(self.missing()) or 'nothing — you are set' }}

        ## Can't decide what to pack first?

        [Pick something for me: {{ self.pick_for_me() }}](#sheet-input:pick_for_me?type=button)

        Start with: **{{ self.pick() }}**

        ## How it is built

        | Widget | Type | Its input cell holds |
        | --- | --- | --- |
        | List (add / remove) | `list` | a list of strings: `["Passport", "Charger"]` |
        | Multiple choice | `multiselect` | the ticked options: `["Hiking"]` |
        | Date | `date` | a string: `"2026-12-20"` |
        | Long text | `textarea` | a string |
        | Button | `button` | how often it was clicked: `3` |

        Insert one with **Insert → Input widget** (pick the type next to it), or show an input
        cell as a widget in the grid: inspector → *Show rendered in the grid* → *Widget*.

        A **button** counts clicks: `pick` reads `pick_for_me`, so it runs again on every click. An
        effect that reads a button's cell is how a click *does* something (send, save, export).

        Widget reference: [anywidget](https://anywidget.dev) is the way to go beyond these built-in
        controls (see the *anywidget demo* example)."""

    # What each activity needs; `missing` compares it with the packing list.
    GEAR = cell(
        "E1",
        field(
            {
        "Hiking": ["Hiking boots", "Rain jacket", "Water bottle"],
        "Swimming": ["Swimsuit", "Towel"],
        "Museums": ["Student ID"],
        "Food tour": ["Antacids"],
    }
        ),
        label="GEAR",
    )

    @cell("C2", label="days_left")
    @computed
    def days_left(self):
        return (date.fromisoformat(self.departure()) - date.today()).days

    departure = cell(
        "B3",
        field("2026-12-20"),
        label="departure",
        view={"display": "rendered", "widget": {"type": "date"}},
    )

    @cell("C3", label="when")
    @computed
    def when(self):
        return "today" if self.days_left() == 0 else f"in {self.days_left()} days" if self.days_left() > 0 else f"{-self.days_left()} days ago"

    booking_notes = cell(
        "B4",
        field("Window seat if possible.\nVegetarian meal."),
        label="booking_notes",
        view={"display": "rendered", "span": [1, 2], "widget": {"type": "textarea"}},
    )

    @cell("C4", label="pick")
    @computed
    def pick(self):
        # the click count seeds the choice, so every click picks again
        todo = self.missing() or self.packing()
        return random.Random(self.pick_for_me()).choice(todo) if self.pick_for_me() and todo else "press the button"

    pick_for_me = cell(
        "B6",
        field(0),
        label="pick_for_me",
        view={"display": "rendered", "widget": {"type": "button"}},
    )


@workbook_config({"formatVersion": 2, "name": "Trip planner"})
class TripPlannerWorkbook(Workbook):
    App = worksheet(
        AppWorksheet,
        grid={"columns": 8, "rows": 16},
        layout={"columnWidths": {"A": 240, "B": 260, "C": 320, "D": 260, "E": 260}},
    )


if __name__ == "__main__":
    from reaktiv_workbook.cli import main

    raise SystemExit(main([__file__]))
