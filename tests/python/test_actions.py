import asyncio
from dataclasses import replace
import pytest
from reaktiv_workbook import (
    ActionDefinition,
    CellDefinition,
    ReactiveWorkbook,
    SheetDocument,
)
from reaktiv_workbook.model import verify_written_document


def document():
    return SheetDocument(
        cells=(
            CellDefinition("A1", "input", "1", name="count"),
            CellDefinition("B1", "formula", "actions.add.result()", name="last_result"),
            CellDefinition("C1", "formula", "count * 2"),
        ),
        actions=(
            ActionDefinition(
                "add",
                """def add(self, quantity: int = 2):
    # Preserve source and the string self.count.
    self.count.set(self.count() + quantity)
    return self.count()""",
                references={"count": "A1"},
            ),
        ),
    )


def val(snapshot, cell):
    return next(item["value"] for item in snapshot.cells if item["id"] == cell)


@pytest.mark.asyncio
async def test_direct_action_update_preserves_inputs_and_unrelated_cached_calculations():
    calls = []
    w = ReactiveWorkbook({"calls": calls})
    try:
        doc = replace(document(), cells=(*document().cells,
            CellDefinition("D1", "input", "calls.append('init') or object()"),
            CellDefinition("E1", "formula", "calls.append('formula') or 12")))
        await w.load_document_async(doc)
        original_input = w._last_values['D1']
        definition = replace(doc.actions[0], source='def add(self, quantity: int = 2):\n    self.count.set(40 + quantity)')
        result = await w.update_action_async(definition.to_dict(), w.revision)
        assert result['appliedAction'] == definition.to_dict()
        assert next(cell['value'] for cell in result['cells'] if cell['id'] == 'A1') == 1
        assert calls == ['init', 'formula']
        assert w._last_values['D1'] is original_input
        assert w.document.actions == (definition,)
        assert val(await w.run_action_async('add'), 'A1') == 42
    finally:
        w.close()


@pytest.mark.asyncio
async def test_direct_action_update_rejects_invalid_or_stale_edits_without_replacing_the_live_action():
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(document())
        await w.run_action_async('add')
        method = w._actions['add']
        revision = w.revision
        invalid = replace(document().actions[0], source='def add(self):\n    await missing()')
        with pytest.raises(SyntaxError, match="Action add, line 2") as refusal:
            await w.update_action_async(invalid.to_dict(), revision)
        assert "await missing()" in str(refusal.value)
        assert "Apply or Save again" in str(refusal.value)
        assert w.revision == revision
        assert w._actions['add'] is method
        assert w.document.actions == document().actions
        with pytest.raises(ValueError, match='Workbook changed'):
            await w.update_action_async(document().actions[0].to_dict(), 'retired')
        # Binding-only changes keep the result and state of the same method.
        bound = replace(document().actions[0], bindings={'quantity': {'value': 5}})
        await w.update_action_async(bound.to_dict(), w.revision)
        assert w._actions['add'] is method
        assert method.result() == 3
        assert val(await w.run_action_async('add'), 'A1') == 8
    finally:
        w.close()


@pytest.mark.asyncio
async def test_explicit_action_writes_result_and_native_parity():
    doc = document()
    source = doc.dumps()
    assert not verify_written_document(source, doc.to_dict())
    loaded = SheetDocument.loads(source)
    assert loaded.actions == __import__("reaktiv_workbook.workbook_format", fromlist=["canonical_actions"]).canonical_actions(doc).actions
    namespace = {}
    exec(source, namespace)
    model = next(
        value
        for value in namespace.values()
        if isinstance(value, type)
        and bool(getattr(value, "__reaktiv_workbook__", None))
        and value.__name__ != "ReactiveModel"
    )()
    assert model.add(4) == 5
    assert model.Sheet1.count() == 5
    model.dispose()
    w = ReactiveWorkbook()
    initial = await w.load_document_async(loaded)
    assert val(initial, "A1") == 1
    assert val(initial, "B1") is None
    result = await w.run_action_async("add", {"quantity": {"value": 4}})
    assert val(result, "A1") == 5
    assert val(result, "B1") == 5
    assert val(result, "C1") == 10
    assert result.actions[0]["status"] == "succeeded"
    assert result.cell_changes
    saved = SheetDocument.loads(w.document.dumps())
    assert saved.cells[0].source == "5"
    assert saved.actions == loaded.actions
    w.close()


