"""Jupyter widget protocol for anywidget.

Reaktiv Workbook is not a Jupyter kernel, so it provides the *comm* that ipywidgets and
anywidget talk through. Every widget opens a :class:`ReaktivComm`; the
:data:`registry` mirrors each widget model's state from the messages it sends:

- ``comm_open`` / ``update`` — the model's state (with binary buffers put in place).
  Updates sent while Python code runs (an effect sets ``counter.value``, a custom-message
  handler changes a trait) are *Python-side changes*: the engine re-runs the cells that
  read the widget and the view receives the new state.
- ``custom`` — ``widget.send(content, buffers)``: delivered to the view as ``msg:custom``.

Messages from the view go back through the same comm (``update`` for
``model.save_changes()``, ``custom`` for ``model.send()``), so traitlets observers,
``on_msg`` handlers and anywidget's ``@experimental.command`` all work as in Jupyter.
This covers ``anywidget.AnyWidget`` subclasses and anywidget's experimental widgets
(any class with a ``MimeBundleDescriptor``).

Binary values travel inside JSON as ``{"$binary": "<base64>"}``; the view turns them
into ``DataView`` objects as anywidget does.

Widgets are leaves of the reactive graph: their
data lives in input cells — ``bind(widget, x=vector_x)`` shows an input cell in the widget
and the view writes changes back to that cell — and everything else is the widget's own
state. Other cells may not read a widget's synced traits (:class:`WidgetStateError`).
A widget belongs to the cell that created it and is closed when that cell runs again.
"""

from __future__ import annotations

import base64
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional, cast

from .narrowing import as_dict, as_list, as_mapping, as_sequence
from .timers import ACTIVE_CELL

WIDGET_VIEW_MIME = "application/vnd.jupyter.widget-view+json"
MODEL_REFERENCE = "IPY_MODEL_"
# ipywidgets bookkeeping the view does not need.
INTERNAL_KEYS = frozenset(
    {"comm", "keys", "log", "layout", "tabbable", "tooltip", "_dom_classes", "_view_count", "_anywidget_id"}
)


@dataclass
class Model:
    state: dict[str, Any]
    comm: Any
    # (id(workbook), cell id) of the cell whose evaluation created the widget, and when.
    owner: Optional[tuple[int, str]] = None
    created: int = 0


@dataclass
class Registry:
    models: dict[str, Model] = field(default_factory=dict[str, Model])
    # Custom messages from Python to views, and models changed by Python code.
    outbox: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    changed: set[str] = field(default_factory=set[str])
    # The view update being applied (model id, keys): its echo is not a Python-side change.
    applying: Optional[tuple[str, frozenset[str]]] = None
    # Counts opened models, so a cell's earlier widgets can be told from its new ones.
    sequence: int = 0

    def take_outbox(self) -> list[dict[str, Any]]:
        messages, self.outbox = self.outbox, []
        return messages

    def take_changed(self) -> set[str]:
        changed, self.changed = self.changed, set()
        return changed


registry = Registry()


def _put_buffers(state: dict[str, Any], paths: Iterable[Any], buffers: Iterable[Any]) -> dict[str, Any]:
    for path, buffer in zip(paths or (), buffers or ()):
        target: Any = state
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = bytes(buffer)
    return state


try:  # comm is installed with ipywidgets / anywidget
    from comm.base_comm import BaseComm
except ImportError:  # pragma: no cover - no widget packages: nothing to host
    BaseComm = object  # type: ignore[assignment,misc]


class ReaktivComm(BaseComm):  # type: ignore[misc,valid-type]
    """The widget's channel to the view, kept in this process."""

    # ipywidgets only sends when the comm has a kernel.
    kernel = True

    def publish_msg(
        self,
        msg_type: str,
        data: Optional[dict[str, Any]] = None,
        metadata: Optional[dict[str, Any]] = None,
        buffers: Optional[list[Any]] = None,
        **keys: Any,
    ) -> None:
        data = data or {}
        comm_id = str(getattr(self, "comm_id"))  # BaseComm (comm package) is untyped
        if msg_type == "comm_open":
            state = _put_buffers(dict(as_mapping(data.get("state")) or {}), data.get("buffer_paths", []), buffers or [])
            active = ACTIVE_CELL.get(None)
            registry.sequence += 1
            registry.models[comm_id] = Model(
                state, self, owner=None if active is None else (id(active[0]), active[1]), created=registry.sequence
            )
        elif msg_type == "comm_msg":
            model = registry.models.get(comm_id)
            method = data.get("method")
            if model is None:
                return
            if method in ("update", "echo_update"):
                state = _put_buffers(dict(as_mapping(data.get("state")) or {}), data.get("buffer_paths", []), buffers or [])
                model.state.update(state)
                echo = registry.applying is not None and registry.applying[0] == comm_id and set(state) <= registry.applying[1]
                if method == "update" and not echo:
                    registry.changed.add(comm_id)
            elif method == "custom":
                registry.outbox.append(
                    {
                        "modelId": comm_id,
                        "content": data.get("content"),
                        "buffers": [encode_binary(bytes(buffer)) for buffer in buffers or []],
                    }
                )
        elif msg_type == "comm_close":
            registry.models.pop(comm_id, None)


