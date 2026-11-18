"""Live dependency edges and resource parameter/snapshot contracts."""
import asyncio
from dataclasses import replace
import pytest
from reaktiv import ResourceStatus
from reaktiv_workbook import CellDefinition as C, ReactiveWorkbook, SheetDocument


def value(snapshot, cell_id):
    return next(c for c in snapshot.cells if c['id'] == cell_id)


def test_live_dependencies_follow_branches_and_function_reads():
    cells = [C('A1','input','True',name='choose_a'), C('A2','input','10',name='a'),
             C('A3','input','20',name='b'), C('B1','formula','a if choose_a else b'),
             C('B2','formula','def choose():\n    return a if choose_a else b',name='choose'),
             C('B3','formula','choose()')]
    w = ReactiveWorkbook()
    try:
        first = w.apply(cells)
        assert first.dependencies['B1'] == ['A1','A2']
        assert first.dependencies['B2'] == []  # Function definition does not read inputs.
        assert first.dependencies['B3'] == ['A1','A2','B2']
        assert first.source_dependencies['B1'] == ['A1','A2','A3']
        second = w.apply([replace(c,source='False') if c.id=='A1' else c for c in cells])
        assert second.dependencies['B1'] == ['A1','A3']
        assert second.dependencies['B3'] == ['A1','A3','B2']
    finally:
        w.close()


def test_notes_linked_effects_errors_and_untracked_reads():
    w=ReactiveWorkbook()
    try:
        snapshot=w.apply([C('A1','input','True',name='enabled'),C('A2','input','5',name='amount'),
            C('B1','linked','amount if enabled else 0'),
            C('B2','markdown','{{ amount if enabled else 0 }}'),
            C('C1','effect','if enabled:\n    print(amount)'),
            C('C2','effect','print(amount)',trigger='manual'),
            C('D1','formula','enabled\nraise ValueError("stop")\namount'),
            C('D2','formula','untracked(lambda: amount)')])
        for cell_id in ['B1','B2','C1']:
            assert snapshot.dependencies[cell_id] == ['A1','A2']
        assert snapshot.dependencies['C2'] == []
        assert snapshot.dependency_states['C2'] == 'unobserved'
        assert snapshot.dependencies['D1'] == ['A1']
        assert snapshot.dependency_states['D1'] == 'partial'
        assert snapshot.dependencies['D2'] == []
        ran=w.run_effect('C2')
        assert ran.dependencies['C2']==['A2']
    finally:
        w.close()


@pytest.mark.asyncio
async def test_explicit_parameters_track_only_chosen_branch_and_idle():
    loads=[]
    w=ReactiveWorkbook({'record':loads.append})
    cells=[C('A1','input','False',name='enabled'), C('A2','input','7',name='amount'),
           C('B1','resource','record(params)\nawait asyncio.sleep(0)\nreturn params * 2',params='amount if enabled else None')]
    try:
        idle=await w.apply_async(cells)
        assert value(idle,'B1')['resourceStatus']=='idle'
        assert idle.dependencies['B1']==['A1'] and loads==[]
        cells[1]=replace(cells[1],source='8')
        await w.apply_async(cells)
        assert loads==[]
        cells[0]=replace(cells[0],source='True')
        loaded=await w.apply_async(cells)
        assert value(loaded,'B1')['value']==16
        assert loaded.dependencies['B1']==['A1','A2']
        assert loads==[8]
        cells[0]=replace(cells[0],source='False')
        idle=await w.apply_async(cells)
        assert idle.dependencies['B1']==['A1']
        assert value(idle,'B1')['resourceStatus']=='idle'
    finally:
        w.close()


@pytest.mark.asyncio
async def test_explicit_params_normalize_request_identity_and_report_errors():
    loads=[]
    w=ReactiveWorkbook({'record':loads.append})
    cells=[C('A1','input','" abc "',name='query'),
           C('B1','resource','record(params)\nreturn params',params='query.strip()')]
    try:
        await w.apply_async(cells)
        cells[0]=replace(cells[0],source='"abc"')
        await w.apply_async(cells)
        assert loads==['abc']
        cells[1]=replace(cells[1],params='query\nraise ValueError("bad parameters")')
        broken=await w.apply_async(cells)
        assert 'bad parameters' in value(broken,'B1')['error']
        assert broken.dependencies['B1']==['A1']
    finally:
        w.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('explicit',[False,True])
async def test_native_and_app_loaders_use_one_parameter_snapshot(explicit):
    started=asyncio.Event()
    release=asyncio.Event()
    observed=[]
    params='amount' if explicit else None
    source=('before = params' if explicit else 'before = amount')+'\nstarted.set()\nawait release.wait()\nobserved.append((before, '+('params' if explicit else 'amount')+'))\nreturn before'
    document=SheetDocument(cells=(C('A1','input','1',name='amount'),C('B1','resource',source,name='loaded',params=params)))
    text=document.dumps()
    reloaded=SheetDocument.loads(text)
    assert next(c for c in reloaded.cells if c.id=='B1').params==params
    # Native model: change input during await, then inspect both request snapshots.
    namespace={'started':started,'release':release,'observed':observed,'__name__':'snapshot_test'}
    exec(text,namespace)
    model_type=next(v for v in namespace.values() if isinstance(v,type) and bool(getattr(v, '__reaktiv_workbook__', None)))
    model=model_type()
    resource=model.Sheet1.loaded
    await asyncio.wait_for(started.wait(),2)
    model.Sheet1.amount.set(2)
    release.set()
    for _ in range(100):
        if resource.status()==ResourceStatus.RESOLVED:
            break
        await asyncio.sleep(.005)
    assert (1,1) in observed and (2,2) in observed
    assert resource.value()==2
    model.dispose()
    # App model: the same snapshot guarantee, including obsolete result suppression.
    started.clear();release.clear();observed.clear()
    w=ReactiveWorkbook({'started':started,'release':release,'observed':observed})
    try:
        applying=asyncio.create_task(w.apply_async(document.cells))
        await asyncio.wait_for(started.wait(),2)
        w._nodes['A1'].set(2)
        release.set()
        result=await asyncio.wait_for(applying,2)
        assert (1,1) in observed and (2,2) in observed
        assert value(result,'B1')['value']==2
    finally:
        w.close()