@pytest.mark.asyncio
async def test_cell_binding_and_helper_preserved():
    doc = document()
    helper = ActionDefinition(
        "_twice", "def _twice(self, x):\n    return x * 2", exposed=False
    )
    method = replace(
        doc.actions[0],
        source="def add(self, quantity: int = 2):\n    self.count.set(self._twice(quantity))\n    return self.count()",
        bindings={"quantity": {"cell": "A1"}},
    )
    doc = replace(doc, actions=(method, helper))
    loaded = SheetDocument.loads(doc.dumps())
    assert len(loaded.actions) == 2
    w = ReactiveWorkbook()
    await w.load_document_async(loaded)
    result = await w.run_action_async("add")
    assert val(result, "A1") == 2
    assert len(result.actions) == 1
    with pytest.raises(ValueError, match="Unknown action"):
        await w.run_action_async("_twice", {"x": {"value": 3}})
    w.close()


@pytest.mark.asyncio
async def test_failure_and_cancellation_keep_already_published_input_writes():
    for source in [
        'def add(self):\n    self.count.set(9)\n    raise ValueError("oops")',
        "async def add(self):\n    self.count.set(9)\n    await asyncio.sleep(100)",
    ]:
        doc = replace(
            document(),
            actions=(ActionDefinition("add", source, references={"count": "A1"}),),
        )
        w = ReactiveWorkbook()
        await w.load_document_async(doc)
        pending = asyncio.create_task(w.run_action_async("add"))
        await asyncio.sleep(0)
        if source.startswith("async"):
            assert w.action_running("add")
            assert w.cancel_action("add")
        result = await asyncio.wait_for(pending, 2)
        assert val(result, "A1") == 9
        assert next(cell.source for cell in result.cell_changes if cell.id == 'A1') == '9'
        assert next(cell.source for cell in w.document.cells if cell.id == 'A1') == '9'
        assert result.actions[0]["error"]
        assert result.actions[0]["status"] in ("failed", "cancelled")
        w.close()


def test_ast_parser_does_not_execute_default_and_preserves_comment():
    with pytest.raises(ValueError):
        ActionDefinition("bad", 'def bad(self, x=open("secret")):\n    return x')
    doc = document()
    source = doc.dumps().replace(
        "        return self.Sheet1.count()",
        "        return self.Sheet1.count()\n        # trailing comment",
    )
    assert "# trailing comment" in SheetDocument.loads(source).actions[0].source
    renamed = replace(
        doc,
        cells=tuple(
            replace(cell, name="quantity") if cell.id == "A1" else cell
            for cell in doc.cells
        ),
    )
    saved = renamed.dumps()
    assert "self.Sheet1.quantity.set" in saved
    assert "string self.count." in saved


def test_embedded_session_invokes_on_owner_and_publishes(tmp_path):
    from reaktiv_workbook import SheetSession

    path = tmp_path / "commands.sheet.py"
    document().save(path)
    with SheetSession(path) as session:
        assert session.run_action("add", quantity=3) == 4
        assert session.values.count.get() == 4
        assert session.values.last_result.get() == 4
        assert session.revision > 0


@pytest.mark.asyncio
async def test_browser_json_contract():
    import json
    from reaktiv_workbook import browser

    doc = document()
    result = json.loads(
        await browser.apply_model_async(
            json.dumps([cell.to_dict() for cell in doc.cells]),
            "{}",
            "[]",
            '["Sheet1"]',
            "",
            "[]",
            True,
            json.dumps([method.to_dict() for method in doc.actions]),
        )
    )
    assert result["actions"][0]["status"] == "idle"
    result = json.loads(
        await browser.run_action("add", json.dumps({"quantity": {"cell": "A1"}}))
    )
    assert next(cell["value"] for cell in result["cells"] if cell["id"] == "A1") == 2
    assert json.loads(browser.cancel_action("add")) == {"cancelled": False}


@pytest.mark.asyncio
async def test_literal_defaults_are_safe_in_json_snapshots():
    import json

    doc = replace(
        document(),
        actions=(
            ActionDefinition(
                "add", 'def add(self, payload=b"test"):\n    return payload'
            ),
        ),
    )
    w = ReactiveWorkbook()
    snapshot = await w.load_document_async(doc)
    json.dumps(snapshot.to_dict(), allow_nan=False)
    snapshot = await w.run_action_async("add")
    assert snapshot.actions[0]["status"] == "succeeded"
    w.close()