def create_comm(*args: Any, **kwargs: Any) -> Any:
    return ReaktivComm(*args, **kwargs)


def install() -> bool:
    """Make new widgets open a :class:`ReaktivComm` (idempotent)."""
    try:
        import comm
    except ImportError:
        return False
    if comm.create_comm is not create_comm:
        comm.create_comm = create_comm
    return True


def encode_binary(data: bytes) -> dict[str, str]:
    return {"$binary": base64.b64encode(data).decode("ascii")}


def encode_value(value: Any) -> Any:
    """State for JSON: bytes become ``{"$binary": …}``."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return encode_binary(bytes(cast("bytes | bytearray | memoryview[int]", value)))
    mapping = as_mapping(value)
    if mapping is not None:
        return {str(key): encode_value(item) for key, item in mapping.items()}
    items = as_sequence(value)
    if items is not None:
        return [encode_value(item) for item in items]
    return value


def decode_value(value: Any) -> Any:
    mapping = as_dict(value)
    if mapping is not None:
        encoded = mapping.get("$binary")
        if set(mapping) == {"$binary"} and isinstance(encoded, str):
            return base64.b64decode(encoded)
        return {key: decode_value(item) for key, item in mapping.items()}
    items = as_list(value)
    if items is not None:
        return [decode_value(item) for item in items]
    return value


def model_id_of(value: Any) -> Optional[str]:
    """The comm id of a widget value (an anywidget, or any object with a widget mimebundle)."""
    if value is None or isinstance(value, type):
        return None
    comm = getattr(value, "comm", None)
    comm_id = getattr(comm, "comm_id", None)
    if isinstance(comm_id, str) and comm_id in registry.models:
        return comm_id
    represent = getattr(value, "_repr_mimebundle_", None)
    if not callable(represent) or not (hasattr(value, "_esm") or _has_descriptor(value)):
        return None
    try:
        bundle: object = represent()
    except Exception:
        return None
    if isinstance(bundle, tuple):
        bundle = cast(tuple[object, ...], bundle)[0]
    view = as_mapping((as_mapping(bundle) or {}).get(WIDGET_VIEW_MIME)) or {}
    model_id = view.get("model_id")
    return model_id if isinstance(model_id, str) and model_id in registry.models else None


def _has_descriptor(value: Any) -> bool:
    try:
        from anywidget._descriptor import MimeBundleDescriptor
    except ImportError:
        return False
    return isinstance(type(value).__dict__.get("_repr_mimebundle_"), MimeBundleDescriptor)


def is_widget(value: Any) -> bool:
    model_id = model_id_of(value)
    return model_id is not None and "_esm" in registry.models[model_id].state


def _view_state(state: dict[str, Any]) -> dict[str, Any]:
    return {
        key: encode_value(item)
        for key, item in state.items()
        if key not in INTERNAL_KEYS
        and key not in ("_esm", "_css")
        and not key.startswith(("_model_", "_view_"))
    }


def _references(value: Any, found: list[str]) -> list[str]:
    if isinstance(value, str) and value.startswith(MODEL_REFERENCE):
        model_id = value[len(MODEL_REFERENCE):]
        if model_id not in found:
            found.append(model_id)
    elif (mapping := as_mapping(value)) is not None:
        for item in mapping.values():
            _references(item, found)
    elif (items := as_sequence(value)) is not None:
        for item in items:
            _references(item, found)
    return found


def payload(model_id: str) -> dict[str, Any]:
    """``{esm, css, state, modelId, models}`` for the view. ``models`` holds the widgets
    the state refers to (``IPY_MODEL_<id>``), for ``widget_manager.get_model``."""
    state = registry.models[model_id].state
    models: dict[str, Any] = {}
    pending = _references(state, [])
    while pending:
        child = pending.pop(0)
        if child in models or child == model_id or child not in registry.models:
            continue
        child_state = registry.models[child].state
        models[child] = {
            "esm": str(child_state.get("_esm") or ""),
            "css": str(child_state.get("_css") or ""),
            "state": _view_state(child_state),
        }
        pending.extend(_references(child_state, []))
    return {
        "esm": str(state.get("_esm") or ""),
        "css": str(state.get("_css") or ""),
        "state": _view_state(state),
        "modelId": model_id,
        "models": models,
    }


def deliver_update(model_id: str, state: dict[str, Any]) -> bool:
    """A view saved state (``model.save_changes()``)."""
    model = registry.models.get(model_id)
    if model is None:
        return False
    registry.applying = (model_id, frozenset(state))
    try:
        model.comm.handle_msg(
            {"content": {"data": {"method": "update", "state": decode_value(state), "buffer_paths": []}}, "buffers": []}
        )
    finally:
        registry.applying = None
    model.state.update(decode_value(state))
    return True


def deliver_custom(model_id: str, content: Any, buffers: Iterable[Any] = ()) -> bool:
    """A view sent a custom message (``model.send(content, callbacks, buffers)``)."""
    model = registry.models.get(model_id)
    if model is None:
        return False
    raw = [memoryview(decode_value(buffer) if isinstance(buffer, dict) else base64.b64decode(buffer)) for buffer in buffers]
    model.comm.handle_msg({"content": {"data": {"method": "custom", "content": content}}, "buffers": raw})
    return True


# --- Widgets are leaves: lifecycle, bindings, and no reading of widget state ----------


def owner_key(workbook: Any, cell_id: str) -> tuple[int, str]:
    return (id(workbook), cell_id)


def release(owner: tuple[int, str], before: int) -> None:
    """Close the widgets a cell created before ``before`` (its previous evaluations)."""
    for model_id, model in list(registry.models.items()):
        if model.owner == owner and model.created <= before:
            widget = _widget_instance(model_id)
            try:
                if widget is not None:
                    widget.close()
                else:
                    model.comm.close()
            except Exception:  # pragma: no cover - closing must never break a recompute
                registry.models.pop(model_id, None)
            registry.models.pop(model_id, None)


def _widget_instance(model_id: str) -> Any:
    try:
        from ipywidgets.widgets import widget as widget_module
    except ImportError:  # pragma: no cover - older ipywidgets
        return None
    # ipywidgets keeps its live widgets by comm id in a module-private registry.
    instances = as_mapping(getattr(widget_module, "_instances", None)) or {}
    return instances.get(model_id)


@dataclass(frozen=True)
class Binding:
    """An input cell passed to :func:`bind`: its id and current value."""

    cell_id: str
    value: Any


class WidgetStateError(RuntimeError):
    """A cell read a widget's synced trait: widget state is not part of the graph."""


