"""Running ruff on a workbook and saving it again gives back ruff's output (no churn).

The writer lays out generated code like `ruff format`; user code is kept as typed, so
after one ruff run it is ruff's and stays that way."""
from dataclasses import replace
from pathlib import Path
import shutil
import subprocess

import pytest
from reaktiv_workbook import SheetDocument

ROOT = Path(__file__).parents[2]
RUFF = shutil.which('ruff') or (str(Path(__file__).parents[2] / '.venv/bin/ruff') if (ROOT / '.venv/bin/ruff').exists() else None)
WORKBOOKS = sorted([*ROOT.glob('examples/**/*.workbook.py'),
                    *(ROOT / 'tests/fixtures/workbooks').glob('*.app.sheet.py')])
RESIDUAL: set[str] = set()


def ruff_format(text: str) -> str:
    assert RUFF is not None
    result = subprocess.run([RUFF, 'format', '--isolated', '--stdin-filename', 'workbook.py', '-'],
                            input=text, capture_output=True, text=True, check=True)
    return result.stdout


@pytest.mark.skipif(RUFF is None, reason='ruff is not installed')
@pytest.mark.parametrize('path', [path for path in WORKBOOKS if str(path.relative_to(ROOT)) not in RESIDUAL],
                         ids=lambda path: str(path.relative_to(ROOT)))
def test_saving_after_ruff_keeps_ruffs_layout(path: Path) -> None:
    formatted = ruff_format(replace(SheetDocument.load(path), snapshot=None).dumps())
    assert SheetDocument.loads(formatted).dumps() == formatted


@pytest.mark.skipif(RUFF is None, reason='ruff is not installed')
def test_generated_scaffolding_is_already_ruff_formatted() -> None:
    # A workbook without user code beyond simple values is written exactly as ruff would.
    for name in ('sheets', 'nested-notes', 'path-widgets', 'reactive-widget-settings'):
        text = SheetDocument.load(ROOT / f'tests/fixtures/workbooks/{name}.app.sheet.py').dumps()
        assert ruff_format(text) == text, name
