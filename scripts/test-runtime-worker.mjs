// Exercise the actual execution worker, including its generated module manifest.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadPyodide } from 'pyodide';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(app, 'frontend/public');
const cache = path.join(os.tmpdir(), 'reaktiv-workbook-pyodide-packages');
await mkdir(cache, { recursive: true });
const source = (await readFile(path.join(publicRoot, 'runtime.worker.js'), 'utf8')).replace(
  "import { loadPyodide } from './vendor/pyodide.mjs';",
  '',
);
const messages = [];
const pending = new Map();
let receive;
let nextId = 0;
vm.runInNewContext(source, {
  loadPyodide: (options) =>
    loadPyodide({
      ...options,
      indexURL: path.join(publicRoot, 'vendor/file-python/'),
      packageBaseUrl: options.indexURL,
      packageCacheDir: cache,
    }),
  fetch: async (url) => new Response(await readFile(path.join(publicRoot, url))),
  performance,
  console,
  setTimeout,
  // The passive usage heartbeat is unrelated to request/evaluation verification.
  setInterval: () => 0,
  self: {
    addEventListener: (event, callback) => {
      if (event === 'message') receive = callback;
    },
    postMessage: (response) => {
      messages.push(response);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      clearTimeout(request.timeout);
      if (response.type === 'error') request.reject(new Error(response.message));
      else request.resolve(response.result);
    },
  },
});

