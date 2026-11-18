"""Prepare this repository; reaktiv comes from PyPI unless --core-wheel is given."""
from pathlib import Path
import argparse
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--core-wheel', type=Path, help='Use a wheel built by the separate reaktiv repository instead of PyPI (to test an unreleased core)')
args = parser.parse_args()
if args.core_wheel and not args.core_wheel.is_file():
    parser.error('--core-wheel must refer to an existing wheel')
python = root / '.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
if not python.exists():
    subprocess.run(['uv', 'venv', '--python', '3.12', str(root / '.venv')], cwd=root, check=True)
command = ['uv', 'pip', 'install', '--no-config', '--python', str(python), '--editable', str(root),
           '--group', str(root / 'pyproject.toml') + ':dev']
if args.core_wheel:
    command.append(str(args.core_wheel.resolve()))
subprocess.run(command, cwd=root, check=True)
