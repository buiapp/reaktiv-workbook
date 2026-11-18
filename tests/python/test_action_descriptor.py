import asyncio
import gc
import inspect
import weakref

import pytest
from reaktiv import ReactiveModel, computed, field
from reaktiv_workbook import action


class Counter(ReactiveModel):
    count = field(0)

    @action(label="Add quantity")
    def add(self, quantity: int = 1) -> int:
        self.count.update(lambda value: value + quantity)
        return self.count()

    @action
    def fail(self):
        raise ValueError("failed")

    @action
    async def wait(self):
        await asyncio.Event().wait()


def test_explicit_per_instance_calls_and_reactive_state():
    first, second = Counter(), Counter()
    result = computed(lambda: first.add.result())
    assert result() is None
    assert first.add.label == "Add quantity"
    assert str(inspect.signature(first.add)) == "(quantity: int = 1) -> int"
    assert first.add(3) == 3
    assert result() == 3
    first.count.set(20)
    assert result() == 3
    assert second.count() == 0
    assert second.add.result() is None
    with pytest.raises(TypeError):
        first.add(unknown=1)
    assert first.add.error() is None
    with pytest.raises(ValueError, match="failed"):
        first.fail()
    assert isinstance(first.fail.error(), ValueError)
    assert not first.fail.running()


def test_reactive_computations_cannot_invoke_commands():
    counter = Counter()
    derived = computed(lambda: counter.add())
    with pytest.raises(RuntimeError, match="explicitly"):
        derived()
    assert counter.count() == 0


@pytest.mark.asyncio
async def test_async_running_cancellation_and_reentrancy():
    model = Counter()
    pending = asyncio.create_task(model.wait())
    await asyncio.sleep(0)
    assert model.wait.running()
    with pytest.raises(RuntimeError, match="already running"):
        await model.wait()
    assert model.wait.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert not model.wait.running()
    assert isinstance(model.wait.error(), asyncio.CancelledError)
    assert not model.wait.cancel()


def test_action_descriptor_does_not_keep_owner_alive():
    model = Counter()
    method = model.add
    owner = weakref.ref(model)
    del model
    gc.collect()
    assert owner() is None
    with pytest.raises(ReferenceError):
        method()


def test_failed_action_owner_is_collectable():
    model = Counter()
    with pytest.raises(ValueError):
        model.fail()
    owner = weakref.ref(model)
    del model
    gc.collect()
    assert owner() is None


def test_failed_call_retains_last_successful_result_and_clears_error_on_retry():
    class Model(ReactiveModel):
        @action
        def run(self, fail=False):
            if fail:
                raise ValueError("failed")
            return 7

    model = Model()
    assert model.run() == 7
    with pytest.raises(ValueError):
        model.run(True)
    assert model.run.result() == 7
    assert isinstance(model.run.error(), ValueError)
    assert model.run() == 7
    assert model.run.error() is None


@pytest.mark.asyncio
async def test_model_disposal_cancels_owned_action_through_public_lifetime_api():
    model = Counter()
    pending = asyncio.create_task(model.wait())
    await asyncio.sleep(0)
    assert model.wait.running()
    model.dispose()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert not model.wait.running()


def test_descriptor_supports_slotted_and_unhashable_owners():
    class Slotted:
        __slots__ = ("__weakref__",)

        @action
        def run(self, value=3):
            return value

    class Unhashable:
        __hash__ = None

        @action
        def run(self):
            return 4

    first, second = Slotted(), Slotted()
    assert first.run is first.run
    assert first.run() == 3
    assert second.run.result() is None
    assert Unhashable().run() == 4