function request(type, payload = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker request ${type} timed out`)), 60000);
    pending.set(id, { resolve, reject, timeout });
    receive({ data: { id, type, ...payload } });
  });
}

const cell = (id, kind, source, extra = {}) => ({
  id,
  kind,
  source,
  enabled: true,
  ...extra,
});
await request('initialize');
const initial = await request('apply', {
  cells: [
    cell('A1', 'input', '3', { name: 'amount' }),
    cell('B1', 'formula', 'np.arange(A1)'),
    cell('C1', 'resource', 'await asyncio.sleep(0.01)\nA1 * 10'),
    cell('D1', 'markdown', 'Amount: {{ A1 }}; loaded: {{ C1 }}'),
    cell('E1', 'linked', 'A1'),
  ],
  actions: [
    {
      name: 'increase',
      label: 'Increase',
      exposed: true,
      bindings: {},
      references: { amount: 'A1' },
      source:
        "async def increase(self):\n    print('starting')\n    for amount in (4, 5):\n        self.amount.set(amount)\n        assert len(self.cells.Sheet1.B1()) == amount\n        assert self.cells.Sheet1.E1() == amount\n        await asyncio.sleep(0.05)\n        assert self.cells.Sheet1.C1() == amount * 10",
    },
  ],
});
const value = (graph, id) => graph.cells.find((cell) => cell.id === id)?.value;
assert.deepEqual(Array.from(value(initial, 'B1')), [0, 1, 2]);
assert.equal(value(initial, 'C1'), 30);
assert.equal(value(initial, 'E1'), 3);
const actionStart = messages.length;
const updated = await request('run-action', { actionName: 'increase', arguments: {} });
assert.equal(updated.actions.find(action => action.name === 'increase').error, null, 'intermediate formula/resource reads must update during the action');
assert.equal(value(updated, 'A1'), 5);
assert.equal(value(updated, 'C1'), 50);
assert.equal(value(updated, 'E1'), 5);
assert.equal(value(updated, 'B1').length, 5);
assert.equal(updated.cells.find((cell) => cell.id === 'D1').display, 'Amount: 5; loaded: 50');
const actionMessages = messages.slice(actionStart);
const log = actionMessages.findIndex(
  (message) => message.type === 'log' && message.log?.message === 'starting',
);
const result = actionMessages.findIndex((message) => message.type === 'result');
assert.ok(log >= 0 && log < result, 'action print output must precede its result');
const frame = actionMessages.findIndex(message => message.type === 'snapshot');
assert.ok(frame >= 0 && frame < result, 'computed values must reach the UI before the action finishes');
assert.equal(value(actionMessages[frame].snapshot, 'A1'), 4);
assert.equal(value(actionMessages[frame].snapshot, 'B1').length, 4);
assert.notEqual(actionMessages[frame].snapshot.workbookRevision, updated.workbookRevision);
assert.equal(updated.cellChanges.find(cell => cell.id === 'A1').source, '5', 'frames must preserve final committed writes');
assert.equal(updated.updateTrace, undefined, 'tracing is off by default');
// A refused edit keeps the live revision/method usable for an explicit correction.
await assert.rejects(request('update-action', {
  expectedRevision: updated.workbookRevision,
  definition: {name:'increase', source:'def increase(self):\n    await missing()'},
}), /Action increase, line 2/);
const edited = await request('update-action', {
  expectedRevision: updated.workbookRevision,
  definition: {
    name: 'increase',
    source: 'def increase(self):\n    self.amount.set(7)',
    label: 'Increase',
    references: { amount: 'A1' },
    bindings: {},
    exposed: true,
  },
});
assert.equal(value(edited, 'A1'), 5, 'Apply must never invoke the action');
assert.ok(edited.appliedAction.source.includes('set(7)'));
const rerun = await request('run-action', { actionName: 'increase', arguments: {} });
assert.equal(value(rerun, 'A1'), 7);

// Rejected placement must preserve the live revision so a corrected move can use it.
const placement = await request('apply', { cells: [
  cell('A1', 'input', '1', { view: { span: [3, 3] } }),
  cell('E1', 'input', '2'),
] });
await assert.rejects(request('move-workbook', {
  expectedRevision: placement.workbookRevision, sourceId: 'E1', targetId: 'B2', sourceIds: ['E1'],
}), /overlap/);
const relocated = await request('move-workbook', {
  expectedRevision: placement.workbookRevision, sourceId: 'E1', targetId: 'D4', sourceIds: ['E1'],
});
assert.equal(value(relocated.graph, 'D4'), 2);
assert.equal(value(relocated.graph, 'A1'), 1);

const traced = await request('apply', {
  enableUpdateTracing: true,
  cells: [{ id: 'A1', kind: 'input', source: '1', enabled: true }],
});
assert.ok(traced.updateTrace.cells.A1);
const untraced = await request('apply', {
  enableUpdateTracing: false,
  cells: [{ id: 'A1', kind: 'input', source: '2', enabled: true }],
});
assert.equal(untraced.updateTrace, undefined);

console.log(
  'Real Pyodide execution worker: module loading, NumPy, resources, linked inputs, notes, actions, direct action editing, live output and tracing flags passed.',
);

// This control must bypass the busy execution queue, preserving the same worker.
const progressStart = messages.length;
const loading = request('apply', {cells: [
  cell('A1', 'resource', 'await asyncio.sleep(100)\nreturn 99'),
  cell('B1', 'input', '42'),
]});
for (let attempts=0; attempts<200 && !messages.slice(progressStart).some(row=>row.type==='progress' && row.event==='start' && row.cellId==='A1'); attempts++) {
  await new Promise(resolve=>setTimeout(resolve,10));
}
assert(messages.slice(progressStart).some(row=>row.type==='progress' && row.event==='start' && row.cellId==='A1'), 'resource never started');
assert.equal((await request('cancel-resource', {cellId:'A1'})).cancelled, true);
const cancelledResource = await loading;
assert.equal(cancelledResource.cells.find(row=>row.id==='A1').resourceStatus, 'cancelled');
assert.equal(cancelledResource.cells.find(row=>row.id==='B1').value, 42);
assert.equal((await request('console', {source:'6 * 7',sheet:''})).display, '42');
assert.equal((await request('cancel-resource', {cellId:'A1'})).cancelled, false);
console.log('PASS resource cancellation bypasses the worker queue and keeps Python usable');

// Synchronous batches inside async actions must preserve live reads and keep
// legitimate repeated notifications separate from effect feedback loops.
await request('apply', {
  cells: [
    cell('A1', 'input', '[]', {name:'samples', saveValue:false}),
    cell('B1', 'formula', 'sum(samples)', {name:'total'}),
    cell('C1', 'effect', "assert total == sum(samples)\nOBSERVED.append(total)"),
  ],
  imports:['from reaktiv import batch'],
  code:'OBSERVED = []',
  actions:[{name:'acquire', label:'Acquire', exposed:true, bindings:{},
    references:{samples:'A1', total:'B1'},
    source: 'async def acquire(self):\n    for n in range(1, 101):\n        with batch():\n            self.samples.set([n] * 1000)\n            self.samples.set([n] * 2000)\n            assert self.total() == n * 2000\n        await asyncio.sleep(0.001)\n    assert OBSERVED[-100:] == [n * 2000 for n in range(1, 101)]',
  }],
});
const acquired = await request('run-action', {actionName:'acquire', arguments:{}});
assert.equal(acquired.actions[0].error, null);
assert.equal(acquired.effects[0].error, null);
assert.equal(value(acquired, 'B1'), 200000);
assert.equal(acquired.cells.find(c=>c.id==='A1').runtimeOnlyInput, true);
assert.ok(!(acquired.cellChanges ?? []).some(c=>c.id==='A1'));
console.log('PASS batched acquisition, repeated effects, current computed reads and session-only input source');

const cachedOutput = await request('apply', {
  knownOutputs: [],
  cells:[cell('A1','formula','html("<p>cached</p>")'),cell('B1','input','1')],
});
const content = cachedOutput.cells.find(c=>c.id==='A1').richOutput;
assert.equal(typeof content.cacheKey,'string');assert.ok(content.dataBase64);
const compactOutput=await request('clear-logs',{knownOutputs:[content.cacheKey]});
assert.deepEqual(Object.keys(compactOutput.cells.find(c=>c.id==='A1').richOutput),['cacheKey']);
const fullOutput=await request('clear-logs',{knownOutputs:[]});
assert.equal(fullOutput.cells.find(c=>c.id==='A1').richOutput.dataBase64,content.dataBase64);
const legacyOutput=await request('clear-logs');
assert.equal(legacyOutput.cells.find(c=>c.id==='A1').richOutput.cacheKey,undefined);
assert.equal(legacyOutput.cells.find(c=>c.id==='A1').richOutput.dataBase64,content.dataBase64);
console.log('PASS opt-in rich-output references, cache misses and legacy full worker responses');

// A saved format-2 workbook must parse and execute through the actual browser host.
const structuredSource = await readFile(path.join(app, 'tests/fixtures/workbooks/action-duplicate-labels.app.sheet.py'), 'utf8');
const structured = await request('inspect-document', {source: structuredSource});
assert.ok(structuredSource.includes('@workbook_config('));
assert.equal(structured.sourceFormatVersion, 2);
const oldSource = await readFile(path.join(app, 'tests/fixtures/workbooks/legacy/action-duplicate-labels.app.sheet.py'), 'utf8');
assert.equal((await request('inspect-document', {source: oldSource})).sourceFormatVersion, 1);
assert.ok(structured.actions[0].source.includes('self.PLC.pulse_signal()'));
await request('apply', {
  cells: structured.cells, actions: structured.actions,
  sheets: [structured.sheetName ?? 'Sheet1', ...structured.sheets.map(sheet => sheet.name)],
  imports: structured.environment.imports, code: structured.environment.code,
  variables: structured.environment.variables,
});
const structuredRun = await request('run-action', {actionName: 'capture', arguments: {}});
assert.equal(structuredRun.actions.find(action => action.name === 'capture').error, null);
assert.equal(structuredRun.actions.find(action => action.name === 'capture').output.value, 2);
console.log('PASS format-2 file parsing, duplicate labels and workbook-owned actions in real Pyodide');

// Literal widget controls bypass the request queue without executing Python cells
// in the message callback. The active action's existing timer drains admission.
await request('apply', {cells:[cell('A1','input','False'),cell('B1','formula','100 if A1 else 1',{view:{color:{expr:"'#ffcccc' if A1 else None"}}})],actions:[{
  name:'live_measure',source:'async def live_measure(self):\n    await asyncio.sleep(10)',references:{},bindings:{},exposed:true,
}]});
const liveStart=messages.length;
let liveFinished=false;
const liveAction=request('run-action',{actionName:'live_measure',arguments:{},runId:'widget-run'}).then(result=>{liveFinished=true;return result;});
async function untilLive(predicate) {
  const deadline=Date.now()+5000;
  while (!predicate()) {assert.ok(Date.now()<deadline,'live widget worker condition timed out');await new Promise(resolve=>setTimeout(resolve,10));}
}
await untilLive(()=>messages.slice(liveStart).some(message=>message.type==='progress' && message.cellId==='action:live_measure'));
assert.equal((await request('action-inputs',{runId:'widget-run',sources:{A1:'True'}})).accepted,true);
await untilLive(()=>messages.slice(liveStart).some(message=>message.type==='snapshot' && value(message.snapshot,'B1')===100 && message.snapshot.cells.find(c=>c.id==='B1').color==='#ffcccc'));
assert.equal(liveFinished,false,'the calculation must update before the action finishes');
let ordinaryFinished=false;
const ordinary=request('cell-memory').then(result=>{ordinaryFinished=true;return result;});
await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(ordinaryFinished,false,'ordinary graph requests must remain serialized');
assert.equal((await request('action-inputs',{runId:'widget-run',sources:{A1:'False'}})).accepted,true);
await request('cancel-action',{actionName:'live_measure'});
const liveFinal=await liveAction;
assert.equal(value(liveFinal,'B1'),1,'the final drain must include accepted clicks on cancellation');
await ordinary;
assert.equal((await request('action-inputs',{runId:'widget-run',sources:{A1:'True'}})).accepted,false);
console.log('PASS live widget inputs during an action, final cancellation drain, stale run rejection and serialized graph requests');

// Different actions share live signals; each method refuses duplicate runs.
await request('apply',{cells:[cell('A1','input','0',{name:'count'}),cell('B1','formula','count * 2'),cell('A2','input','False'),cell('B2','formula',"'log' if A2 else 'linear'")],actions:[{
  name:'concurrent',source:'async def concurrent(self):\n    self.count.update(lambda previous: previous + 1)\n    await asyncio.sleep(10)',references:{count:'A1'},bindings:{},exposed:true,
},{name:'concurrent_other',source:'async def concurrent_other(self):\n    self.count.update(lambda previous: previous + 1)\n    await asyncio.sleep(10)',references:{count:'A1'},bindings:{},exposed:true}]});
const parallelStart=messages.length;
let oneDone=false,twoDone=false;
const one=request('run-action',{actionName:'concurrent',runId:'parallel-one'}).then(graph=>{oneDone=true;return graph;});
const two=request('run-action',{actionName:'concurrent_other',runId:'parallel-two'}).then(graph=>{twoDone=true;return graph;});
await untilLive(()=>messages.slice(parallelStart).some(message=>message.type==='snapshot' && value(message.snapshot,'A1')===2));
await assert.rejects(request('run-action',{actionName:'concurrent',runId:'duplicate'}), /already running/);
for(let index=0;index<20;index++) {
  const input=await request('set-inputs',{sources:{A2:index%2?'False':'True'}});
  assert.equal(value(input,'B2'),index%2?'linear':'log');
  assert.equal(value(input,'B1'),4);
}
assert.equal(oneDone,false);assert.equal(twoDone,false);
let structuralDone=false;
const structural=request('cell-memory').then(result=>{structuralDone=true;return result;});
const independent=await request('set-inputs',{sources:{A2:'True'}});
assert.equal(value(independent,'B2'),'log');assert.equal(structuralDone,false);
await request('cancel-action',{actionName:'concurrent',runId:'parallel-one'});
const cancelledOne=await one;
const receipts=cancelledOne.actions.flatMap(action=>action.runs);
assert.equal(receipts.find(run=>run.id==='parallel-one').status,'cancelled');
assert.equal(receipts.find(run=>run.id==='parallel-two').status,'running');
assert.equal(cancelledOne.actions.find(action=>action.name==='concurrent').running,false);
assert.equal(cancelledOne.actions.find(action=>action.name==='concurrent_other').running,true);
assert.equal(twoDone,false);assert.equal(structuralDone,false);
await request('cancel-action',{actionName:'concurrent_other',runId:'parallel-two'});
await two;await structural;
assert.equal(value(await request('set-inputs',{sources:{A2:'False'}}),'B2'),'linear');
console.log('PASS different concurrent actions, duplicate rejection, independent cancellation, live inputs and deferred structure in real Pyodide');

// Highlight expressions remain reactive without becoming value dependencies.
const colored = await request('apply', {cells:[cell('A1','input','20'), cell('B1','formula','42',{
  color:'#eeeeee',view:{color:{expr:"'#ffcccc' if A1 > 80 else '#ccffcc'"}},
})]});
assert.equal(colored.cells.find(c=>c.id==='B1').color,'#ccffcc');
assert.equal(JSON.stringify(colored.dependencies.B1),'[]');
const colorWrite=await request('set-inputs',{sources:{A1:'90'}});
assert.equal(colorWrite.cells.find(c=>c.id==='B1').color,'#ffcccc');
assert.equal(JSON.stringify(colorWrite.cells.find(c=>c.id==='B1').colorDependencies),'["A1"]');
console.log('PASS reactive cell colors and separate presentation dependencies');