@pytest.mark.asyncio
async def test_action_reads_resource_with_native_value_api():
    doc = SheetDocument(
        cells=(CellDefinition("A1", "resource", "return 42", name="loaded"),),
        actions=(
            ActionDefinition(
                "read_loaded",
                "def read_loaded(self):\n    return self.loaded.value()",
                references={"loaded": "A1"},
            ),
        ),
    )
    w = ReactiveWorkbook()
    await w.load_document_async(doc)
    result = await w.run_action_async("read_loaded")
    assert result.actions[0]["output"]["value"] == 42
    w.close()


@pytest.mark.asyncio
async def test_result_observers_and_nested_helpers_see_published_inputs():
    w = ReactiveWorkbook()
    doc = document()
    doc = replace(
        doc,
        cells=(
            *doc.cells,
            CellDefinition(
                "D1", "effect", "if actions.add.result() is not None:\n    print(count)"
            ),
        ),
    )
    await w.load_document_async(doc)
    result = await w.run_action_async("add")
    logs = [
        item["message"]
        for item in result.logs
        if item.get("cellId") == "D1" and item["level"] == "info"
    ]
    assert logs and all(message.strip() == "3" for message in logs)
    helper = ActionDefinition(
        "_helper",
        "def _helper(self):\n    self.count.set(99)",
        references={"count": "A1"},
        exposed=False,
    )
    method = replace(
        doc.actions[0],
        source='def add(self):\n    self._helper()\n    raise ValueError("no commit")',
        bindings={},
    )
    await w.load_document_async(replace(document(), actions=(method, helper)))
    result = await w.run_action_async("add")
    assert val(result, "A1") == 99
    w.close()


@pytest.mark.asyncio
async def test_resource_parameters_can_depend_on_explicit_action_results():
    doc = document()
    doc = replace(
        doc,
        cells=(
            *doc.cells,
            CellDefinition(
                "D1",
                "resource",
                "return params * 2",
                params="actions.add.result() or 1",
            ),
        ),
    )
    loaded = SheetDocument.loads(doc.dumps())
    assert loaded.cells[-1].params == "actions.add.result() or 1"
    w = ReactiveWorkbook()
    initial = await w.load_document_async(loaded)
    assert val(initial, "D1") == 2
    result = await w.run_action_async("add")
    assert val(result, "D1") == 6
    w.close()


@pytest.mark.asyncio
async def test_reapplying_action_replaces_implementation_without_invoking_it():
    w = ReactiveWorkbook()
    cells = [CellDefinition('A1','input','0',name='count')]
    old = ActionDefinition('change','def change(self):\n    self.count.set(1)',references={'count':'A1'})
    new = ActionDefinition('change','def change(self):\n    self.count.set(42)',references={'count':'A1'})
    await w.apply_async(cells,actions=[old.to_dict()])
    await w.run_action_async('change')
    assert w.value('A1') == 1
    graph = await w.apply_async(w.document.cells,actions=[new.to_dict()])
    assert graph.actions[0]['compileError'] is None
    assert w.value('A1') == 1  # Applying definitions never runs the action.
    await w.run_action_async('change')
    assert w.value('A1') == 42
    broken = ActionDefinition('change','def change(self):\n    continue')
    graph = await w.apply_async(w.document.cells,actions=[broken.to_dict()])
    assert graph.actions[0]['compileError']
    w.close()


@pytest.mark.asyncio
async def test_action_prints_are_published_before_completion_and_cancel_flushes_partial_line():
    doc = replace(document(), actions=(ActionDefinition(
        'live', "async def live(self):\n    print('started')\n    print('partial', end='')\n    await asyncio.sleep(30)",
        'Live', {}, {}, True,
    ),), imports=('import asyncio',))
    w = ReactiveWorkbook()
    published = []
    w.log_reporter = published.append
    pending = None
    try:
        await w.load_document_async(doc)
        published.clear()
        pending = asyncio.create_task(w.run_action_async('live'))
        for _ in range(100):
            if any(entry['message'] == 'started' for entry in published):
                break
            await asyncio.sleep(0.01)
        assert not pending.done()
        assert [entry['message'] for entry in published] == ['started']
        assert w.cancel_action('live')
        snapshot = await asyncio.wait_for(pending, 2)
        action_logs = [entry for entry in snapshot.logs if entry['cellId'] == 'action:live']
        assert [entry['message'] for entry in action_logs] == ['started', 'partial']
        assert [entry['id'] for entry in published] == [entry['id'] for entry in action_logs]
    finally:
        if pending and not pending.done():
            pending.cancel()
            await pending
        w.close()


