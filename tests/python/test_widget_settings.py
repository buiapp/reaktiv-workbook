from dataclasses import replace

from reaktiv_workbook import CellDefinition, ReactiveWorkbook, SheetDocument, move_cells
from reaktiv_workbook.model import SheetTab


def value(snapshot, cell_id):
    return next(cell for cell in snapshot.cells if cell['id'] == cell_id)


def test_widget_settings_are_cached_reactive_leaves_and_do_not_reset_inputs():
    workbook = ReactiveWorkbook()
    cells = [
        CellDefinition('A1', 'input', '10', name='limit'),
        CellDefinition('A2', 'input', '2', name='chosen', view={'widget': {'type': 'range', 'min': 0, 'max': 'measure(limit * 2)', 'step': 'limit / 10'}}),
        CellDefinition('A3', 'input', '0', name='unrelated'),
    ]
    first = workbook.apply(cells, code="events = []\ndef measure(value):\n    events.append(value)\n    return value")
    assert value(first, 'A2')['widget'] == {'type': 'range', 'min': 0, 'max': 20, 'step': 1}
    assert first.to_dict()['widgetDependencies'] == {'A2': ['A1']}
    node = workbook._widget_configs['A2'][1]
    # The computed is reused when a presentation field or unrelated input changes.
    second = workbook.apply([cells[0], replace(cells[1], color='#abcdef'), replace(cells[2], source='1')])
    assert workbook._widget_configs['A2'][1] is node
    assert value(second, 'A2')['value'] == 2
    assert workbook._import_globals['events'] == [20]
    third = workbook.apply([replace(cells[0], source='5'), cells[1], cells[2]])
    assert value(third, 'A2')['widget']['max'] == 10
    assert workbook._import_globals['events'] == [20, 10]
    assert value(third, 'A2')['widget']['step'] == .5
    assert value(third, 'A2')['value'] == 2
    changed = replace(cells[1], view={'widget': {'type': 'range', 'max': 'limit * 3'}})
    fourth = workbook.apply([cells[0], changed, cells[2]])
    assert value(fourth, 'A2')['widget']['max'] == 30
    assert value(fourth, 'A2')['value'] == 2
    workbook.close()


def test_widget_expressions_errors_recover_and_never_become_input_errors():
    workbook = ReactiveWorkbook()
    definitions = [CellDefinition('A1', 'input', '0', name='size'), CellDefinition('A2', 'input', '4', view={'widget': {'type': 'number', 'step': 'size'}})]
    first = workbook.apply(definitions)
    assert 'positive' in value(first, 'A2')['widgetError']
    assert value(first, 'A2')['error'] is None
    assert value(first, 'A2')['value'] == 4
    second = workbook.apply([replace(definitions[0], source='2'), definitions[1]])
    assert 'widgetError' not in value(second, 'A2')
    assert value(second, 'A2')['widget']['step'] == 2
    workbook.close()


def test_widget_options_scope_moves_and_file_roundtrip():
    definitions = [
        CellDefinition('A1', 'input', '["one", "two"]', name='choices'),
        CellDefinition('A2', 'input', '"one"', view={'widget': {'type': 'select', 'options': 'choices'}}),
        CellDefinition('Other!A1', 'input', '20', name='limit'),
        CellDefinition('Other!A2', 'input', '3', view={'widget': {'type': 'range', 'max': 'limit', 'min': 'Sheet1.A4'}}),
        CellDefinition('A4', 'input', '1'),
    ]
    workbook = ReactiveWorkbook()
    first = workbook.apply(definitions, sheets=['Sheet1', 'Other'])
    assert value(first, 'A2')['widget']['options'] == ['one', 'two']
    assert value(first, 'Other!A2')['widget']['max'] == 20
    assert first.widget_dependencies['Other!A2'] == ['A4', 'Other!A1']
    moved = move_cells(definitions, 'A4', 'A5', sheets=['Sheet1', 'Other'])
    assert next(cell for cell in moved if cell.id == 'Other!A2').view['widget']['min'] == 'Sheet1.A5'
    document = SheetDocument(name='Reactive widgets', cells=moved, sheets=(SheetTab('Other'),))
    reopened = SheetDocument.loads(document.dumps())
    assert next(cell for cell in reopened.cells if cell.id == 'A2').view['widget']['options'] == 'choices'
    workbook.close()


def test_cli_check_reports_invalid_widget_settings(tmp_path, capsys):
    from reaktiv_workbook.cli import main
    path = tmp_path / 'invalid.sheet.py'
    SheetDocument(name='Invalid widget', cells=(CellDefinition('A1', 'input', '3', view={'widget': {'type': 'range', 'step': '0'}}),)).save(path)
    assert main([str(path), '--check']) == 1
    assert 'Widget settings' in capsys.readouterr().err


