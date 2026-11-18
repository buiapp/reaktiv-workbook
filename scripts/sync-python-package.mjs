import { execFileSync } from 'node:child_process';
import { corePackageRoot } from './core-package.mjs';
import { cp, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = corePackageRoot(appRoot);
const outputRoot = path.resolve(appRoot, 'frontend/public/python/reaktiv');
const sheetSourceRoot = path.resolve(appRoot, 'python/reaktiv_workbook');
const sheetOutputRoot = path.resolve(appRoot, 'frontend/public/python/reaktiv_workbook');
const filePackageRoot = path.resolve(appRoot, 'frontend/public/python/reaktiv_workbook_files');
const vendorRoot = path.resolve(appRoot, 'frontend/public/vendor');
const exampleSourceRoot = path.resolve(appRoot, 'examples');
const exampleOutputRoot = path.resolve(appRoot, 'frontend/public/examples');

await rm(outputRoot, { recursive: true, force: true });
await rm(sheetOutputRoot, { recursive: true, force: true });
await rm(filePackageRoot, { recursive: true, force: true });
await rm(vendorRoot, { recursive: true, force: true });
await rm(exampleOutputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(sheetOutputRoot, { recursive: true });
await mkdir(exampleOutputRoot, { recursive: true });

const files = (await readdir(sourceRoot)).filter((file) => file.endsWith('.py')).sort();
const sheetFiles = (await readdir(sheetSourceRoot)).filter((file) => file.endsWith('.py')).sort();
// Subpackages (api/: the kernel's HTTP server) run only in CPython kernels, which use these
// copies too; the Pyodide manifest below lists top-level modules only.
const sheetSubpackageFiles = (await readdir(sheetSourceRoot, { recursive: true }))
  .filter(
    (file) => file.endsWith('.py') && file.includes(path.sep) && !file.includes('__pycache__')
      && !file.startsWith(`web${path.sep}`),
  )
  .sort();
// Examples, including subfolders (examples/education/… are multi-chapter courses).
let exampleFiles = (await readdir(exampleSourceRoot, { recursive: true }))
  .filter((file) => /\.(?:workbook|sheet)\.py$/.test(file))
  .sort();
// Private share builds exclude local, untracked workbook experiments. Normal builds
// still include all examples, so this opt-in does not change the development workflow.
if (process.env.REAKTIV_WORKBOOK_SHARE_BUILD === '1') {
  const trackedFiles = execFileSync('git', ['ls-files', '-z', '--', 'examples/'], {
    cwd: appRoot,
    encoding: 'utf8',
  });
  const tracked = new Set(
    trackedFiles
      .split('\0')
      .filter(Boolean)
      .map((file) => file.slice('examples/'.length)),
  );
  exampleFiles = exampleFiles.filter((file) => tracked.has(file.split(path.sep).join('/')));
}

await Promise.all(
  files.map((file) => copyFile(path.join(sourceRoot, file), path.join(outputRoot, file))),
);
await Promise.all(
  [...sheetFiles, ...sheetSubpackageFiles].map(async (file) => {
    await mkdir(path.dirname(path.join(sheetOutputRoot, file)), { recursive: true });
    await copyFile(path.join(sheetSourceRoot, file), path.join(sheetOutputRoot, file));
  }),
);
// MCP authoring guidance is read by the CPython MCP service only.
const mcpSkill = 'skills/workbook-authoring/SKILL.md';
await mkdir(path.dirname(path.join(sheetOutputRoot, mcpSkill)), { recursive: true });
await copyFile(path.join(sheetSourceRoot, mcpSkill), path.join(sheetOutputRoot, mcpSkill));
await Promise.all(
  exampleFiles.map(async (file) => {
    await mkdir(path.dirname(path.join(exampleOutputRoot, file)), { recursive: true });
    await copyFile(path.join(exampleSourceRoot, file), path.join(exampleOutputRoot, file));
  }),
);
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`);
await writeFile(
  path.join(sheetOutputRoot, 'manifest.json'),
  `${JSON.stringify({ files: sheetFiles }, null, 2)}\n`,
);
// Static file operations use the same Python sources without importing the runtime.
const fileModules = [
  'file_api.py',
  'model.py',
  'workbook_format.py',
  'source_layout.py',
  'source_analysis.py',
  'actions.py',
  'narrowing.py',
  'widget_config.py',
  'sheets.py',
  'save_diagnostics.py',
];
await mkdir(filePackageRoot, { recursive: true });
await writeFile(
  path.join(filePackageRoot, '__init__.py'),
  '"""Static workbook file operations."""\n',
);
await Promise.all(
  fileModules.map((file) =>
    copyFile(path.join(sheetSourceRoot, file), path.join(filePackageRoot, file)),
  ),
);
await writeFile(
  path.join(filePackageRoot, 'manifest.json'),
  JSON.stringify({ files: ['__init__.py', ...fileModules] }),
);
await mkdir(vendorRoot, { recursive: true });
await copyFile(
  path.resolve(appRoot, 'node_modules/pyodide/pyodide.mjs'),
  path.join(vendorRoot, 'pyodide.mjs'),
);
// File generation must work offline even before an execution kernel is started. These are the standard-library-only Pyodide runtime assets.
const filePythonRoot = path.join(vendorRoot, 'file-python');
await mkdir(filePythonRoot, { recursive: true });
await Promise.all(
  ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'].map((file) =>
    copyFile(path.join(appRoot, 'node_modules/pyodide', file), path.join(filePythonRoot, file)),
  ),
);

console.log(
  `Synced ${files.length} reaktiv modules, ${sheetFiles.length} sheet modules, ` +
    `${exampleFiles.length} examples, and the Pyodide loader.`,
);

