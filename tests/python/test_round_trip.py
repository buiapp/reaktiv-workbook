"""Every bundled workbook survives save → open → save unchanged (the gate for format changes)."""
from dataclasses import replace
from pathlib import Path
import re

import pytest
from reaktiv_workbook import SheetDocument

ROOT = Path(__file__).parents[2]
FIXTURES = ROOT / 'tests/fixtures/workbooks'
WORKBOOKS = sorted([
    *ROOT.glob('examples/**/*.workbook.py'),
    *FIXTURES.glob('*.app.sheet.py'), *FIXTURES.glob('legacy/*.sheet.py'),
    *FIXTURES.glob('legacy-pre-rename/*.sheet.py'), *FIXTURES.glob('format2-initial/*.sheet.py'),
])


def canonical_source(source: str) -> str:
    """A cell ending in `def x`/`class x` returns it; an explicit `return x` there is implied."""
    match = re.search(r'\nreturn ([A-Za-z_]\w*)\s*$', source)
    if match and re.search(rf'(?m)^(?:async def|def|class) {match[1]}\b', source):
        return source[:match.start()]
    return source


@pytest.mark.parametrize('path', WORKBOOKS, ids=lambda path: str(path.relative_to(ROOT)))
def test_saving_twice_gives_the_same_file_and_keeps_every_cell(path: Path) -> None:
    opened = replace(SheetDocument.load(path), snapshot=None)
    first = opened.dumps()
    reopened = SheetDocument.loads(first)
    assert reopened.dumps() == first, 'saving the reopened workbook changed the file'
    assert [cell.id for cell in reopened.cells] == [cell.id for cell in opened.cells]
    for before, after in zip(opened.cells, reopened.cells):
        assert replace(after, source=canonical_source(after.source)) == replace(before, source=canonical_source(before.source)), before.id
    assert reopened.actions == opened.actions
    assert replace(reopened, cells=opened.cells, actions=opened.actions) == opened


@pytest.mark.parametrize('value', ['plain', "it's", 'say "hi"', 'both \' and "', 'back\\slash', 'new\nline',
                                   "\\'", '"\'"', 'ünïcode ✓', '\t\x00', ''])
def test_generated_strings_mean_the_same(value: str) -> None:
    from reaktiv_workbook.source_layout import py_string
    import ast
    assert ast.literal_eval(py_string(value)) == value


NATIVE = sorted([*FIXTURES.glob('*.app.sheet.py'), *ROOT.glob('examples/**/*.workbook.py')])


@pytest.mark.parametrize('path', NATIVE, ids=lambda path: str(path.relative_to(ROOT)))
def test_generated_files_run_as_plain_python(path: Path, tmp_path: Path) -> None:
    """The slim header must import everything the file uses: run it and read every cell."""
    import runpy
    from reaktiv_workbook import Workbook
    from reaktiv_workbook.schema import CellMetadata
    target = tmp_path / 'workbook_under_test.py'
    target.write_text(replace(SheetDocument.load(path), snapshot=None).dumps())
    try:
        namespace = runpy.run_path(str(target), run_name='native_check')
    except ModuleNotFoundError as error:
        pytest.skip(f'optional package missing: {error.name}')
    root = next(value for value in list(namespace.values()) if isinstance(value, type) and issubclass(value, Workbook) and value is not Workbook)

    async def read_every_cell() -> None:  # resources need a running event loop
        try:
            book = root()
        except ModuleNotFoundError as error:
            pytest.skip(f'optional package missing: {error.name}')
        try:
            for sheet in book.worksheet_names():
                worksheet = book.worksheet_instance(sheet)
                for name, descriptor in list(vars(type(worksheet)).items()):
                    if not isinstance(getattr(descriptor, '__reaktiv_workbook_cell__', None), CellMetadata):
                        continue
                    member = getattr(worksheet, name)
                    try:
                        member.value() if hasattr(member, 'value') and not hasattr(member, 'set') else member()
                    except NameError:
                        raise
                    except Exception:  # noqa: BLE001 - cell errors (data, timers) are not missing imports
                        pass
        finally:
            book.dispose()

    import asyncio
    asyncio.run(read_every_cell())


def test_notes_use_builtins_imports_and_shared_code_when_run_as_plain_python(tmp_path: Path) -> None:
    import runpy
    from reaktiv_workbook import CellDefinition
    document = SheetDocument(name='Notes', code='def double(value):\n    return value * 2',
                             imports=('import statistics',), cells=(
        CellDefinition('A1', 'input', '[1, 2, 3]', name='items'),
        CellDefinition('B1', 'markdown', '{{ len(items) }} {{ round(2.6) }} {{ double(3) }} {{ statistics.mean(items) }} {{ np.max(items) }}', name='note'),
    ))
    target = tmp_path / 'notes_check.py'
    target.write_text(document.dumps())
    namespace = runpy.run_path(str(target), run_name='notes_check')
    book = namespace['NotesWorkbook']()
    try:
        assert book.Sheet1.note() == '3 3 6 2 3'
    finally:
        book.dispose()