def test_parameter_comments_survive_roundtrip_and_moves():
    from reaktiv_workbook import move_cells
    params='# Request inputs\nkey = A1\nreturn {"key": key}  # captured'
    document=SheetDocument(cells=(C('A1','input','3'),C('B1','resource','return params["key"]',params=params)))
    loaded=SheetDocument.loads(document.dumps())
    assert next(c for c in loaded.cells if c.id=='B1').params==params
    moved=move_cells(loaded.cells,'A1','A3')
    assert next(c for c in moved if c.id=='B1').params==params.replace('A1','A3')


@pytest.mark.asyncio
async def test_explicit_loader_rejects_live_cell_reads():
    w=ReactiveWorkbook()
    try:
        snapshot=await w.apply_async([C('A1','input','3',name='amount'),C('B1','resource','return amount',params='amount')])
        assert 'move cell references into Parameters' in value(snapshot,'B1')['error']
    finally:
        w.close()


def test_authored_parameter_function_is_preserved_without_mode_metadata():
    source = """from reaktiv import ReactiveModel, field, resource
from reaktiv_workbook import cell, sheet
@sheet({"name": "Authored"})
class Authored(ReactiveModel):
    enabled = cell("A1", field(False))
    amount = cell("A2", field(3))
    @cell("B1")
    @resource
    def loaded(self):
        # Only subscribe to amount while enabled.
        return self.amount() if self.enabled() else None
    @loaded.loader
    async def fetch(self, resource_params):
        return resource_params.params * 2
"""
    document=SheetDocument.loads(source)
    resource=next(cell for cell in document.cells if cell.id=='B1')
    assert resource.params=='# Only subscribe to amount while enabled.\namount if enabled else None'
    assert resource.source=='resource_params.params * 2'
    assert SheetDocument.loads(document.dumps())==document


@pytest.mark.asyncio
async def test_params_label_remains_usable_without_shadowing_explicit_loader_context():
    for parameter_code,body in [(None,'params * 2'),('params','params * 2')]:
        document=SheetDocument(cells=(C('A1','input','3',name='params'),C('B1','resource',body,params=parameter_code)))
        reopened=SheetDocument.loads(document.dumps())
        for candidate in [document,reopened]:
            w=ReactiveWorkbook()
            try:
                snapshot=await w.apply_async(candidate.cells)
                assert value(snapshot,'B1')['value']==6
                assert snapshot.dependencies['B1']==['A1']
            finally:
                w.close()


@pytest.mark.asyncio
async def test_cancel_one_resource_retains_value_and_keeps_other_loads_and_dependencies():
    started, cleaned = asyncio.Event(), asyncio.Event()
    workbook = ReactiveWorkbook({'started': started, 'cleaned': cleaned})
    cells = [C('A1', 'input', '1', name='amount'),
             C('B1', 'resource', 'if params == 2:\n    started.set()\n    try:\n        await asyncio.sleep(100)\n    finally:\n        cleaned.set()\nreturn params * 10', params='amount'),
             C('B2', 'resource', 'await asyncio.sleep(0.03)\nreturn params * 20', params='amount'),
             C('C1', 'formula', 'B1 + 1')]
    try:
        await workbook.apply_async(cells)
        cells[0] = replace(cells[0], source='2')
        pending = asyncio.create_task(workbook.apply_async(cells))
        await asyncio.wait_for(started.wait(), 1)
        assert workbook.cancel_resource('B1')
        assert not workbook.cancel_resource('A1')
        assert not workbook.cancel_resource('missing')
        snapshot = await asyncio.wait_for(pending, 1)
        assert cleaned.is_set()
        assert value(snapshot, 'B1')['resourceStatus'] == 'cancelled'
        assert value(snapshot, 'B1')['value'] == 10
        assert value(snapshot, 'C1')['value'] == 11
        assert value(snapshot, 'B2')['resourceStatus'] == 'resolved'
        assert value(snapshot, 'B2')['value'] == 40
        assert snapshot.dependencies['B1'] == ['A1']
        assert not workbook.cancel_resource('B1')
        # Unrelated applies leave a cancelled request alone; changed params resume it.
        unchanged = await workbook.apply_async(cells)
        assert value(unchanged, 'B1')['resourceStatus'] == 'cancelled'
        cells[0] = replace(cells[0], source='3')
        resumed = await workbook.apply_async(cells)
        assert value(resumed, 'B1')['value'] == 30
        assert value(resumed, 'C1')['value'] == 31
    finally:
        workbook.close()
