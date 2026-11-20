from dataclasses import replace
from pathlib import Path
import json
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, parse_qs
from urllib.error import HTTPError
from concurrent.futures import ThreadPoolExecutor
import pytest
from reaktiv_workbook import CellDefinition, SheetDocument, SheetSession


@pytest.fixture
def workbook_path(tmp_path):
    path = tmp_path / "pricing.workbook.py"
    SheetDocument(
        name="Pricing",
        cells=(
            CellDefinition("A1", "input", "# Price\n20", name="price"),
            CellDefinition("A2", "input", "3", name="quantity"),
            CellDefinition("B1", "formula", "price * quantity", name="total"),
            CellDefinition("B2", "linked", "total * 2", name="linked_total"),
        ),
    ).save(path)
    return path


def connection(session):
    parts = urlsplit(session.open_editor("http://127.0.0.1:4201/", open_browser=False))
    return parse_qs(parts.query)["session"][0], parse_qs(parts.fragment)["token"][0]


def post(endpoint, token, path, payload):
    request = Request(
        endpoint + path,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        },
    )
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def test_direct_action_edit_uses_the_session_owner_and_conflict_boundary(workbook_path):
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        initial = post(endpoint, token, '/v1/session', {})
        definition = {'name':'set_price', 'source':'def set_price(self):\n    self.price.set(66)', 'references':{'price':'A1'}}
        payload = {'definition':definition, 'expectedRevision':initial['graph']['workbookRevision'], 'sessionRevision':initial['revision']}
        applied = post(endpoint, token, '/v1/update-action', payload)
        assert applied['appliedAction']['name'] == 'set_price'
        assert applied['sessionRevision'] != initial['revision']
        assert session.values.price() == 20
        with pytest.raises(HTTPError) as error:
            post(endpoint, token, '/v1/update-action', payload)
        assert 'Session conflict' in error.value.read().decode()
        session.run_action('set_price')
        assert session.values.total() == 198
        session.save()
        assert SheetDocument.load(workbook_path).actions[0].name == 'set_price'


def test_script_inputs_batch_update_reset_and_save(workbook_path):
    with SheetSession.load(workbook_path) as session:
        total = session.values.total
        assert total() == 60
        with session.batch():
            session.inputs.price.set(25)
            session.inputs.quantity.update(lambda n: n + 1)
        assert total() == 100
        session.inputs.linked_total.set(7)
        assert session.values.linked_total() == 7
        session.inputs.linked_total.reset()
        assert session.values.linked_total() == 200
        session.save()
        assert (
            next(
                c.source
                for c in SheetDocument.load(workbook_path).cells
                if c.name == "price"
            )
            == "# Price\n25"
        )
        assert Path(str(workbook_path) + ".snapshot.json").exists()
    with pytest.raises(RuntimeError, match="closed"):
        total()


def test_batch_failure_leaves_inputs_unchanged(workbook_path):
    with SheetSession.load(workbook_path) as session:
        with pytest.raises(TypeError):
            with session.batch():
                session.inputs.price.set(99)
                session.inputs.total.set(1)
        assert session.values.price() == 20
        with pytest.raises(TypeError):
            session.inputs.total.set(1)
        assert session.values.total() == 60


def test_http_editor_and_script_share_graph_and_reject_stale_edits(workbook_path):
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        initial = post(endpoint, token, "/v1/session", {})
        session.inputs.quantity.set(5)
        current = post(endpoint, token, "/v1/session", {"after": initial["revision"]})
        assert (
            next(c["value"] for c in current["graph"]["cells"] if c["id"] == "B1")
            == 100
        )
        with pytest.raises(HTTPError) as error:
            post(
                endpoint,
                token,
                "/v1/apply",
                {
                    "cells": initial["document"]["cells"],
                    "sessionRevision": initial["revision"],
                },
            )
        assert "Session conflict" in error.value.read().decode()
        document = current["document"]
        next(c for c in document["cells"] if c["id"] == "B1")["source"] = (
            "price * quantity + 1"
        )
        updated = post(
            endpoint,
            token,
            "/v1/apply",
            {
                "document": document,
                "sessionRevision": current["revision"],
            },
        )
        assert session.values.total() == 101
        assert updated["sessionRevision"] > current["revision"]
        assert (
            post(endpoint, token, "/v1/session", {"after": updated["sessionRevision"]})
            is None
        )
        state = post(endpoint, token, "/v1/session", {})
        post(
            endpoint,
            token,
            "/v1/session-save",
            {
                "document": state["document"],
                "sessionRevision": state["revision"],
            },
        )
        assert (
            next(
                c.source
                for c in SheetDocument.load(workbook_path).cells
                if c.name == "total"
            )
            == "price * quantity + 1"
        )
        with pytest.raises(HTTPError):
            post(endpoint, "wrong", "/v1/session", {})