@pytest.mark.asyncio
async def test_action_failure_keeps_streamed_stdout_stderr_and_partial_output_once():
    doc = replace(document(), actions=(ActionDefinition(
        'live', "def live(self):\n    print('first')\n    print('warning', file=__import__('sys').stderr)\n    print('tail', end='')\n    raise ValueError('failed')",
        'Live', {}, {}, True,
    ),))
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc)
        published = []
        w.log_reporter = published.append
        snapshot = await w.run_action_async('live')
        assert [(entry['level'], entry['message']) for entry in published] == [
            ('info', 'first'), ('warning', 'warning'), ('info', 'tail'), ('error', 'ValueError: failed'),
        ]
        assert len({entry['id'] for entry in published}) == 4
        assert [entry['id'] for entry in snapshot.logs[-4:]] == [entry['id'] for entry in published]
    finally:
        w.close()


@pytest.mark.asyncio
async def test_actions_use_sheet_qualified_labels_in_runtime_and_native_workbooks():
    source = '''def copy_measurement(self):
    self.cells.PreAnalyze.voltage_adc.set(self.cells.PLC.voltage_adc())
    self.cells.PreAnalyze.current_adc.set(self.cells.PLC.current_adc())
    return self.cells.PreAnalyze.voltage_adc() + self.cells.PreAnalyze.current_adc()
'''
    from reaktiv_workbook.model import SheetTab
    book = SheetDocument(name='Qualified actions', sheet_name='SweepLogic', sheets=(SheetTab(name='PLC'), SheetTab(name='PreAnalyze')), cells=(
        CellDefinition('PLC!E5', 'input', '12', name='voltage_adc'),
        CellDefinition('PLC!F5', 'input', '3', name='current_adc'),
        CellDefinition('PreAnalyze!A9', 'input', '0', name='voltage_adc'),
        CellDefinition('PreAnalyze!B9', 'input', '0', name='current_adc'),
    ), actions=(ActionDefinition('copy_measurement', source),))
    workbook = ReactiveWorkbook()
    try:
        workbook.load_document(book)
        snapshot = await workbook.run_action_async('copy_measurement')
        assert next(c for c in snapshot.cells if c['id']=='PreAnalyze!A9')['value'] == 12
        assert next(c for c in snapshot.cells if c['id']=='PreAnalyze!B9')['value'] == 3
        assert snapshot.actions[0]['status'] == 'succeeded'
    finally:
        workbook.close()
    written = book.dumps()
    assert 'self.PreAnalyze.voltage_adc' in written
    restored = SheetDocument.loads(written)
    assert 'self.PreAnalyze.voltage_adc' in restored.actions[0].source
    namespace = {'__name__':'qualified_actions'}
    exec(compile(written, 'qualified.sheet.py', 'exec'), namespace)
    model_type = next(value for value in namespace.values() if isinstance(value,type) and bool(getattr(value,'__reaktiv_workbook__',None)))
    model = model_type()
    assert model.cells is model.cells
    assert model.copy_measurement() == 15
    assert model.cells.PreAnalyze.voltage_adc() == 12
    assert model.cells.PLC.voltage_adc() == 12
    other = model_type()
    assert other.cells.PreAnalyze.voltage_adc() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('asynchronous', [False, True])
async def test_sweep_reads_recomputed_formulas_after_each_write_without_flush(asynchronous):
    header = 'async def sweep(self):' if asynchronous else 'def sweep(self):'
    pause = '        await asyncio.sleep(0.005)\n' if asynchronous else ''
    source = header + '\n    out = []\n    for value in (2, 3, 4):\n        self.cells.Test.freq.set(value)\n' + pause + '        out.append([self.cells.Test.freq(), self.cells.Test.pattern(), self.cells.Test.chained()])\n    return out'
    doc = SheetDocument(sheet_name='Test', cells=(
        CellDefinition('A1', 'input', '1', name='freq'),
        CellDefinition('B1', 'formula', 'freq * 2', name='pattern'),
        CellDefinition('C1', 'formula', 'pattern + 1', name='chained'),
    ), actions=(ActionDefinition('sweep', source),))
    expected = [[2, 4, 5], [3, 6, 7], [4, 8, 9]]
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc)
        result = await w.run_action_async('sweep')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == expected
        assert val(result, 'C1') == 9
        assert next(cell.source for cell in result.cell_changes if cell.id == 'A1') == '4'
        # Generated files use the same write/read semantics with ordinary Python.
        namespace = {}
        exec(doc.dumps(), namespace)
        model = next(
            value for value in namespace.values() if isinstance(value, type) and bool(getattr(value, '__reaktiv_workbook__', None)) and value.__name__ != 'ReactiveModel')()
        try:
            value = model.sweep()
            if asynchronous:
                value = await value
            assert value == expected
        finally:
            model.dispose()
    finally:
        w.close()


