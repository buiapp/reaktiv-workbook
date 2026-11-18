"""Explicit model commands with observable invocation state."""

from __future__ import annotations

import asyncio
import functools
import inspect
import weakref
from typing import Any, Callable, Generic, Optional, TypeVar, cast, overload

import sys

if sys.version_info >= (3, 10):
    from typing import Concatenate, ParamSpec
else:
    from typing_extensions import Concatenate, ParamSpec

from reaktiv import ReactiveModel, untracked
from reaktiv.subtle import current_consumer
from reaktiv import Signal, ReadonlySignal
from weakref import WeakKeyDictionary

P = ParamSpec("P")
R = TypeVar("R")


class BoundAction(Generic[P, R]):
    """A callable method. Reads of its state never invoke the method."""

    def __init__(self, fn: Callable[P, R], *, label: str = "") -> None:
        self.fn = fn
        self.label = (
            label or getattr(fn, "__name__", "Action").replace("_", " ").capitalize()
        )
        self._running = Signal(False)
        self._result = Signal[Any](None)
        self._error = Signal[Optional[BaseException]](None)
        self.running = self._running.as_readonly()
        self.result: ReadonlySignal[Any] = self._result.as_readonly()
        self.error = self._error.as_readonly()
        self._task: Optional[asyncio.Task[Any]] = None
        functools.update_wrapper(self, fn)
        self.__signature__ = inspect.signature(fn)

    def _begin(self) -> None:
        if current_consumer() is not None:
            raise RuntimeError(
                "Actions must be explicitly invoked outside reactive computations"
            )
        if self._running():
            raise RuntimeError("This action is already running")
        self._error.set(None)
        self._running.set(True)

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        # Validate before changing invocation state or executing any user code.
        self.__signature__.bind(*args, **kwargs)
        if inspect.iscoroutinefunction(self.fn):

            async def execute() -> Any:
                self._begin()
                self._task = asyncio.current_task()
                try:
                    pending = untracked(lambda: self.fn(*args, **kwargs))
                    value = await cast(Any, pending)
                    self._result.set(value)
                    return value
                except BaseException as error:
                    self._error.set(error)
                    raise
                finally:
                    self._task = None
                    self._running.set(False)

            return cast(R, execute())
        self._begin()
        try:
            value = untracked(lambda: self.fn(*args, **kwargs))
            self._result.set(value)
            return value
        except BaseException as error:
            self._error.set(error)
            raise
        finally:
            self._running.set(False)

    def cancel(self) -> bool:
        """Request cooperative cancellation of an executing async invocation."""
        if self._task is None or self._task.done():
            return False
        self._task.cancel()
        return True

    def dispose(self) -> None:
        self.cancel()


class ActionDescriptor(Generic[P, R]):
    def __init__(
        self, fn: Callable[Concatenate[Any, P], R], *, label: str = ""
    ) -> None:
        self._cache: WeakKeyDictionary[object, BoundAction[P, R]] = WeakKeyDictionary()
        self.fn, self.label = fn, label
        self._instance_key = f"__reaktiv_action_{id(self)}"
        for name in functools.WRAPPER_ASSIGNMENTS:
            if hasattr(fn, name):
                setattr(self, name, getattr(fn, name))
        self.__wrapped__ = fn

    @overload
    def __get__(
        self, instance: None, owner: Optional[type] = None
    ) -> ActionDescriptor[P, R]: ...

    @overload
    def __get__(
        self, instance: object, owner: Optional[type] = None
    ) -> BoundAction[P, R]: ...

    def __get__(
        self, instance: Optional[object], owner: Optional[type] = None
    ) -> ActionDescriptor[P, R] | BoundAction[P, R]:
        return self if instance is None else self._get_or_create(instance)

    def _get_or_create(self, instance: object) -> BoundAction[P, R]:
        # Store on the owner when possible. A cached exception may retain its
        # traceback/owner; a descriptor-rooted weak-key cache would then leak it.
        if hasattr(instance, "__dict__"):
            values = vars(instance)
            value = values.get(self._instance_key)
            if value is None:
                value = self._create(instance)
                values[self._instance_key] = value
                if isinstance(instance, ReactiveModel):
                    instance.own(value)
            return cast(BoundAction[P, R], value)
        try:
            return self._cache[instance]
        except KeyError:
            value = self._create(instance)
            self._cache[instance] = value
            if isinstance(instance, ReactiveModel):
                instance.own(value)
            return value
        except TypeError as error:
            raise TypeError(
                "Action owners need __dict__ or weak-referenceable, hashable instances"
            ) from error

    def _create(self, instance: object) -> BoundAction[P, R]:
        try:
            owner = weakref.ref(instance)
        except TypeError:
            # Owners with __dict__ but no weakref slot retain their own action.
            owner = lambda: instance
        method = self.fn
        if inspect.iscoroutinefunction(method):

            async def invoke_async(*args: Any, **kwargs: Any) -> Any:
                model = owner()
                if model is None:
                    raise ReferenceError("The action owner no longer exists")
                return await cast(Any, method)(model, *args, **kwargs)

            fn = cast(Callable[P, R], invoke_async)
        else:

            def invoke(*args: Any, **kwargs: Any) -> Any:
                model = owner()
                if model is None:
                    raise ReferenceError("The action owner no longer exists")
                return method(model, *args, **kwargs)

            fn = cast(Callable[P, R], invoke)
        functools.update_wrapper(fn, method)
        setattr(
            fn,
            "__signature__",
            inspect.signature(method).replace(
                parameters=list(inspect.signature(method).parameters.values())[1:]
            ),
        )
        return BoundAction(fn, label=self.label)


@overload
def action(
    fn: Callable[Concatenate[Any, P], R], *, label: str = ""
) -> ActionDescriptor[P, R]: ...
@overload
def action(
    fn: None = None, *, label: str = ""
) -> Callable[[Callable[Concatenate[Any, P], R]], ActionDescriptor[P, R]]: ...
def action(fn: Any = None, *, label: str = "") -> Any:
    """Expose an explicit instance method; supports ``@action`` and ``@action(label=...)``.

    Methods remain callable in ordinary Python. They do not subscribe to dependencies
    or rerun on invalidation. Each owner has independent running/result/error signals.
    """

    def decorate(method: Callable[..., Any]) -> ActionDescriptor[Any, Any]:
        parameters = list(inspect.signature(method).parameters)
        if not parameters or parameters[0] != "self":
            raise TypeError(
                "@action requires an instance method whose first parameter is self"
            )
        return ActionDescriptor(method, label=label)

    return decorate(fn) if fn is not None else decorate