def bind(widget: Any, **inputs: Any) -> Any:
    """Show input cells in a widget's traits; changes in the view are written back to the
    input cells, so the data stays in the graph (and in the file):

        bind(VectorPad(), x=vector_x, y=vector_y)

    Each keyword names a synced trait and must be an input cell (not a value or an
    expression). Returns the widget."""
    traits = as_mapping(widget.traits() if callable(getattr(widget, "traits", None)) else {}) or {}
    bindings: dict[str, str] = {}
    active = ACTIVE_CELL.get(None)
    for name, item in inputs.items():
        if not isinstance(item, Binding) and active is None:
            # Outside the engine (a sheet file used as a plain ReactiveModel): show the value.
            item = Binding("", item)
        if not isinstance(item, Binding):
            raise TypeError(
                f"bind({name}=…) needs an input cell, e.g. bind(widget, {name}=my_input): "
                "a value or an expression cannot receive the widget's changes"
            )
        trait = traits.get(name)
        if trait is None or not trait.metadata.get("sync"):
            raise ValueError(f"{type(widget).__name__} has no synced trait {name!r} to bind")
        setattr(widget, name, item.value)
        bindings[name] = item.cell_id
    if active is not None:
        active[0].register_bindings(widget, bindings)
    return widget


def _frame_cell(filename: str) -> Optional[str]:
    """The cell id of compiled cell code (``<cell A1>``, ``<cell F1 {{ x }}>``)."""
    match = re.match(r"<cell ([^ >]+)", filename)
    return match.group(1) if match else None


def guard_trait_reads() -> None:
    """Make reading another cell's widget state an error (idempotent). Only the reading
    cell's *own* code is checked, so the widget's code (observers, commands, rendering)
    and ipywidgets internals read freely."""
    try:
        import traitlets
    except ImportError:
        return
    descriptor: Callable[..., Any] = getattr(traitlets.TraitType, "__get__")  # traitlets is untyped
    if getattr(descriptor, "_reaktiv_guarded", False):
        return

    def __get__(self: Any, obj: Any, cls: Any = None) -> Any:
        if obj is not None and self.metadata.get("sync"):
            active = ACTIVE_CELL.get(None)
            if active is not None:
                # The reading frame: only the evaluating cell's own code is checked.
                _check_read(obj, self.name, active, sys._getframe(1))  # pyright: ignore[reportPrivateUsage]
        return descriptor(self, obj, cls)

    __get__._reaktiv_guarded = True  # type: ignore[attr-defined]
    traitlets.TraitType.__get__ = __get__  # type: ignore[method-assign]


def _check_read(widget: Any, trait: str, active: tuple[Any, str], frame: Any) -> None:
    reader = _frame_cell(frame.f_code.co_filename)
    if reader is None or reader != active[1]:
        return  # not the evaluating cell's own code (the widget's code, a library)
    comm_id = getattr(getattr(widget, "comm", None), "comm_id", None)
    model = registry.models.get(comm_id) if isinstance(comm_id, str) else None
    if model is None or model.owner is None or model.owner == owner_key(active[0], reader):
        return
    raise WidgetStateError(
        f"Cell {reader} reads {type(widget).__name__}.{trait}, but a widget's state is not part "
        f"of the graph. Keep the value in an input cell and bind it: bind(widget, {trait}=my_input), "
        f"then read my_input."
    )


install()
guard_trait_reads()