@pytest.mark.asyncio
async def test_action_write_settles_effect_writes_before_read_and_does_not_overlay_old_value():
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '0', name='count'),
        CellDefinition('B1', 'effect', 'if count > 5:\n    cells.count.set(5)'),
        CellDefinition('C1', 'formula', 'count * 2', name='doubled'),
    ), actions=(ActionDefinition('change', 'def change(self):\n    self.count.set(10)\n    return [self.count(), self.doubled()]', references={'count':'A1', 'doubled':'C1'}),))
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc)
        result = await w.run_action_async('change')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == [5, 10]
        assert val(result, 'A1') == 5
    finally:
        w.close()


@pytest.mark.asyncio
async def test_resources_reload_and_derived_reads_update_while_sweep_action_is_running():
    ready = asyncio.Event()
    doc = SheetDocument(sheet_name='Test', cells=(
        CellDefinition('A1', 'input', '1', name='freq'),
        CellDefinition('B1', 'resource', 'value = freq\nawait asyncio.sleep(0.005)\nREADY.set()\nreturn value * 3', name='sample'),
        CellDefinition('C1', 'formula', 'sample * 2', name='derived'),
    ), actions=(ActionDefinition('sweep', 'async def sweep(self):\n    out = []\n    for value in (2, 3):\n        self.cells.Test.freq.set(value)\n        await READY.wait()\n        READY.clear()\n        out.append([self.cells.Test.freq(), self.cells.Test.sample(), self.cells.Test.derived()])\n    return out'),))
    w = ReactiveWorkbook({'READY': ready})
    try:
        await w.load_document_async(doc)
        ready.clear()
        result = await asyncio.wait_for(w.run_action_async('sweep'), 3)
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == [[2, 6, 12], [3, 9, 18]]
    finally:
        w.close()


@pytest.mark.asyncio
async def test_nested_action_reads_current_graph_and_linked_reset_is_immediate():
    doc = SheetDocument(cells=(
        CellDefinition('A1', 'input', '1', name='count'),
        CellDefinition('B1', 'linked', 'count * 2', name='linked'),
        CellDefinition('C1', 'formula', 'linked + 1', name='derived'),
    ), actions=(
        ActionDefinition('_step', 'def _step(self):\n    self.cells.Sheet1.count.set(3)\n    return self.cells.Sheet1.derived()', exposed=False),
        ActionDefinition('sweep', 'def sweep(self):\n    first = self._step()\n    self.cells.Sheet1.linked.set(99)\n    second = self.cells.Sheet1.derived()\n    self.cells.Sheet1.linked.reset()\n    return [first, second, self.cells.Sheet1.derived()]'),
    ))
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(doc)
        result = await w.run_action_async('sweep')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == [7, 100, 7]
        assert val(result, 'B1') == 6
        assert next(cell for cell in w.document.cells if cell.id == 'B1').override is None
    finally:
        w.close()


