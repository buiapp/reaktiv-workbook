"""Type checking of workbooks with pyright."""

import pytest

from reaktiv_workbook import typecheck
from reaktiv_workbook.cli import main
from reaktiv_workbook.model import CellDefinition, SheetDocument
from reaktiv_workbook.runtime import RuntimeServer

needs_pyright = pytest.mark.skipif(typecheck.pyright_command() is None, reason="needs pyright (or uv)")


def by_cell(result):
    found = {}
    for item in result["diagnostics"]:
        found.setdefault(item["cellId"], []).append(item)
    return found


def workbook():
    return SheetDocument(
        cells=(
            CellDefinition("A1", "input", "125000", name="revenue"),
            CellDefinition("A2", "formula", "revenue * 0.2", name="tax", annotation="str"),
            CellDefinition("A3", "formula", "revenue.upper()", name="shout"),
            CellDefinition("A4", "formula", "first = revenue + 1\nsecond = first * 2\nreturn second.missing"),
            CellDefinition("A5", "formula", "revenue * 2", name="double", annotation="int"),
            CellDefinition("B1", "markdown", "Tax: {{ tax }}"),
        ),
        code="def helper() -> int:\n    return 'text'",
    )


@needs_pyright
def test_types_flow_between_cells_and_findings_land_on_their_cell():
    found = by_cell(typecheck.check_document(workbook()))
    # The hint on tax is checked against its formula ...
    assert [item["rule"] for item in found["A2"]] == ["reportReturnType"]
    assert 'Type "float" is not assignable to return type "str"' in found["A2"][0]["message"]
    # ... the input's type reaches the cells that read it, named by its label ...
    assert 'Cannot access attribute "upper" for class "int"' in found["A3"][0]["message"]
    # ... the line is the cell's own line ...
    assert [item["line"] for item in found["A4"]] == [3]
    # ... correct hints and notes are quiet, and shared code is reported without a cell.
    assert "A5" not in found and "B1" not in found
    assert found[None][0]["rule"] == "reportReturnType"


@needs_pyright
def test_messages_name_cells_by_label():
    document = SheetDocument(
        cells=(
            CellDefinition("A1", "input", "'text'", name="title"),
            CellDefinition("A2", "formula", "def shout(value: int) -> int:\n    return value\nreturn shout"),
            CellDefinition("A3", "formula", "A2(title)"),
        )
    )
    message = by_cell(typecheck.check_document(document))["A3"][0]["message"]
    assert "self." not in message and '"str"' in message


@needs_pyright
def test_the_cli_and_the_kernel_check_types(capsys):
    server = RuntimeServer()
    try:
        result = server.dispatch("/v1/check", {"document": workbook().to_dict(), "mode": "standard"})
    finally:
        server.close()
    assert result["available"] and {"A2", "A3", "A4"} <= {item["cellId"] for item in result["diagnostics"]}


def test_unknown_modes_and_a_missing_checker(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="standard, strict"):
        typecheck.check_document(workbook(), "loose")
    monkeypatch.setattr(typecheck, "pyright_command", lambda: None)
    result = typecheck.check_document(workbook())
    assert result == {"available": False, "reason": result["reason"], "diagnostics": []}
    path = tmp_path / "budget.sheet.py"
    workbook().save(path)
    assert main([str(path), "--types"]) == 2


@needs_pyright
def test_cli_types_exit_status(tmp_path, capsys):
    path = tmp_path / "budget.sheet.py"
    workbook().save(path)
    assert main([str(path), "--types"]) == 1
    out = capsys.readouterr().out
    assert "type\ttax\t1\terror\tType \"float\" is not assignable" in out
    assert "type\tshared code" in out


def test_explicit_resource_diagnostics_distinguish_parameters_and_loader():
    from reaktiv_workbook.typecheck import _members, _diagnostic
    document=SheetDocument(cells=(CellDefinition('A1','resource',
        '# Fetch\nreturn params',params='# Capture\nrequest: int = "bad"\nreturn request'),))
    source=document.dumps()
    members,labels=_members(source,document)
    for section,line_text in [('parameters','request: int = "bad"'),('source','return params')]:
        line=next(i for i,text in enumerate(source.splitlines()) if text.strip()==line_text)
        diagnostic=_diagnostic({'severity':'error','message':'example','range':{'start':{'line':line}}},members,labels)
        assert diagnostic['line']==2
        assert diagnostic.get('section','source')==section


def test_linked_computation_findings_map_to_the_computation_editor():
    from reaktiv_workbook.typecheck import _members, _diagnostic
    document = SheetDocument(cells=(CellDefinition('A1', 'linked', '10', computation='# Compute\nvalue: int = "bad"\nreturn value', annotation='int'),))
    source = document.dumps()
    members, labels = _members(source, document)
    line = next(index for index, text in enumerate(source.splitlines()) if text.strip() == 'value: int = "bad"')
    diagnostic = _diagnostic({'severity': 'error', 'message': 'example', 'range': {'start': {'line': line}}}, members, labels)
    assert diagnostic['cellId'] == 'A1'
    assert diagnostic['section'] == 'computation'
    assert diagnostic['line'] == 2
