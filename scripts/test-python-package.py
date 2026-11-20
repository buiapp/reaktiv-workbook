"""Smoke-test an installed release, outside the checkout (no Node or editable deps).

Usage: /path/to/clean/venv/bin/python scripts/test-python-package.py
The interpreter must have the wheel and its registry dependencies installed.
"""
from __future__ import annotations
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlsplit
from urllib.request import Request, urlopen

from reaktiv_workbook import ActionDefinition, CellDefinition, SheetDocument
from reaktiv_workbook.standalone import frontend_root


def post(endpoint, token, route, payload):
    request = Request(endpoint + route, data=json.dumps(payload).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def check_cli(mode, path, folder):
    with (folder / f'{mode}.log').open('w+') as output:
        process = subprocess.Popen([sys.executable, '-m', 'reaktiv_workbook', mode, str(path), '--headless'],
                                   cwd=folder, stdout=output, stderr=output)
        try:
            deadline = time.monotonic() + 20
            link = None
            while time.monotonic() < deadline:
                output.seek(0)
                lines = output.read().splitlines()
                link = next((line for line in lines if line.startswith('http://')), None)
                if link:
                    break
                if process.poll() is not None:
                    raise AssertionError(f'CLI {mode} exited unexpectedly: ' + '\n'.join(lines))
                time.sleep(.1)
            assert link, f'CLI {mode} did not start'
            parts = urlsplit(link)
            # Resolved like the app does: `session=/` names the server that printed the link.
            session = urlsplit(urljoin(link, parse_qs(parts.query)['session'][0]))
            endpoint = f'{session.scheme}://{session.netloc}'
            token = parse_qs(parts.fragment)['token'][0]
            with urlopen(endpoint + '/', timeout=10) as response:
                assert '<app-root' in response.read().decode()
            state = post(endpoint, token, '/v1/session', {})
            assert state['mode'] == mode
            updated = post(endpoint, token, '/v1/set-inputs', {'sources': {'A1': '7'}})
            assert next(cell['value'] for cell in updated['cells'] if cell['id'] == 'B1') == 14
            action_result = post(endpoint, token, '/v1/run-action', {'name': 'increase'})
            assert next(cell['value'] for cell in action_result['cells'] if cell['id'] == 'B1') == 16
            post(endpoint, token, '/v1/set-inputs', {'sources': {'A1': '7'}})
            if mode == 'edit':
                current = post(endpoint, token, '/v1/session', {})
                post(endpoint, token, '/v1/session-save', {
                    'document': current['document'], 'sessionRevision': current['revision']})
                assert next(cell.source for cell in SheetDocument.load(path).cells if cell.id == 'A1') == '7'
            else:
                try:
                    post(endpoint, token, '/v1/session-save', {'document': state['document']})
                except HTTPError as error:
                    assert error.code == 400
                else:
                    raise AssertionError('Run mode accepted a save')
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
            try:
                assert process.wait(timeout=10) == 0
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise AssertionError('CLI did not stop on Ctrl+C') from None
        try:
            urlopen(endpoint + '/', timeout=1)
        except (URLError, ConnectionError):
            pass
        else:
            raise AssertionError('CLI left its HTTP server running')


def main():
    executable = Path(sys.executable).with_name('reaktiv-workbook.exe' if sys.platform == 'win32' else 'reaktiv-workbook')
    subprocess.run([str(executable), '--version'], cwd=tempfile.gettempdir(), check=True)
    from reaktiv import signal
    from reaktiv.subtle import Watcher, signal_version
    import reaktiv
    assert not hasattr(reaktiv, 'action')
    source = signal(1)
    notified = []
    watcher = Watcher(lambda: notified.append(True))
    watcher.watch(source)
    source.set(2)
    assert notified == [True] and signal_version(source) == 1
    watcher.unwatch(source)
    root = frontend_root()
    assert root.name == 'web', f'IDE came from checkout instead of installed package: {root}'
    assert (root / '3rdpartylicenses.txt').is_file()
    with tempfile.TemporaryDirectory(prefix='reaktiv-workbook-wheel-') as directory:
        folder = Path(directory)
        path = folder / 'sample.workbook.py'
        SheetDocument(name='Installed smoke', cells=(
            CellDefinition('A1', 'input', '3', name='quantity'),
            CellDefinition('B1', 'formula', 'quantity * 2', name='total'),
        ), actions=(ActionDefinition('increase', 'def increase(self):\n    self.quantity.set(self.quantity() + 1)', references={'quantity': 'A1'}),)).save(path)
        subprocess.run([sys.executable, str(path), '--check'], cwd=folder, check=True)
        subprocess.run([sys.executable, '-m', 'reaktiv_workbook', 'check', str(path)], cwd=folder, check=True)
        check_cli('edit', path, folder)
        original = path.read_bytes()
        check_cli('run', path, folder)
        assert path.read_bytes() == original
    print('Installed package: check, IDE assets, live inputs, edit/save, run restrictions and Ctrl+C passed.')


if __name__ == '__main__':
    main()
