# Development

How to run, test, extend and release Reaktiv Workbook from a source checkout. See
[Architecture](architecture.md) for how the pieces fit together.

## Run from source

```bash
uv sync
npm ci
npm start                     # http://localhost:4200
```

`npm start`, `npm run build` and `npm test` first copy the installed `reaktiv` package
and the Python sources into generated assets (`npm run sync:python`); never edit
`frontend/public/python`, `frontend/public/examples` or `frontend/public/vendor`.

```bash
MPLBACKEND=Agg uv run --no-sync pytest tests/python -q
uv run --no-sync pyright                       # strict, 0 errors
uv run --no-sync ruff check python tests scripts
npx ng test --watch=false
npm run build
npm run test:file-worker                       # real Pyodide
npm run test:runtime-worker                    # real Pyodide
```

Validate engine and example changes with the CLI too:
`uv run --no-sync reaktiv-workbook check examples/budget.workbook.py`.

## Documentation

`docs/*.md` is the user documentation. The website publishes it at `/docs/` with
Starlight, from the release the website is pinned to. Keep each page readable on GitHub:

- start with one `# Title` (it becomes the page title),
- link other pages relatively (`[Cells](cells.md#references)`); the site rewrites them,
- link files outside `docs/` with GitHub URLs,
- add a new page to the website's sidebar too.

## Kernels

The same Python package runs in three places, which must behave identically:

| Consumer | Runs Python in |
| --- | --- |
| Browser app | Pyodide in a Web Worker |
| CLI (`edit`, `run`) | the local CPython, in-process |
| HTTP kernel | `python -m reaktiv_workbook.server` (FastAPI) |

The reference HTTP kernel is for local development:

```bash
uv run --no-sync python -m reaktiv_workbook.server --host 127.0.0.1 --port 8765
```

Choose **Python backend · HTTP** in the app and connect to `http://127.0.0.1:8765`. It
does not install the workbook's packages (`--requirements` lists them), is single-user
and unauthenticated, and executes cell code: keep it on localhost.

CLI sessions listen only on loopback with a per-session bearer token passed in the URL
fragment. `run` mode refuses authoring, console code and saves over HTTP, but it is a
presentation boundary, not a sandbox.

## Built-in controls

| Building block | Responsibility |
| --- | --- |
| `frontend/src/app/input-widgets.ts` | Widget types, values, literal encoding, shared renderer and builder registry |
| `frontend/src/app/widget-config.ts` | Setting helpers and interaction guards |
| `python/reaktiv_workbook/widget_config.py` | Supported types, validation and reactive settings |
| `frontend/src/app/rich-widget.component.ts` | Grid adapter |
| `frontend/src/app/note-nodes.ts` | Notes adapter |
| `frontend/src/app/widget-host.ts` | Optional host capabilities (the CLI path picker) |
| `python/reaktiv_workbook/model.py` | The only workbook writer and reader |

To add a compound control:

1. Decide its value type; reuse an existing type when only styling differs.
2. Add it to `WIDGET_TYPES` in both `input-widgets.ts` and `model.py`, and to the
   inspector's type picker.
3. Register one builder `(model, change, invokeAction) => HTMLElement` in
   `RICH_WIDGET_BUILDERS`; Notes and the grid both use it.
4. Render only the resolved model and send changes through the callback. Never mutate
   documents or call signals from a control.
5. Add renderer tests, Python reactive-setting tests and a case in
   `tests/fixtures/workbooks/cases.json`, then run the round-trip tests and `check`.

Widget settings are stored in `CellDefinition.view.widget`; the kernel resolves reactive
settings into the snapshot. Never save resolved settings back over the expressions.

## Themes

`frontend/public/themes.js` owns validation, the built-in palettes and applying CSS
variables before first paint; Angular uses it through `themes.ts`. Theme colours
override `--theme-*` tokens with the original `light-dark(...)` pairs as fallbacks.
Never turn JSON keys into CSS properties or inject JSON as stylesheet text.

## Build and release the Python package

```bash
npm ci
npm run package:python        # wheel and sdist in release/python/
```

The script builds the frontend with tracked examples, copies it into
`python/reaktiv_workbook/web/`, adds third-party licence notices and runs
`uv build --no-sources`. Installed users need neither Node nor the checkout.

Check the artifact in a clean environment before publishing:

```bash
uv venv /tmp/rw-release
uv pip install --no-config --python /tmp/rw-release/bin/python release/python/*.whl
/tmp/rw-release/bin/python scripts/test-python-package.py
uvx twine check release/python/*
```

Pushing a tag `vX.Y.Z` that matches `pyproject.toml`'s version publishes to PyPI
(`.github/workflows/publish.yml`, trusted publishing). The core `reaktiv>=0.25.0` is a
separate package and must be released first when it changes.
