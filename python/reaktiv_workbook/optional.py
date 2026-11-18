"""Optional libraries, imported on first use.

numpy is not a dependency of the package: a workbook that uses it declares it (its file then
imports it). ``np`` in cells and the plot resampler import it only when they are used, and say
how to install it when it is missing.
"""
from __future__ import annotations

import importlib
from types import ModuleType
from typing import Any


class OptionalModule:
    """Stands in for module ``name`` until an attribute is read; then imports it."""

    def __init__(self, name: str) -> None:
        self._name = name

    def _module(self) -> ModuleType:
        try:
            return importlib.import_module(self._name)
        except ModuleNotFoundError as error:
            if error.name != self._name:
                raise
            raise ModuleNotFoundError(
                f"{self._name} is not installed here: pip install {self._name}, or run the workbook with --sandbox.",
                name=self._name,
            ) from error

    def __getattr__(self, attribute: str) -> Any:
        return getattr(self._module(), attribute)

    def __repr__(self) -> str:
        return f"<optional module {self._name!r}>"


numpy = OptionalModule("numpy")
