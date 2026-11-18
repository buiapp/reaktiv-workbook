"""Composable spreadsheet metadata for Reaktiv model descriptors."""

from __future__ import annotations

from dataclasses import dataclass
import ast
import inspect
import keyword
import re
from weakref import WeakSet
from types import MappingProxyType
from typing import Any, Callable, Mapping, Optional, TypeVar, cast, overload

from reaktiv import ReactiveModel, Signal, computed, untracked
from reaktiv.effect import EffectDescriptor
from reaktiv.model import SignalField
from reaktiv.resource import ResourceDescriptor
from reaktiv.signal import ComputedDescriptor
from reaktiv.linked import LinkedDescriptor, LinkedSignal

from .artifact import Artifact
from .narrowing import as_mapping
from .rich_output import rich_output_markdown

ModelT = TypeVar("ModelT", bound=type[ReactiveModel])
# `A1` on the first sheet, `Budget!A1` on another.
CELL_POSITION = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_]*!)?[A-Z]+[1-9][0-9]*$")
MARKDOWN_INTERPOLATION = re.compile(r"\{\{(.*?)\}\}", re.DOTALL)


@dataclass(frozen=True)
class CellMetadata:
    position: str
    kind: str
    enabled: bool = True
    trigger: str = "auto"
    color: str = ""
    label: str = ""
    save_value: bool = True


InputT = TypeVar("InputT")


class InputField(SignalField[InputT]):
    """A writable field initialized once per model from a method's Python result."""

    def __init__(self, initializer: Callable[[Any], InputT]) -> None:
        super().__init__(factory=lambda: cast(InputT, None))
        self.initializer = initializer
        self.initialized: WeakSet[object] = WeakSet()
        self.initializing: WeakSet[object] = WeakSet()

    def initialize(self, instance: object, value: InputT) -> Signal[InputT]:
        signal = super().initialize(instance, value)
        self.initialized.add(instance)
        return signal

    def __set__(self, instance: object, value: InputT) -> None:
        self.initialize(instance, value)

    @overload
    def __get__(self, instance: None, owner: Optional[type] = None) -> InputField[InputT]: ...

    @overload
    def __get__(self, instance: object, owner: Optional[type] = None) -> Signal[InputT]: ...

    def __get__(self, instance: Optional[object], owner: Optional[type] = None) -> InputField[InputT] | Signal[InputT]:
        if instance is None:
            return self
        if instance not in self.initialized:
            if instance in self.initializing:
                raise RuntimeError("Circular input initialization")
            self.initializing.add(instance)
            try:
                value = untracked(lambda: self.initializer(instance))
                if inspect.isawaitable(value):
                    if inspect.iscoroutine(value):
                        value.close()
                    raise TypeError("Input initialization must be synchronous; use a resource for async work")
                self.initialize(instance, value)
            finally:
                self.initializing.discard(instance)
        return super().__get__(instance, owner)


def input_cell(initializer: Callable[[Any], InputT]) -> InputField[InputT]:
    """Initialize writable state from Python once; later reads never rerun the method."""
    return InputField(initializer)


def markdown(member: Callable[..., str]) -> ComputedDescriptor[str]:
    """Create a computed Markdown cell with ``{{ expression }}`` interpolation."""

    def render(self: ReactiveModel) -> str:
        template = inspect.cleandoc(member(self))

        def interpolate(match: re.Match[str]) -> str:
            # The file's own namespace: built-ins, its imports and shared code, as in the app.
            value = eval(match.group(1).strip(), member.__globals__, {"self": self})
            if isinstance(value, Artifact):
                return value.to_markdown()
            return rich_output_markdown(value) or str(value)

        return MARKDOWN_INTERPOLATION.sub(interpolate, template)

    descriptor = computed(render)
    assert isinstance(descriptor, ComputedDescriptor)
    setattr(descriptor, "__reaktiv_workbook_kind__", "markdown")
    return descriptor


DescriptorT = TypeVar("DescriptorT")


@overload
def cell(
    position: str,
    target: DescriptorT,
    *,
    enabled: bool = True,
    trigger: str = "auto",
    color: str = "",
    label: str = "",
    view: Optional[Mapping[str, Any]] = None,
    override: Optional[str] = None,
    equal: str = "",
    resource_mode: str = "explicit",
    save_value: bool = True,
) -> DescriptorT: ...


@overload
def cell(
    position: str,
    target: None = None,
    *,
    enabled: bool = True,
    trigger: str = "auto",
    color: str = "",
    label: str = "",
    view: Optional[Mapping[str, Any]] = None,
    override: Optional[str] = None,
    equal: str = "",
    resource_mode: str = "explicit",
    save_value: bool = True,
) -> Callable[[DescriptorT], DescriptorT]: ...