def test_concurrent_script_updates_are_atomic(workbook_path):
    with SheetSession.load(workbook_path) as session:
        quantity = session.inputs.quantity
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: quantity.update(lambda n: n + 1), range(20)))
        assert quantity() == 23


def test_resources_use_the_session_event_loop(workbook_path):
    document = SheetDocument.load(workbook_path)
    document = replace(
        document,
        cells=(
            *document.cells,
            CellDefinition(
                "C1",
                "resource",
                "await asyncio.sleep(0.01)\nreturn total * 2",
                name="loaded",
            ),
        ),
    )
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        assert session.values.loaded() == 120
        session.inputs.quantity.set(5)
        assert session.values.loaded() == 200


def test_clocks_run_without_a_browser(workbook_path):

    document = SheetDocument.load(workbook_path)
    document = replace(
        document,
        code="from threading import Event\nclock_ran = Event()\nticks = []",
        cells=(
            *document.cells,
            CellDefinition(
                "C1",
                "effect",
                "every(1)\nticks.append(1)\nif len(ticks) > 1:\n    clock_ran.set()",
            ),
            CellDefinition("C2", "formula", "clock_ran", name="clock_ran_event"),
        ),
    )
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        assert session.values.clock_ran_event().wait(3)
        assert session.values.quantity() == 3
        assert session.revision > 1


def test_synchronous_cell_output_does_not_capture_host_output(workbook_path, capsys):
    from threading import Thread

    document = SheetDocument.load(workbook_path)
    document = replace(
        document,
        code="from threading import Event\nentered = Event()\nrelease = Event()",
        cells=(
            *document.cells,
            CellDefinition(
                "C1",
                "effect",
                'quantity\nif quantity > 3:\n    entered.set()\n    release.wait(2)\nprint("cell output")',
            ),
            CellDefinition("C2", "formula", "entered", name="entered_event"),
            CellDefinition("C3", "formula", "release", name="release_event"),
        ),
    )
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        entered = session.values.entered_event()
        release = session.values.release_event()
        worker = Thread(target=lambda: session.inputs.quantity.set(5))
        worker.start()
        assert entered.wait(2)
        print("host output")
        release.set()
        worker.join(2)
        assert not worker.is_alive()
    assert "host output" in capsys.readouterr().out


def test_function_cells_and_update_callbacks_run_on_owner_loop(workbook_path):
    document = SheetDocument.load(workbook_path)
    document = replace(
        document,
        cells=(
            *document.cells,
            CellDefinition(
                "C1",
                "formula",
                "def calculate(extra):\n    return total + extra",
                name="calculate",
            ),
        ),
    )
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        assert session.values.calculate.call(5) == 65
        session.inputs.quantity.update(lambda n: n + session.values.price())
        assert session.values.calculate.call(5) == 465


def test_resource_completion_after_rerunning_an_effect_publishes_live_state(workbook_path):
    import time
    document = SheetDocument.load(workbook_path)
    document = replace(document, cells=(*document.cells,
        CellDefinition('C1','resource','await asyncio.sleep(0.05)\nreturn total * 2',name='loaded'),
        # Runs once on load (quantity 3 → 5); Run effect adds 2 more.
        CellDefinition('D1','effect','cells.quantity.update(lambda n: n + 2)'),
    ))
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        initial = post(endpoint,token,'/v1/session',{})
        post(endpoint,token,'/v1/console',{'source':'total','sheet':''})
        pending = post(endpoint,token,'/v1/run-effect',{'cellId':'D1','sessionRevision':initial['revision']})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            state = post(endpoint,token,'/v1/session',{})
            loaded = next(c for c in state['graph']['cells'] if c['id']=='C1')
            if loaded['value'] == 280:
                assert state['revision'] > pending['sessionRevision']
                break
            time.sleep(0.02)
        else:
            pytest.fail('resource completion did not reach the live session')


def test_editor_can_release_a_stopped_cell_without_changing_its_source(workbook_path):
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        initial = post(endpoint, token, "/v1/session", {})
        held = post(endpoint, token, "/v1/apply", {
            "document": initial["document"], "sessionRevision": initial["revision"],
            "stopped": ["B1"],
        })
        assert held["stopped"] == ["B1"]
        released = post(endpoint, token, "/v1/apply", {
            "document": initial["document"], "sessionRevision": held["sessionRevision"],
            "stopped": [],
        })
        assert not released.get("stopped")
        assert session.values.total() == 60


