# Standalone CLI and Python releases

The CLI owns server startup and shutdown. Generated `.workbook.py` entry points call
the evaluator only; they cannot choose a UI command through their arguments.
The existing `WorkbookSession.open_editor()` remains available for embedding host
scripts. A workbook is not a server configuration or a second implementation of
its own launcher.

## Commands

```bash
reaktiv-workbook new                          # create ./untitled.workbook.py and open it
reaktiv-workbook new --from welcome           # copy a bundled example (./welcome.workbook.py)
reaktiv-workbook new plan.workbook.py --from budget
reaktiv-workbook edit                         # open/create ./untitled.workbook.py
reaktiv-workbook edit analysis.workbook.py       # browser IDE; Save writes this file
reaktiv-workbook edit analysis.workbook.py --port 8765 --headless
reaktiv-workbook run analysis.workbook.py        # live views without authoring
reaktiv-workbook check analysis.workbook.py
reaktiv-workbook evaluate analysis.workbook.py --set quantity=5 --cell total
reaktiv-workbook export analysis.workbook.py ./exports
reaktiv-workbook edit analysis.workbook.py --sandbox   # isolated env with its packages
reaktiv-workbook edit analysis.workbook.py --mcp       # also let coding agents work on it
python -m reaktiv_workbook edit analysis.workbook.py
python analysis.workbook.py                  # evaluate; never start the UI
```

`new` never overwrites a file; it takes the same options as `edit`. A misspelled
`--from` name lists the bundled examples (`welcome`, `budget`, `education/motion`, …).
A blank new workbook is a small working model, and the editor opens the
Getting started guide for it. When a workbook declares packages this environment lacks
(most examples use plotly or pandas), the command names them. In a terminal with uv
installed it asks whether to run the workbook in a sandbox with them (Enter
accepts); otherwise it suggests installing them or `--sandbox`. Inside a sandbox it never
asks again.

`--headless` / `--no-browser` prints the link without opening it. Default port 0
selects an available port; a busy requested port fails rather than silently changing
it. Ctrl+C or SIGTERM closes the workbook and its HTTP server. Closing the browser
leaves the process running. Startup executes workbook code, including automatic
effects. Opening a workbook does not invoke exposed user actions.

Only loopback interfaces are supported (`127.0.0.1`, `localhost`, `::1`). Each
session has a random bearer token; the browser link carries it in the URL fragment.
The package does not start an execution subprocess.
The browser and Python host share the existing `WorkbookSession` graph, owner loop,
revision checks, progress streams, resources, timers, widgets, and action lifecycle.

`edit` creates missing workbooks exclusively, never replaces an existing file on
startup. `run` requires an existing workbook and does not save it. Its HTTP runtime
accepts literal input writes, linked-input resets, existing widget messages and
exposed actions; it refuses authoring, console evaluation and saves. The UI hides
authoring controls and cannot switch into Edit. This is a presentation/command
boundary, not a sandbox or source confidentiality feature: definitions are still
sent to the browser. Actions remain user-defined Python and can write files or
perform other operations themselves.

Workbook image assets are transferred once on attachment, hash checked, and saved
beside the workbook before its source is saved. Transfer is bounded to 20 MiB of
images; assets stay separate from Python source. Polling does not resend images.
Output snapshots retain the existing `.snapshot.json` companion convention.

Without `--sandbox`, cells run in the environment that started the CLI: install
workbook-specific packages there (`pip install reaktiv-workbook plotly pandas`).
Nothing is installed from a workbook file unless you ask for it.

### Agents: `--mcp`

