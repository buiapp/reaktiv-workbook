// Build assets come from the installed core distribution, never a parent checkout.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

export function pythonExecutable(root) {
  const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return process.env.REAKTIV_WORKBOOK_PYTHON || (existsSync(local) ? local : 'python3');
}

export function corePackageRoot(root) {
  // Container builds may copy an installed wheel's package from another stage.
  const supplied = process.env.REAKTIV_WORKBOOK_CORE_PATH;
  if (supplied) {
    const resolved = path.resolve(root, supplied);
    if (!existsSync(path.join(resolved, '__init__.py'))) throw new Error('REAKTIV_WORKBOOK_CORE_PATH must contain an installed reaktiv package');
    return resolved;
  }
  try {
    return execFileSync(pythonExecutable(root), ['-c',
      'from pathlib import Path; import reaktiv; from reaktiv.subtle import Watcher, current_consumer, signal_version; print(Path(reaktiv.__file__).resolve().parent)'],
      {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  } catch (error) {
    throw new Error('Install the Python dependencies first (python3 scripts/bootstrap-python.py). The build requires the separate reaktiv>=0.25.0 distribution.', {cause: error});
  }
}