def test_live_move_command_updates_script_document_and_session_revision(workbook_path):
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        initial = post(endpoint,token,'/v1/session',{})
        result = post(endpoint,token,'/v1/move-workbook',{
            'expectedRevision':initial['graph']['workbookRevision'],
            'sessionRevision':initial['revision'], 'sourceId':'A1','targetId':'C1'})
        assert result['sessionRevision'] > initial['revision']
        assert session.values.price() == 20
        assert session.values.total() == 60
        current = post(endpoint,token,'/v1/session',{})
        assert any(cell['id']=='C1' and cell['name']=='price' for cell in current['document']['cells'])
        assert not any(cell['id']=='A1' for cell in current['document']['cells'])


def test_editor_can_save_without_building_or_writing_output_snapshot(workbook_path, monkeypatch):
    from reaktiv_workbook import session as session_module
    sidecar = Path(str(workbook_path) + ".snapshot.json")
    with SheetSession.load(workbook_path) as session:
        session.save()
        assert sidecar.exists()
        endpoint, token = connection(session)
        state = post(endpoint, token, "/v1/session", {})

        def forbidden(*args, **kwargs):
            raise AssertionError("Output snapshot generation must be skipped")

        monkeypatch.setattr(session_module, "make_snapshot", forbidden)
        post(endpoint, token, "/v1/session-save", {
            "document": state["document"], "sessionRevision": state["revision"], "saveOutputs": False,
        })
        assert not sidecar.exists()
        assert SheetDocument.load(workbook_path).cells


def test_script_save_honors_and_preserves_workbook_snapshot_preference(workbook_path, monkeypatch):
    from dataclasses import replace
    from reaktiv_workbook import session as session_module
    replace(SheetDocument.load(workbook_path), save_outputs=False).save(workbook_path)

    def forbidden(*args, **kwargs):
        raise AssertionError("Disabled output snapshot must not be built")

    monkeypatch.setattr(session_module, "make_snapshot", forbidden)
    with SheetSession.load(workbook_path) as session:
        session.save()
    assert not SheetDocument.load(workbook_path).save_outputs
    assert not Path(str(workbook_path) + ".snapshot.json").exists()


def test_resource_cancel_bypasses_the_session_gate(workbook_path):
    import time
    document = SheetDocument.load(workbook_path)
    document = replace(document, cells=(*document.cells,
        CellDefinition('C1', 'resource', 'if quantity > 3:\n    await asyncio.sleep(100)\nreturn total * 2', name='loaded')))
    document.save(workbook_path)
    with SheetSession.load(workbook_path) as session:
        endpoint, token = connection(session)
        with ThreadPoolExecutor() as pool:
            pending = pool.submit(session.inputs.quantity.set, 5)
            try:
                for _ in range(200):
                    if session._runtime.workbook.resource_loading('C1'):
                        break
                    time.sleep(.005)
                assert session._runtime.workbook.resource_loading('C1')
                assert post(endpoint, token, '/v1/cancel-resource', {'cellId':'C1'}) == {'cancelled': True}
                pending.result(timeout=2)
            finally:
                session.loop.call_soon_threadsafe(session._runtime.workbook.cancel_resource, 'C1')
        snapshot = post(endpoint, token, '/v1/session', {})['graph']
        assert next(row for row in snapshot['cells'] if row['id']=='C1')['resourceStatus'] == 'cancelled'
        assert session.values.loaded() == 120


def test_live_widget_input_bypasses_session_gate_and_preserves_script_owner(workbook_path):
    import time
    from reaktiv_workbook import ActionDefinition
    document = SheetDocument.load(workbook_path)
    replace(document, actions=(ActionDefinition('measure', 'async def measure(self):\n    import asyncio\n    await asyncio.sleep(10)'),)).save(workbook_path)
    with SheetSession.load(workbook_path) as session, ThreadPoolExecutor() as pool:
        endpoint, token = connection(session)
        initial = post(endpoint, token, '/v1/session', {})
        pending = pool.submit(post, endpoint, token, '/v1/run-action', {'name':'measure', 'runId':'session-live', 'sessionRevision':initial['revision']})
        try:
            for _ in range(100):
                response = post(endpoint, token, '/v1/action-inputs', {'runId':'session-live', 'sources':{'A1':'7'}})
                if response['accepted']:
                    break
                time.sleep(.01)
            else:
                pytest.fail('The embedded action did not admit the widget update')
            for _ in range(100):
                progress = post(endpoint, token, '/v1/progress', {'after':0})
                snapshot = progress.get('snapshot')
                if snapshot and next(cell for cell in snapshot['cells'] if cell['id']=='B1')['value'] == 21:
                    break
                time.sleep(.02)
            else:
                pytest.fail('The embedded action did not publish the widget calculation')
            assert not pending.done()
        finally:
            post(endpoint, token, '/v1/cancel-action', {'name':'measure'})
            pending.result(timeout=5)
        assert session.values.price.get() == 7
        assert session.values.total.get() == 21
