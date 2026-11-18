// Run the actual static-file worker with real Pyodide and local runtime assets.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPyodide } from 'pyodide';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(app, 'frontend/public');
const source = (await readFile(path.join(publicRoot, 'workbook-source.worker.js'), 'utf8')).replace(
  "import { loadPyodide } from './vendor/pyodide.mjs';",
  '',
);
let receive;
let python;
const replies = new Map();
vm.runInNewContext(source, {
  // The save bridge must not encode full workbook/source payloads as JSON.
  JSON: {
    parse() { throw new Error('Unexpected JSON parsing in the save bridge'); },
    stringify() { throw new Error('Unexpected JSON encoding in the save bridge'); },
  },
  loadPyodide: async (options) => {
    assert.equal(new URL(options.indexURL).hostname, 'file-worker.local');
    python = await loadPyodide({
      ...options,
      indexURL: path.join(publicRoot, 'vendor/file-python/'),
    });
    return python;
  },
  fetch: async (url) => new Response(await readFile(path.join(publicRoot, url))),
  self: {
    location: { href: 'http://file-worker.local/workbook-source.worker.js' },
    addEventListener: (_event, callback) => {
      receive = callback;
    },
    postMessage: (result) => {
      replies.get(result.id)(result);
    },
  },
  URL,
});
const cases = JSON.parse(
  await readFile(path.join(app, 'tests/fixtures/workbooks/cases.json'), 'utf8'),
).cases;
const fixture = cases.find((item) => item.name === 'action-duplicate-labels');
assert.ok(fixture);
const document = {
  format: 'reaktiv-workbook',
  version: 4,
  name: fixture.name,
  grid: { columns: 10, rows: 16 },
  environment: {
    packages: ['missing_user_package'],
    imports: ['import missing_user_package'],
    code: "raise RuntimeError('must not run')",
  },
  cells: fixture.cells,
  sheets: fixture.sheets,
  actions: fixture.actions,
};
const request = (id, document) =>
  new Promise((resolve) => {
    replies.set(id, resolve);
    receive({ data: { id, document } });
  });
const valid = await request(1, document);
assert.equal(valid.error, undefined);
assert.equal(valid.result.problems.length, 0);
assert.ok(valid.result.source.includes('self.PLC.pulse_signal()'));
assert.equal(
  python.runPython(
    "import sys; bool({'numpy', 'reaktiv', 'missing_user_package'} & sys.modules.keys())",
  ),
  false,
);
const invalid = await request(2, {
  ...document,
  cells: [{ id: 'A1', kind: 'formula', source: 'if True:' }],
});
assert.ok(invalid.result.problems.length > 0);
const invalidAction = await request(8, {
  ...document,
  actions: [{name:'capture', source:'def capture(self):\n    await missing()'}],
});
assert.equal(invalidAction.error, undefined);
assert.ok(invalidAction.result.problems.join('\n').includes('Action capture, line 2'));
assert.equal(invalidAction.result.source, '');
const retry = await request(3, document);
assert.equal(retry.result.problems.length, 0);
const advancedLinked = await request(4, {
  ...document,
  cells: [
    { id: 'A1', kind: 'input', source: '[1, 2, 3]' },
    { id: 'B1', kind: 'linked', source: 'A1', computation: 'previous.value if previous is not None and previous.value in source else source[0]' },
  ],
  actions: [],
});
assert.equal(advancedLinked.error, undefined);
assert.equal(advancedLinked.result.problems.length, 0);
assert.ok(advancedLinked.result.source.includes('@linked(computation='));
const optionalFields = await request(6, {
  ...document, actions:undefined, sheets:undefined,
  environment:{packages:[],imports:undefined,code:undefined},
  cells:[{id:'A1',kind:'input',source:'1',name:undefined,view:undefined,annotation:undefined}],
});
assert.equal(optionalFields.error, undefined);
assert.deepEqual(Array.from(optionalFields.result.problems), []);
const sourceOnly = await request(7, {...document, saveOutputs:false});
assert.equal(sourceOnly.error, undefined);
assert.equal(sourceOnly.result.problems.length, 0);
python.globals.set('_saved_source',sourceOnly.result.source);
assert.equal(python.runPython("from reaktiv_workbook_files.model import SheetDocument\nSheetDocument.loads(_saved_source).save_outputs"),false);
python.globals.delete('_saved_source');
const large = await request(5, {
  ...document, actions: [], sheets: [],
  cells: [{id:'A1',kind:'input',source:'['+'255,'.repeat(100000)+'255]'}],
});
assert.equal(large.error, undefined);
assert.equal(large.result.problems.length, 0);
assert.ok(large.result.source.length > 400000);
assert.ok(large.memory.wasmHeapBytes > 0);
console.log(
  'Real Pyodide file-worker generation, validation, direct object transport, large literals, queue reuse, and dependency isolation passed.',
);
const sessionInputs = await request(8, {
  ...document, actions:[], sheets:[],
  cells: [
    {id:'A1',kind:'input',source:'[]',saveValue:false},
    {id:'A2',kind:'input',source:'list(range(3))',saveValue:false},
  ],
});
assert.equal(sessionInputs.error, undefined);
assert.equal(sessionInputs.result.problems.length, 0);
assert.equal((sessionInputs.result.source.match(/save_value=False/g) ?? []).length, 2);
console.log('PASS session-only input metadata in real static Python file worker');