def cell(
    position: str,
    target: Optional[Any] = None,
    *,
    enabled: bool = True,
    trigger: str = "auto",
    color: str = "",
    label: str = "",
    view: Optional[Mapping[str, Any]] = None,
    override: Optional[str] = None,
    equal: str = "",
    resource_mode: str = "explicit",
    save_value: bool = True,
) -> Any:
    """Attach a grid position to a composed Reaktiv descriptor.

    Use ``cell("A1", field(default))`` for inputs. For methods, keep this
    decorator outermost over ``@computed``, ``@linked``, ``@effect``, ``@resource``, or
    :func:`markdown`. It returns what it wraps, so type checkers see each cell's type
    (``self.revenue()`` is an ``int`` for ``field(125000)``). ``view`` (dashboard tiles) is
    presentation for the app; running the file as plain Python ignores it.
    """

    if not CELL_POSITION.fullmatch(position):
        raise ValueError(f"Invalid cell position: {position!r}")
    if resource_mode not in {"simple", "explicit"}:
        raise ValueError("Resource mode must be simple or explicit")
    if trigger not in {"auto", "manual"}:
        raise ValueError(f"Invalid effect trigger: {trigger!r}")
    if color and not re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        raise ValueError(f"Invalid cell color: {color!r}")
    if label and (not label.isidentifier() or keyword.iskeyword(label)):
        raise ValueError(f"Invalid cell label: {label!r}")

    frame = inspect.currentframe()
    namespace = frame.f_back.f_globals if frame is not None and frame.f_back is not None else {}
    del frame

    def decorate(member: Any) -> Any:
        kind = _descriptor_kind(member)
        if not isinstance(save_value, bool):
            raise TypeError("Input save_value must be a boolean")
        if not save_value and kind != "input":
            raise ValueError("save_value=False applies only to input cells")
        if equal:
            if kind == "effect":
                raise ValueError("Effects have no value to compare")
            from reaktiv import untracked
            from .value_encoding import values_equal
            comparison = eval(compile(equal, "<cell equality>", "eval"), {"values_equal": values_equal, **namespace})
            if not callable(comparison):
                raise TypeError("Cell equality must evaluate to a callable")
            def compare(previous: Any, current: Any) -> bool:
                return bool(untracked(lambda: comparison(previous, current)))
            member._equal = compare
        if kind != "effect" and (not enabled or trigger != "auto"):
            raise ValueError("enabled and trigger options apply only to effects")
        if override is not None:
            if not isinstance(override, str):
                raise TypeError("Linked input override must be a string")
            if not isinstance(member, LinkedDescriptor):
                raise ValueError("override applies only to linked inputs")
            member = RestoredLinkedDescriptor(cast(LinkedDescriptor[Any], member), override)
        metadata = CellMetadata(position, kind, enabled, trigger, color.lower(), label, save_value)
        setattr(member, "__reaktiv_workbook_cell__", metadata)
        if isinstance(member, EffectDescriptor):
            member.initialize_eagerly = enabled and trigger == "auto"
        return member

    return decorate if target is None else decorate(target)


def sheet(config: Mapping[str, Any]) -> Callable[[ModelT], ModelT]:
    """Validate cell metadata and attach workbook configuration to a model."""

    def decorate(model_type: ModelT) -> ModelT:
        if not issubclass(model_type, ReactiveModel):
            raise TypeError("@sheet classes must extend reaktiv.ReactiveModel")
        positions: set[str] = set()
        for member in model_type.__dict__.values():
            metadata = getattr(member, "__reaktiv_workbook_cell__", None)
            if not isinstance(metadata, CellMetadata):
                continue
            if metadata.position in positions:
                raise ValueError(f"Duplicate cell position: {metadata.position}")
            positions.add(metadata.position)

        environment = as_mapping(config.get("environment", {})) or {}
        variables = as_mapping(environment.get("variables", {}))
        if variables is None:
            raise TypeError("Sheet environment variables must be a mapping")
        # Actions use the same sheet-qualified namespace as runtime cells/effects.
        # Cache handles per model; building the namespace never evaluates a cell.
        if "cells" not in vars(model_type):
            from functools import cached_property
            from .cell_access import cell_refs

            def references(model: ReactiveModel) -> Any:
                settings = getattr(type(model), "__reaktiv_workbook__", {})
                return cell_refs(model, str(settings.get("sheetName", "Sheet1")))

            namespace = cached_property(references)
            namespace.__set_name__(model_type, "cells")
            setattr(model_type, "cells", namespace)
        setattr(model_type, "__reaktiv_workbook__", dict(config))
        setattr(
            model_type,
            "__reaktiv_workbook_env__",
            MappingProxyType(dict(variables)),
        )
        return model_type

    return decorate


def _descriptor_kind(member: Any) -> str:
    if isinstance(member, SignalField):
        return "input"
    if isinstance(member, EffectDescriptor):
        return "effect"
    if isinstance(member, ResourceDescriptor):
        return "resource"
    if isinstance(member, LinkedDescriptor):
        return "linked"
    if isinstance(member, ComputedDescriptor):
        kind: object = getattr(cast(object, member), "__reaktiv_workbook_kind__", "formula")
        return kind if isinstance(kind, str) else "formula"
    raise TypeError(
        "@cell must wrap field(...) or be outermost over @computed, "
        "@linked, @effect, @resource, or @markdown"
    )


class RestoredLinkedDescriptor(LinkedDescriptor[Any]):
    """Restore a saved manual value once per model instance without changing its formula."""
    def __init__(self, original: LinkedDescriptor[Any], override: str) -> None:
        super().__init__(lambda instance: None)
        self._original = original
        self._saved_override = override

    def __set_name__(self, owner: type[Any], name: str) -> None:
        super().__set_name__(owner, name)
        self._original.__set_name__(owner, name)

    def _create(self, instance: object) -> LinkedSignal[Any]:
        node = self._original.__get__(instance, type(instance))
        try:
            value = ast.literal_eval(self._saved_override)
        except (ValueError, SyntaxError):
            value = self._saved_override if self._saved_override.strip() else None
        node.set(value)
        return node