def test_python_widget_lambdas_roundtrip_and_react_for_dropdown_and_multiselect():
    definitions = (
        CellDefinition('A1', 'input', '["one", "two"]', name='choices'),
        CellDefinition('A2', 'input', '"one"', name='single', view={'widget': {'type': 'select', 'options': 'choices + ["other"]'}}),
        CellDefinition('A3', 'input', '["one"]', name='multiple', view={'widget': {'type': 'multiselect', 'options': 'choices'}}),
    )
    document = SheetDocument(name='Choices', cells=definitions)
    source = document.dumps()
    assert 'lambda self: self.choices() + ["other"]' in source
    reopened = SheetDocument.loads(source)
    assert [cell.view for cell in reopened.cells] == [cell.view for cell in definitions]
    workbook = ReactiveWorkbook()
    first = workbook.apply(reopened.cells)
    assert value(first, 'A2')['widget']['options'] == ['one', 'two', 'other']
    assert value(first, 'A3')['widget']['options'] == ['one', 'two']
    assert first.widget_dependencies == {'A2': ['A1'], 'A3': ['A1']}
    second = workbook.apply([replace(definitions[0], source='["one", "three"]'), *definitions[1:]])
    assert value(second, 'A2')['widget']['options'] == ['one', 'three', 'other']
    assert value(second, 'A3')['widget']['options'] == ['one', 'three']
    assert value(second, 'A2')['value'] == 'one'
    assert value(second, 'A3')['value'] == ['one']
    workbook.close()


def test_widget_lambda_parsing_does_not_execute_user_code():
    import pytest
    document = SheetDocument(name='Safe parse', cells=(CellDefinition('A1', 'input', '1', view={'widget': {'type': 'range', 'max': '1 / 0'}}),))
    reopened = SheetDocument.loads(document.dumps())
    assert reopened.cells[0].view['widget']['max'] == '1 / 0'
    with pytest.raises(ValueError, match='lambda self'):
        SheetDocument.loads(document.dumps().replace('lambda self:', 'lambda other:'))


def test_multiline_widget_lambda_keeps_python_syntax_and_comments():
    document = SheetDocument(name='Multiline', cells=(
        CellDefinition('A1', 'input', '10', name='limit'),
        CellDefinition('A2', 'input', '3', view={'widget': {'type': 'range', 'max': 'limit * 2'}}),
    ))
    written = document.dumps()
    assert 'lambda self: self.limit() * 2' in written
    source = written.replace('lambda self: self.limit() * 2', 'lambda self: (\n        self.limit()  # keep this comment\n        * 2\n    )')
    reopened = SheetDocument.loads(source)
    assert '# keep this comment' in reopened.cells[1].view['widget']['max']
    workbook = ReactiveWorkbook()
    assert value(workbook.apply(reopened.cells), 'A2')['widget']['max'] == 20
    assert '# keep this comment' in reopened.dumps()
    assert value(workbook.apply(SheetDocument.loads(reopened.dumps()).cells), 'A2')['widget']['max'] == 20
    workbook.close()


def test_widget_text_and_states_are_reactive_without_changing_input_values():
    definitions = [
        CellDefinition('A1','input','False',name='running'),
        CellDefinition('A2','input','True',name='ready'),
        CellDefinition('A3','input','0',name='clicks',view={'widget': {
            'type':'button', 'label':{'expr':'"Stop" if running else "Start"'},
            'disabled':{'expr':'not ready'}, 'visible':{'expr':'ready or running'},
            'loading':{'expr':'running'}, 'pressed':{'expr':'running'},
        }}),
        CellDefinition('A4','input','""',name='message',view={'widget':{
            'type':'text','placeholder':{'expr':'"Busy" if running else "Enter a message"'},
            'label':'Message',
        }}),
    ]
    w=ReactiveWorkbook()
    try:
        first=w.apply(definitions)
        assert value(first,'A3')['widget']=={'type':'button','label':'Start','disabled':False,'visible':True,'loading':False,'pressed':False}
        assert first.widget_dependencies['A3']==['A1','A2']
        assert value(first,'A4')['widget']['placeholder']=='Enter a message'
        second=w.apply([replace(definitions[0],source='True'),replace(definitions[1],source='False'),*definitions[2:]])
        assert value(second,'A3')['widget']['label']=='Stop'
        assert value(second,'A3')['widget']['disabled'] is True
        assert value(second,'A3')['widget']['loading'] is True
        assert value(second,'A3')['value']==0
        assert value(second,'A4')['value']==''
    finally:
        w.close()


def test_widget_config_roundtrip_moves_and_preserves_literal_labels():
    definitions=(CellDefinition('A1','input','False',name='busy'),
        CellDefinition('B1','input','False',view={'widget':{'type':'button','buttonMode':'toggle',
            'label':{'expr':'"Stop" if A1 else "Start"'},'disabled':{'expr':'A1'},'placeholder':'A1 is literal text'}}))
    document=SheetDocument(cells=definitions)
    written=document.dumps()
    assert 'lambda self: self.busy()' in written
    reopened=SheetDocument.loads(written)
    assert reopened.cells[1].view["widget"]["disabled"]=={"expr":"busy"}
    assert SheetDocument.loads(reopened.dumps())==reopened
    moved=move_cells(definitions,'A1','A2')
    widget=next(cell for cell in moved if cell.id=='B1').view['widget']
    assert widget['disabled']=={'expr':'A2'}
    assert widget['placeholder']=='A1 is literal text'