`reaktiv-workbook edit FILE --mcp` also serves an MCP endpoint for coding agents
(Claude Code, OpenCode, …) and shares the open workbook with it as soon as the
editor loads. The terminal prints the URL (`http://127.0.0.1:8766/mcp`, port with
`--mcp-port`) and, the first time, the `Authorization: Bearer …` header to configure in
the agent. **Configure the agent once:** the token is saved in your configuration folder
(`~/.config/reaktiv-workbook/mcp-token` on Linux, `~/Library/Application Support/…` on
macOS, `%APPDATA%\reaktiv-workbook\` on Windows; `REAKTIV_WORKBOOK_MCP_TOKEN` overrides
it) and reused, and every workbook opened with `--mcp` shares the same endpoint: the
first editor serves it, later ones join, and if the serving editor quits another takes
over on the same URL and token. Agents pick a workbook with `list_workbooks`. Delete
the token file to issue a new token. Only local editor pages may use the bridge from a
browser. Agents act through the open editor, so you see their changes live; a workbook
stops being shared when its command ends. The MCP
library is part of the normal install.

### Sandbox: one environment per workbook

With `--sandbox` (on `edit`, `run`, `check` and `export`), the command restarts through `uv run --isolated --no-project` with the
packages declared in the workbook's PEP 723 header (`dependencies`), so they are
installed into an environment of their own instead of the current one. uv caches
that environment; later starts with the same packages take about a second.

- **Requires uv.** `REAKTIV_UV` selects a specific executable.
- **Same workbook version.** Reaktiv Workbook and `reaktiv` are installed into the
  sandbox from where the running copies came from: an editable checkout, a local
  wheel, or the package index at the same version.
- **Python version.** An exact pin (`requires-python = "==3.12"`) is honoured; a
  range uses the launching interpreter's version, so it cannot pick a Python the
  workbook package does not support.
- **Declared packages only.** Imports that are not declared fail with
  `ModuleNotFoundError`, even when the launching environment has them. Entries
  that look like uv options (starting with `-`) are rejected.
- **Packages, not permissions.** The sandbox isolates installed packages, not
  file or network access. Only open workbooks you trust.
- Ctrl+C and SIGTERM stop the sandboxed server; the exit code is the command's
  (`check --sandbox` exits 1 on a cell error).

`evaluate` and the bare `reaktiv-workbook FILE …` form do not accept `--sandbox`;
use `check` or `export` instead.

The editor starts only after packages are installed, a failed
install ends the command instead of offering a retry in the editor, and packages
changed in the editor take effect after the next `--sandbox` start. The editor does
not offer to install missing imports.

The previous `reaktiv-workbook FILE --set ... --check` evaluator syntax is retained.
A file path never implicitly means “start a server”. The editor and app modes do
not change the workbook format.

## Build a public package

Python package version and metadata live in `pyproject.toml` (first release:
`0.1.0`). From this directory:

```bash
npm ci
npm run package:python
```

The release script builds the production frontend with tracked examples only,
copies it into generated `python/reaktiv_workbook/web/`, includes third-party license
notices, then builds a wheel and source distribution into `release/python/` using
`uv build --no-sources`. Distribution metadata declares the registry `reaktiv`
dependency; the local editable dependency is development-only. No build or install
step uploads anything.

The wheel includes the compiled browser app, lazy chunks, static file worker,
Python file-worker modules, examples, fonts, anywidget host, and vendored resources.
Installed users need neither Node nor this checkout. The sdist contains the same
prepared assets, so wheel rebuilding does not need npm. Build commands reject
missing frontend assets instead of producing a broken public wheel. Editable
source installs still work before building the UI and can use a local app preview.
Generated assets, egg metadata and distributions are gitignored.

Validate the installed artifact in a clean environment, outside this checkout:

```bash
uv venv /tmp/reaktiv-workbook-release
uv pip install --no-config --python /tmp/reaktiv-workbook-release/bin/python release/python/*.whl
/tmp/reaktiv-workbook-release/bin/python scripts/test-python-package.py
uvx twine check release/python/*
```

The smoke script verifies registry dependencies, packaged IDE discovery, serving,
input/calculation updates, editor Save, refused run-mode Save, and Ctrl+C shutdown.
Also rebuild a wheel from the sdist in an isolated temporary directory to verify
its completeness. Review included examples, metadata, licenses, and version before
uploading. Existing release filenames should not be reused for different contents.

## Companion core release requirement

The workbook requires `reaktiv>=0.25.0` (on PyPI), which provides the public model and
lifecycle APIs and the `reaktiv.subtle` framework primitives. Actions live in `reaktiv_workbook`; they are not
part of the core package.

The release builder produces only the workbook wheel and source distribution.
Build and publish the core separately before the workbook, then repeat clean
installation against the registry. To test against an unreleased core, bootstrap
with a core wheel built in its own repository:
`python3 scripts/bootstrap-python.py --core-wheel /path/to/reaktiv-<version>-py3-none-any.whl`.

After review, publication is an explicit separate operation:

```bash
uvx twine upload --repository testpypi release/python/*   # optional staging
uvx twine upload release/python/*                       # public PyPI
```

Credentials belong in the release environment, never in the repository. Verify
ownership/availability of the `reaktiv-workbook` project name before the first upload.