@pytest.mark.asyncio
async def test_action_streams_computed_notes_and_plotly_before_completion_without_consuming_final_writes():
    import base64
    import json
    frames = []
    observed = []
    w = ReactiveWorkbook({'observed': observed})
    try:
        await w.load_document_async(SheetDocument(cells=(
            CellDefinition('A1', 'input', '1', name='count'),
            CellDefinition('B1', 'formula', 'count * 2'),
            CellDefinition('C1', 'formula', "__import__('plotly.graph_objects', fromlist=['Figure']).Figure(data=[{'y': [count]}])"),
            CellDefinition('D1', 'markdown', 'Count: {{ count }}'),
        ), actions=(ActionDefinition('live', "def live(self):\n    self.count.set(2)\n    observed.append('after write')\n    raise ValueError('partial failure')", references={'count': 'A1'}),)))
        revision = w.revision
        def report(frame):
            assert observed == []  # the action has not even reached its next statement
            assert frame['workbookRevision'] == w.revision
            frames.append(frame)
        w.snapshot_reporter = report
        final = await w.run_action_async('live')
        assert len(frames) == 1
        cells = {cell['id']: cell for cell in frames[0]['cells']}
        assert cells['B1']['value'] == 4
        assert cells['D1']['display'] == 'Count: 2'
        spec = json.loads(base64.b64decode(cells['C1']['richOutput']['dataBase64']))
        assert spec['data'][0]['y'] == [2]
        assert next(action for action in frames[0]['actions'] if action['name'] == 'live')['running']
        assert final.actions[0]['error'] == 'ValueError: partial failure'
        assert next(cell for cell in final.cell_changes if cell.id == 'A1').source == '2'
        assert w.revision != revision
    finally:
        w.close()


@pytest.mark.asyncio
async def test_action_stream_coalesces_fast_writes_and_publishes_resources_while_awaiting():
    frames = []
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(SheetDocument(cells=(
            CellDefinition('A1', 'input', '1', name='count'),
            CellDefinition('B1', 'formula', 'count * 2'),
            CellDefinition('C1', 'resource', 'await asyncio.sleep(0.03)\ncount * 10'),
        ), actions=(ActionDefinition('live', 'async def live(self):\n    for count in range(2, 52):\n        self.count.set(count)\n    await asyncio.sleep(0.35)', references={'count': 'A1'}),)))
        w.snapshot_reporter = frames.append
        running = asyncio.create_task(w.run_action_async('live'))
        for _ in range(100):
            if any(next(c for c in frame['cells'] if c['id'] == 'C1')['value'] == 510 for frame in frames):
                break
            await asyncio.sleep(0.005)
        assert not running.done()
        assert len(frames) <= 3  # fifty writes coalesce; no per-write plot serialization
        assert next(c for c in frames[-1]['cells'] if c['id'] == 'B1')['value'] == 102
        assert next(c for c in frames[-1]['cells'] if c['id'] == 'C1')['value'] == 510
        final = await running
        count = len(frames)
        await asyncio.sleep(0.15)
        assert len(frames) == count  # no leaked publisher after command completion
        assert val(final, 'A1') == 51
        assert next(cell for cell in final.cell_changes if cell.id == 'A1').source == '51'
    finally:
        w.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('grouped', [False, True])
async def test_imported_batch_in_actions_defers_effects_but_keeps_computed_reads_fresh(asynchronous, grouped):
    seen = []
    body = '''    for index in range(1, 101):
        CONTEXT
            self.x.set(index)
            assert self.total() == index + (index - 1) * 10
            self.y.set(index * 10)
            assert self.total() == index * 11
        YIELD
    return self.total()'''
    body = body.replace('CONTEXT', 'with batch():' if grouped else 'if True:')
    body = body.replace('YIELD', 'await asyncio.sleep(0.001)' if asynchronous else 'pass')
    doc = SheetDocument(imports=('from reaktiv import batch',), cells=(
        CellDefinition('A1', 'input', '0', name='x'),
        CellDefinition('A2', 'input', '0', name='y'),
        CellDefinition('B1', 'formula', 'x + y', name='total'),
        CellDefinition('B2', 'effect', 'seen.append((x, y, total))'),
    ), actions=(ActionDefinition('go', ('async ' if asynchronous else '') + 'def go(self):\n' + body,
                                references={'x': 'A1', 'y': 'A2', 'total': 'B1'}),))
    w = ReactiveWorkbook({'seen': seen})
    try:
        await w.load_document_async(doc)
        seen.clear()
        # Exercise snapshot preparation inside action writes as well as headless runs.
        frames = []
        w.snapshot_reporter = frames.append
        result = await w.run_action_async('go')
        assert result.actions[0]['error'] is None
        assert result.actions[0]['output']['value'] == 1100
        assert val(result, 'B1') == 1100
        assert len(seen) == (100 if grouped else 200)
        if grouped:
            assert seen == [(n, n * 10, n * 11) for n in range(1, 101)]
        assert frames
        # batch() defers observers; synchronous reads/snapshots can see partial writes.
        first = {cell['id']: cell['value'] for cell in frames[0]['cells']}
        assert first['B1'] == first['A1'] + first['A2']
    finally:
        w.close()


