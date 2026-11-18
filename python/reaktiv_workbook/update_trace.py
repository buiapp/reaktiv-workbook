"""Metadata-only observations of the latest settled workbook update.

No values, extra equality calls, graph reads or sample history are retained.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence


class UpdateTrace:
    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self.runs: dict[str, int] = {}
        self.equalities: dict[str, bool] = {}
        self.outputs: dict[str, str] = {}
        self.roots: set[str] = set()
        self._versions: dict[str, tuple[int, int]] = {}
        self._sequence = 0
        self.latest: dict[str, Any] | None = None

    def executed(self, cell_id: str) -> None:
        if not self.enabled:
            return
        self.runs[cell_id] = self.runs.get(cell_id, 0) + 1

    def set_enabled(self, enabled: bool) -> None:
        if enabled == self.enabled:
            return
        self.enabled = enabled
        self.runs.clear()
        self.equalities.clear()
        self.outputs.clear()
        self.roots.clear()
        self._versions.clear()
        self.latest = None

    def complete(
        self,
        cells: Sequence[dict[str, Any]],
        kinds: Mapping[str, str],
        dependencies: Mapping[str, Sequence[str]],
        versions: Mapping[str, tuple[int, int]],
        changed: Iterable[str],
        custom_equal: set[str],
    ) -> dict[str, Any] | None:
        ids = set(kinds)
        roots = (set(changed) | self.roots) & ids
        published = {key for key, version in versions.items() if self._versions.get(key) != version}
        seeds = (roots | published | set(self.runs) | set(self.equalities)) & ids
        if seeds or set(self._versions) != set(versions):
            affected = set(seeds)
            dependents: dict[str, list[str]] = {}
            for consumer, reads in dependencies.items():
                for producer in reads:
                    dependents.setdefault(producer, []).append(consumer)
            pending = list(seeds)
            while pending:
                for consumer in dependents.get(pending.pop(), []):
                    if consumer not in affected:
                        affected.add(consumer)
                        pending.append(consumer)
            observations: dict[str, dict[str, Any]] = {}
            for cell in cells:
                key = cell['id']
                runs = self.runs.get(key, 0)
                equal = self.equalities.get(key)
                if cell.get('error'):
                    status = 'failed'
                elif kinds[key] == 'effect':
                    status = 'ran' if runs else 'not-run'
                elif cell.get('resourceStatus') in ('idle', 'loading', 'reloading') and cell.get('value') is None:
                    status = 'waiting'
                elif key in published:
                    status = 'changed'
                elif equal is True and (runs or key in roots):
                    status = 'equal'
                elif runs:
                    # Same published version without a comparator decision: do not
                    # invent an equality decision for this primitive.
                    status = 'ran'
                else:
                    status = 'cached' if key in affected else 'unaffected'
                observations[key] = {
                    'status': status, 'executions': runs,
                    'publishedChanged': key in published,
                    'dependencies': list(dependencies.get(key, ())),
                    'changedDependencies': [dep for dep in dependencies.get(key, ()) if dep in published],
                    **({'equal': equal, 'equality': 'custom' if key in custom_equal else 'default'} if equal is not None else {}),
                    **({'output': self.outputs[key]} if key in self.outputs else {}),
                }
            self._sequence += 1
            self.latest = {'sequence': self._sequence, 'roots': sorted(roots), 'cells': observations}
        self._versions = dict(versions)
        self.runs.clear()
        self.equalities.clear()
        self.outputs.clear()
        self.roots.clear()
        return self.latest
