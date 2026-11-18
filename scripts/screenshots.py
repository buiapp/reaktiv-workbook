"""Capture the README screenshot (docs/screenshot.jpg).

    npm run build
    uv run --no-project --with playwright python scripts/screenshots.py [--chromium PATH]

Each shot opens the built browser app (browser-only Pyodide mode), so it shows exactly
what a visitor gets. The website's images are captured by the reaktiv-workbook-site
repository. Without --chromium, Playwright's own Chromium is used
(`playwright install chromium`).
"""
from __future__ import annotations

import argparse
import functools
import http.server
import threading
from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import Browser, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'dist/reaktiv-workbook/browser'


@dataclass(frozen=True)
class Shot:
    target: Path
    example: str
    view: str = 'Notes'
    scale: int = 2
    quality: int = 82
    # Only the note, cut to 16:10 from its top: the content stays legible on a small card.
    note_only: bool = False
    # Keep only this part of the window (x, y, width, height in CSS pixels).
    crop: tuple[int, int, int, int] | None = None
    # A button to press before capturing (its accessible name), e.g. the graph's Fit.
    press: str | None = None


SHOTS = [
    Shot(ROOT / 'docs/screenshot.jpg', 'welcome.workbook.py', 'Split'),
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_: object) -> None:
        pass


def capture(browser: Browser, origin: str, shot: Shot) -> None:
    # A fresh context per shot: no draft or dismissed guide carries over.
    width, height = (1320, 820) if shot.scale == 2 else (1280, 900)
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  device_scale_factor=shot.scale, color_scheme='light')
    page = context.new_page()
    page.goto(f'{origin}/?example={shot.example}')
    start = page.locator('.kernel-notice-start')
    try:
        start.wait_for(timeout=15_000)
        if start.is_enabled():
            start.click()
    except Exception:
        pass  # started by itself
    page.get_by_text('Graph initialized').first.wait_for(timeout=180_000)
    page.wait_for_timeout(3_000)  # charts and widgets finish drawing
    close = page.locator('app-getting-started header button')
    if close.count():
        close.click()
    page.get_by_role('button', name=shot.view, exact=True).first.click()
    page.wait_for_timeout(1_500)
    page.mouse.move(0, 0)
    shot.target.parent.mkdir(parents=True, exist_ok=True)
    if shot.press is not None:
        page.get_by_role('button', name=shot.press, exact=True).first.click()
        page.wait_for_timeout(1_500)
    clip = None if shot.crop is None else dict(zip(('x', 'y', 'width', 'height'), shot.crop))
    if shot.note_only:
        box = page.locator('app-markdown-cell-editor').first.bounding_box()
        assert box is not None, f'{shot.example}: no note shown'
        clip = {'x': box['x'], 'y': box['y'], 'width': box['width'], 'height': box['width'] * 10 / 16}
    page.screenshot(path=str(shot.target), type='jpeg', quality=shot.quality, clip=clip)
    print(f'wrote {shot.target.relative_to(ROOT)}')
    context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or '').splitlines()[0])
    parser.add_argument('--chromium', help="Chromium executable (default: Playwright's)")
    parser.add_argument('only', nargs='*', help='Capture only these files (names without .jpg)')
    args = parser.parse_args()
    if not (APP / 'index.html').is_file():
        raise SystemExit('Build the app first: npm run build')
    shots = [shot for shot in SHOTS if not args.only or shot.target.stem in args.only]
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(APP)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium)
            for shot in shots:
                capture(browser, f'http://127.0.0.1:{server.server_port}', shot)
            browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