@pytest.mark.asyncio
async def test_action_write_still_bounds_real_effect_feedback():
    w = ReactiveWorkbook()
    try:
        await w.load_document_async(SheetDocument(cells=(
            CellDefinition('A1', 'input', '0', name='count'),
            CellDefinition('B1', 'effect', 'if count:\n    cells.count.set(count + 1)'),
        ), actions=(ActionDefinition('go', 'def go(self):\n    self.count.set(1)', references={'count': 'A1'}),)))
        result = await w.run_action_async('go')
        assert 'feedback loop' in result.effects[0]['error'].lower()
        assert val(result, 'A1') <= 51
    finally:
        w.close()


@pytest.mark.asyncio
async def test_upsert_keeps_only_actual_references_and_infers_new_members():
    w = ReactiveWorkbook()
    try:
        cells = tuple(CellDefinition(f'A{index}', 'input', str(index), name=f'value_{index}') for index in range(1, 140))
        await w.load_document_async(SheetDocument(cells=cells, rows=139))
        action = ActionDefinition('check', 'def check(self):\n    # self.value_3\n    text = "self.value_4"\n    self.value_1.set(self.value_2())',
                                  references={f'value_{index}': f'A{index}' for index in range(1, 140)})
        for _ in range(3):
            result = await w.update_action_async(action.to_dict(), w.revision)
            assert result['appliedAction']['references'] == {'value_1': 'A1', 'value_2': 'A2'}
        fresh = replace(action, source='def check(self):\n    self.value_5.set(42)', references={})
        result = await w.update_action_async(fresh.to_dict(), w.revision)
        assert result['appliedAction']['references'] == {'value_5': 'A5'}
        assert w.value('A5') == 5  # Applying does not invoke.
        await w.run_action_async('check')
        assert w.value('A5') == 42
        saved = SheetDocument.loads(w.document.dumps())
        assert saved.actions[0].references == {'Sheet1.value_5': 'A5'}
    finally:
        w.close()


def test_reference_maps_exclude_nested_self_receivers():
    from reaktiv_workbook.actions import rewrite_members, rewrite_action_handles
    definition = ActionDefinition('check', '''def check(self):
    class Device:
        def read(self):
            return self.unrelated() + self.cells.Other.A1()
    return self.count() + self.cells.Other.A1()''', references={'count': 'A1', 'unrelated': 'B1'})
    assert definition.references == {'count': 'A1'}
    renamed = rewrite_members(definition, {'A1': 'total'})
    assert 'self.unrelated()' in renamed and 'return self.total()' in renamed
    moved = rewrite_action_handles(definition, {'Other.A1': 'Other.B2'})
    assert 'return self.unrelated() + self.cells.Other.A1()' in moved
    assert 'return self.count() + self.cells.Other.B2()' in moved


@pytest.mark.asyncio
async def test_actions_accept_the_cell_spelling_self_workbook_sheet_member_everywhere():
    """`self.workbook.Sheet.member` (as in cells) works in actions: live, saved, renamed."""
    from reaktiv_workbook.model import SheetTab
    source = '''def copy_measurement(self):
    self.workbook.PreAnalyze.voltage_adc.set(self.workbook.PLC.voltage_adc())
    return self.workbook.PreAnalyze.voltage_adc()
'''
    book = SheetDocument(name='Workbook spelling', sheet_name='Main', sheets=(SheetTab(name='PLC'), SheetTab(name='PreAnalyze')), cells=(
        CellDefinition('PLC!E5', 'input', '12', name='voltage_adc'),
        CellDefinition('PreAnalyze!A9', 'input', '0', name='voltage_adc'),
    ), actions=(ActionDefinition('copy_measurement', source),))
    workbook = ReactiveWorkbook()
    try:
        workbook.load_document(book)
        snapshot = await workbook.run_action_async('copy_measurement')
        assert snapshot.actions[0]['status'] == 'succeeded'
        assert next(c for c in snapshot.cells if c['id'] == 'PreAnalyze!A9')['value'] == 12
    finally:
        workbook.close()
    restored = SheetDocument.loads(book.dumps())
    assert 'self.PreAnalyze.voltage_adc' in restored.actions[0].source  # stored in the short form
    assert 'self.workbook' not in restored.actions[0].source