def test_invalid_reactive_widget_state_reports_configuration_error_and_recovers():
    definitions=[CellDefinition('A1','input','3',name='state'),CellDefinition('A2','input','"keep"',view={'widget':{'type':'text','disabled':{'expr':'state'}}})]
    w=ReactiveWorkbook()
    try:
        first=w.apply(definitions)
        assert 'True or False' in value(first,'A2')['widgetError']
        assert value(first,'A2')['error'] is None
        assert value(first,'A2')['value']=='keep'
        second=w.apply([replace(definitions[0],source='True'),definitions[1]])
        assert value(second,'A2')['widget']['disabled'] is True
        assert 'widgetError' not in value(second,'A2')
    finally:
        w.close()


def test_widget_options_changes_do_not_discard_selected_values_and_track_branches():
    definitions=[CellDefinition('A1','input','True',name='first'),CellDefinition('A2','input','["a", "b"]',name='choices'),
        CellDefinition('A3','input','["b"]',view={'widget':{'type':'multiselect','options':'choices if first else ["c"]'}})]
    w=ReactiveWorkbook()
    try:
        before=w.apply(definitions)
        assert before.widget_dependencies['A3']==['A1','A2']
        after=w.apply([replace(definitions[0],source='False'),*definitions[1:]])
        assert after.widget_dependencies['A3']==['A1']
        assert value(after,'A3')['widget']['options']==['c']
        assert value(after,'A3')['value']==['b']
    finally:
        w.close()


def test_reactive_widget_controls_example_changes_choices_and_button_state():
    from pathlib import Path
    path=Path(__file__).parents[2]/'examples/features/reactive-widget-controls.workbook.py'
    document=SheetDocument.load(path)
    w=ReactiveWorkbook()
    try:
        first=w.load_document(document)
        assert value(first,'B1')['widget']['options']==['Sandbox A','Sandbox B']
        assert value(first,'C1')['widget']['label']=='Start'
        changed=[replace(cell,source='"Production"') if cell.id=='A1' else cell for cell in document.cells]
        second=w.apply(changed)
        assert value(second,'B1')['widget']['options']==['Live EU','Live US']
        assert value(second,'B1')['value']=='Sandbox A'
        assert value(second,'C1')['widget']['disabled'] is True
        assert value(second,'D2')['widget']['visible'] is False
    finally:
        w.close()


def test_path_widgets_roundtrip_and_keep_paths_when_settings_change():
    definitions = (
        CellDefinition('A1', 'input', 'False', name='busy'),
        CellDefinition('B1', 'input', repr('C:\\data\\測定 file.csv'), name='source_file',
                       view={'widget': {'type': 'file', 'disabled': {'expr': 'busy'}}}),
        CellDefinition('C1', 'input', repr('/tmp/output folder'), name='output_folder',
                       view={'widget': {'type': 'folder', 'label': 'Output folder'}}),
    )
    reopened = SheetDocument.loads(SheetDocument(cells=definitions).dumps())
    assert [cell.view for cell in reopened.cells] == [cell.view for cell in definitions]
    workbook = ReactiveWorkbook()
    try:
        first = workbook.apply(reopened.cells)
        assert value(first, 'B1')['widget']['type'] == 'file'
        assert value(first, 'C1')['widget']['type'] == 'folder'
        assert first.widget_dependencies['B1'] == ['A1']
        second = workbook.apply([replace(reopened.cells[0], source='True'), *reopened.cells[1:]])
        assert value(second, 'B1')['widget']['disabled'] is True
        assert value(second, 'B1')['value'] == 'C:\\data\\測定 file.csv'
        assert value(second, 'C1')['value'] == '/tmp/output folder'
    finally:
        workbook.close()


def test_widget_debounce_is_validated_saved_and_resolved(tmp_path):
    import pytest
    from reaktiv_workbook.widget_config import normalize_widget

    workbook = ReactiveWorkbook()
    cells = [
        CellDefinition('A1', 'input', '2', name='amount', view={'widget': {'type': 'range', 'min': 0, 'max': 10, 'debounce': 0}}),
        CellDefinition('A2', 'input', '"x"', name='query', view={'widget': {'type': 'text', 'debounce': 250, 'label': 'Search'}}),
    ]
    snapshot = workbook.apply(cells)
    assert value(snapshot, 'A1')['widget']['debounce'] == 0
    assert value(snapshot, 'A2')['widget'] == {'type': 'text', 'label': 'Search', 'debounce': 250}
    path = tmp_path / 'debounce.workbook.py'
    SheetDocument(name='debounce', cells=tuple(cells)).save(path)
    loaded = {cell.id: cell for cell in SheetDocument.load(path).cells}
    assert loaded['A1'].view['widget']['debounce'] == 0 and loaded['A2'].view['widget']['debounce'] == 250
    for invalid in (-1, 10_001, 1.5, True, '0', 'amount'):
        with pytest.raises(ValueError, match='debounce'):
            normalize_widget({'type': 'range', 'debounce': invalid}, 'A1')
