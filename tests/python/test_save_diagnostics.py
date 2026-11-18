import reaktiv_workbook.workbook_format as format_module
from dataclasses import replace
import ast

from reaktiv_workbook import CellDefinition, SheetDocument
from reaktiv_workbook.model import verify_written_document


def document(source='1'):
    return SheetDocument(cells=(
        CellDefinition('A13', 'input', source, name='voltage'),
        CellDefinition('E13', 'input', '2', name='sweep'),
    ))


def test_generated_empty_method_identifies_preceding_cell_not_next_decorator():
    doc = document()
    broken = doc.dumps().replace('voltage = cell("A13", field(1), label="voltage")',
        '@cell("A13", label="voltage")\n    @input_cell\n    def voltage(self):\n        # missing body')
    # Match the original failure where Python points at the following declaration.
    problem = verify_written_document(broken, doc.to_dict())[0]
    assert problem.startswith('The file would not load')
    assert 'Cell A13 (voltage)' in problem
    assert 'Generated Python file line' in problem
    assert 'def voltage(self):' in problem
    assert 'cell code parses successfully' in problem
    assert 'Cell E13' not in problem


def test_reference_generation_failure_keeps_cell_context(monkeypatch):
    doc = document()
    good = doc.dumps()
    broken = good.replace('voltage = cell("A13", field(1), label="voltage")',
        '@cell("A13", label="voltage")\n    @input_cell\n    def voltage(self):\n        # missing body')
    monkeypatch.setattr(format_module, 'dump_document', lambda _: broken)
    problem = verify_written_document(good, doc.to_dict())[0]
    assert problem.startswith('The workbook could not be checked')
    assert 'Cell A13 (voltage)' in problem
    assert 'file-generation problem' in problem


def test_invalid_cell_source_explains_editor_line_and_how_to_fix_it():
    doc = document()
    expected = replace(doc, cells=(replace(doc.cells[0], source='def helper():\nnot_indented()'), *doc.cells[1:]))
    problem = verify_written_document(doc.dumps(), expected.to_dict())[0]
    assert 'Cell A13 (voltage)' in problem
    assert 'cell editor, code line 2' in problem
    assert 'not_indented()' in problem
    assert 'Add an indented body' in problem


def test_comment_only_input_preserves_source_and_saves_successfully():
    doc = document('# Netzspannung')
    source = doc.dumps()
    ast.parse(source)
    assert '# Netzspannung\n        pass  # reaktiv: empty cell' in source
    assert SheetDocument.loads(source).cells == doc.cells
    assert verify_written_document(source, doc.to_dict()) == []


def test_pass_written_by_user_is_not_removed():
    doc = document('# Explicit no-op\npass')
    assert SheetDocument.loads(doc.dumps()).cells == doc.cells


def test_generated_error_on_second_sheet_reports_qualified_cell():
    from reaktiv_workbook.model import SheetTab
    doc = SheetDocument(cells=(CellDefinition('A13','input','1',name='voltage'),
        CellDefinition('Other!A13','input','2',name='voltage')), sheets=(SheetTab('Other'),))
    broken = doc.dumps().replace('voltage = cell("A13", field(2), label="voltage")',
        '@cell("A13", label="voltage")\n    @input_cell\n    def voltage(self):\n        # missing body')
    problem = verify_written_document(broken, doc.to_dict())[0]
    assert 'Cell Other!A13 (voltage)' in problem
