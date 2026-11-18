"""Explicit cell handles: reads track dependencies; updates read their target untracked."""

from __future__ import annotations

import ast
import copy
from contextlib import nullcontext
from typing import Any, Callable, Generic, TypeVar, cast
from reaktiv import ComputeSignal, ReactiveModel, untracked
from reaktiv.subtle import current_consumer
from .narrowing import as_mapping
from .source_analysis import remember_literal

T = TypeVar("T")


class CellRef(Generic[T]):
    def __init__(
        self,
        read: Callable[[], T],
        write: Callable[[T], None] | None = None,
        reset: Callable[[], None] | None = None,
    ) -> None:
        self._read, self._write, self._reset = read, write, reset

    def get(self) -> T:
        return self._read()

    def __call__(self) -> T:
        return self.get()

    def set(self, value: T) -> None:
        if isinstance(current_consumer(), ComputeSignal):
            raise RuntimeError(
                "Only effect cells can write inputs; formulas are read-only"
            )
        if self._write is None:
            raise TypeError("Only input and linked cells are writable")
        self._write(value)

    def update(self, update: Callable[[T], T]) -> None:
        if isinstance(current_consumer(), ComputeSignal):
            raise RuntimeError(
                "Only effect cells can write inputs; formulas are read-only"
            )
        if self._write is None:
            raise TypeError("Only input and linked cells are writable")
        value = copy.deepcopy(untracked(self._read))
        self.set(update(value))

    def reset(self) -> None:
        if isinstance(current_consumer(), ComputeSignal):
            raise RuntimeError(
                "Only effect cells can write inputs; formulas are read-only"
            )
        if self._reset is None:
            raise TypeError("Only linked inputs can be reset")
        self._reset()


class CellNamespace:
    """Sheet-local handles; sheet names select an explicit namespace."""

    def __init__(
        self,
        resolve: Callable[[str, str | None], CellRef[Any]],
        sheets: Callable[[], tuple[str, ...]],
        sheet: str | None = None,
    ) -> None:
        self._resolve, self._sheets, self._sheet = resolve, sheets, sheet

    def __getattr__(self, name: str) -> Any:
        if self._sheet is None and name in self._sheets():
            return CellNamespace(self._resolve, self._sheets, name)
        return self._resolve(name, self._sheet)

    def batch(self) -> Any:
        # Runtime effects stage every write until successful completion already.
        return nullcontext()


def literal_source(value: Any) -> str:
    """Accept values the input parser can restore exactly, without executing code."""
    # NumPy arithmetic commonly produces scalar wrappers; persist their Python value.
    if type(value).__module__.startswith("numpy"):
        import numpy as np

        if isinstance(value, np.generic):
            value = cast(Any, value).item()
    if type(value) not in (
        type(None),
        bool,
        int,
        float,
        complex,
        str,
        bytes,
        list,
        tuple,
        dict,
        set,
    ):
        raise TypeError(
            "Input writes require Python literal values (numbers, strings or containers)"
        )
    source = repr(value)
    try:
        ast.literal_eval(source)
    except (SyntaxError, ValueError) as error:
        raise TypeError(
            "Input writes require a finite, serializable Python literal"
        ) from error
    remember_literal(source, value)
    return source


def cell_refs(model: ReactiveModel, sheet: str) -> CellNamespace:
    """Handles for executing generated ReactiveModel files outside the app."""
    from reaktiv import batch, LinkedSignal
    from reaktiv.linked import LinkedDescriptor
    from .schema import CellMetadata

    mapping: dict[str, tuple[str, str, ReactiveModel]] = {}
    sheets: set[str] = {sheet}
    config = as_mapping(getattr(type(model), "__reaktiv_workbook__", {})) or {}
    first = str(config.get("sheetName", "Sheet1"))
    from .composition import Workbook, Worksheet
    root = cast(Worksheet[Any], model).workbook if isinstance(model, Worksheet) else model
    owners: list[tuple[str, ReactiveModel]] = [(first, model)]
    if isinstance(root, Workbook):
        owners = [(name, root.worksheet_instance(name)) for name in root.worksheet_names()]
    for owner_sheet, owner in owners:
        for member, descriptor in vars(type(owner)).items():
            metadata = getattr(descriptor, "__reaktiv_workbook_cell__", None)
            if not isinstance(metadata, CellMetadata):
                continue
            prefix, separator, coordinate = metadata.position.rpartition("!")
            prefix = prefix if separator else owner_sheet
            coordinate = coordinate if separator else metadata.position
            sheets.add(prefix)
            for name in [coordinate, *([metadata.label] if metadata.label else [])]:
                mapping[f"{prefix}.{name}"] = (member, metadata.kind, owner)

    def resolve(name: str, namespace: str | None) -> CellRef[Any]:
        member, kind, owner = mapping[f"{namespace or sheet}.{name}"]
        signal = getattr(owner, member)
        read = signal.value if kind == "resource" else signal
        write = signal.set if kind in ("input", "linked") else None
        reset: Callable[[], None] | None = None
        if kind == "linked":
            descriptor = vars(type(owner))[member]
            # Saved overrides wrap the original descriptor; reset its derivation.
            descriptor = getattr(descriptor, "_original", descriptor)
            if isinstance(descriptor, LinkedDescriptor) and isinstance(
                signal, LinkedSignal
            ):
                # LinkedSignal has no public reset; recompute the descriptor's derivation.
                derive = cast(
                    Callable[[Any], Any],
                    getattr(cast(LinkedDescriptor[Any], descriptor), "_func"),
                )
                linked_signal = cast(LinkedSignal[Any], signal)
                reset = lambda: linked_signal.set(untracked(lambda: derive(owner)))
        return CellRef(read, write, reset)

    class NativeNamespace(CellNamespace):
        def batch(self) -> Any:
            return batch()

    return NativeNamespace(resolve, lambda: tuple(sheets))
