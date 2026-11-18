"""Time-driven cells: ``every(...)`` and ``at(...)``.

A formula cell that calls one of them is a **clock cell**: its value is the time of its
last tick, and it ticks again on an interval or a schedule. Everything that references
the clock — resources, formulas, effects, notes — re-runs on each tick, which is how a
pipeline is refreshed regularly::

    clock = every(minutes=5)                      # formula cell "clock"
    prices = await fetch(url)   # reads clock     # resource: reloads every 5 minutes
    at("08:00", "17:30", days="mon-fri")          # a schedule instead of an interval

The engine only records *when* the next tick is due; whoever hosts the workbook fires it
(the app with a timer, the CLI with ``--watch``) by calling ``ReactiveWorkbook.tick_timer``.
Outside a workbook the functions simply return the current time.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING, Any, Iterable, Optional, Union

if TYPE_CHECKING:
    from .workbook import ReactiveWorkbook

MIN_INTERVAL_SECONDS = 1.0
DAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

# The cell being evaluated (set by the engine), so a timer knows which cell it drives.
ACTIVE_CELL: ContextVar[Optional[tuple["ReactiveWorkbook", str]]] = ContextVar(
    "reaktiv_workbook_active_cell", default=None
)


@dataclass(frozen=True)
class TimerSpec:
    """When a clock cell ticks: every ``interval`` seconds, or at ``times`` on ``days``."""

    label: str
    interval: Optional[float] = None
    times: tuple[time, ...] = ()
    days: frozenset[int] = frozenset(range(7))

    def next_after(self, moment: datetime) -> datetime:
        """The first tick strictly after ``moment``."""
        if self.interval is not None:
            return moment + timedelta(seconds=self.interval)
        for offset in range(8):
            day = (moment + timedelta(days=offset)).date()
            if day.weekday() not in self.days:
                continue
            for clock in self.times:
                candidate = datetime.combine(day, clock)
                if candidate > moment:
                    return candidate
        raise ValueError("Schedule has no upcoming time")  # unreachable: days is never empty


def every(
    seconds: float = 0, *, minutes: float = 0, hours: float = 0, enabled: bool = True
) -> datetime:
    """Tick on an interval. Returns the time of the last tick.

    ``every(30)``, ``every(minutes=5)``, ``every(hours=1, minutes=30)``; at least one second.
    ``enabled=False`` pauses the clock: it keeps its last time and stops ticking.
    """
    interval = float(seconds) + 60 * float(minutes) + 3600 * float(hours)
    if interval < MIN_INTERVAL_SECONDS:
        raise ValueError("every() needs an interval of at least 1 second, e.g. every(minutes=5)")
    return _register(TimerSpec(label=f"every {_duration(interval)}", interval=interval), enabled)


def at(
    *times: Union[str, time],
    days: Union[str, Iterable[str]] = "daily",
    enabled: bool = True,
) -> datetime:
    """Tick at times of day (local time). Returns the time of the last tick.

    ``at("08:00")``, ``at("08:00", "17:30", days="mon-fri")``, ``at("09:00", days=["sat", "sun"])``.
    ``days`` is "daily", "weekdays", "weekends", a range ("mon-fri"), a list ("mon,wed,fri"
    or ``["mon", "wed"]``). ``enabled=False`` pauses the clock.
    """
    if not times:
        raise ValueError('at() needs at least one time, e.g. at("08:00")')
    parsed = tuple(sorted(_parse_time(value) for value in times))
    weekdays = _parse_days(days)
    label = "at " + ", ".join(value.strftime("%H:%M") for value in parsed)
    if len(weekdays) < 7:
        label += " on " + ", ".join(DAY_NAMES[index] for index in sorted(weekdays))
    return _register(TimerSpec(label=label, times=parsed, days=weekdays), enabled)


def _register(spec: TimerSpec, enabled: bool = True) -> datetime:
    active = ACTIVE_CELL.get()
    if active is None:
        return datetime.now().replace(microsecond=0)
    workbook, cell_id = active
    return workbook.register_timer(cell_id, spec if enabled else None)


def _parse_time(value: Any) -> time:
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, str):
        parts = value.strip().split(":")
        if len(parts) in (2, 3) and all(part.isdigit() for part in parts):
            numbers = [int(part) for part in parts]
            try:
                return time(numbers[0], numbers[1], numbers[2] if len(numbers) == 3 else 0)
            except ValueError:
                pass
    raise ValueError(f'Invalid time {value!r}; use "HH:MM", e.g. "08:00"')


def _parse_days(days: Union[str, Iterable[str]]) -> frozenset[int]:
    if isinstance(days, str):
        text = days.strip().lower()
        if text in ("daily", "every day", "all", ""):
            return frozenset(range(7))
        if text == "weekdays":
            text = "mon-fri"
        if text == "weekends":
            text = "sat,sun"
        names = [part.strip() for part in text.split(",") if part.strip()]
    else:
        names = [str(part).strip().lower() for part in days]
    result: set[int] = set()
    for name in names:
        if "-" in name:
            start, end = (_day_index(part) for part in name.split("-", 1))
            index = start
            while True:
                result.add(index)
                if index == end:
                    break
                index = (index + 1) % 7
        else:
            result.add(_day_index(name))
    if not result:
        raise ValueError('days must name at least one day, e.g. "mon-fri"')
    return frozenset(result)


def _day_index(name: str) -> int:
    key = name.strip().lower()[:3]
    if key not in DAY_NAMES:
        raise ValueError(f'Unknown day {name!r}; use mon, tue, wed, thu, fri, sat, sun')
    return DAY_NAMES.index(key)


def _duration(seconds: float) -> str:
    if seconds % 3600 == 0:
        return f"{seconds / 3600:g} h"
    if seconds % 60 == 0:
        return f"{seconds / 60:g} min"
    return f"{seconds:g} s"
