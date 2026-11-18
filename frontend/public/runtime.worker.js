import { loadPyodide } from './vendor/pyodide.mjs';

const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';

let pyodide = null;
let initialization = null;

// Read only the allocated Wasm heap, without invoking Python or joining its request queue.
// Worker CPU and resident RAM are not exposed by browsers.
setInterval(() => {
  const bytes = pyodide?._module?.HEAPU8?.byteLength;
  if (Number.isFinite(bytes)) respond({ type: 'usage', usage: { cpuPercent: null, memoryBytes: bytes, memoryKind: 'wasm' } });
}, 2000);

self.addEventListener('error', (event) => {
  console.error('Python worker unhandled error:', event);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Python worker unhandled rejection:', event.reason);
});

// Structural requests stay ordered. Explicit async actions share the Python owner
// loop without holding this queue; literal inputs run on that owner independently.
// Never interleave a full Apply with an action or another structural request.
let queue = Promise.resolve();
const activeActions = new Set();
self.addEventListener('message', ({ data }) => {
  // Admission only: enqueue literals, never evaluate cells or snapshots here.
  // The existing action task drains this mailbox on its owner-loop timer.
  if (data.type === 'action-inputs') {
    const enqueue = pyodide?.globals.get('queue_action_inputs');
    if (!enqueue) { respond({id:data.id,type:'result',result:{accepted:false}}); return; }
    try { respond({id:data.id,type:'result',result:JSON.parse(String(enqueue(data.runId ?? '', JSON.stringify(data.sources ?? {}))))}); }
    catch (error) { respond({id:data.id,type:'error',message:String(error)}); }
    finally { enqueue.destroy(); }
    return;
  }
  if (data.type === 'cancel-action' || data.type === 'cancel-resource') {
    const cancel = pyodide?.globals.get(data.type === 'cancel-resource' ? 'cancel_resource' : 'cancel_action');
    if (!cancel) { respond({id:data.id, type:'result', result:{cancelled:false}}); return; }
    try { respond({id:data.id, type:'result', result:JSON.parse(String(cancel(data.type === 'cancel-resource' ? data.cellId : data.actionName, ...(data.type === 'cancel-action' ? [data.runId ?? ''] : []))))}); }
    catch (error) { respond({id:data.id, type:'error', message:String(error)}); }
    finally { cancel.destroy(); }
    return;
  }
  const received=performance.now();
  if (data.type === 'set-inputs') {
    // This coroutine only changes literal values on the Python owner loop.
    void (activeActions.size ? Promise.resolve() : queue).then(() => handleRequest(data, received));
  } else if (data.type === 'run-action') {
    queue = queue.then(() => {
      const pending = handleRequest(data, received);
      activeActions.add(pending);
      pending.finally(() => activeActions.delete(pending));
    });
  } else {
    queue = queue.then(async () => {
      await Promise.allSettled([...activeActions]);
      await handleRequest(data, received);
    });
  }
});

async function handleRequest(request, received) {
  const started=performance.now();
  const reply=response=>respond({...response,...(request.diagnostics ? {timings:{queueMs:started-received,executionMs:performance.now()-started}} : {})});
  try {
    if (request.type === 'initialize') {
      await initializeRuntime(request.packages ?? []);
      reply({ id: request.id, type: 'result' });
      return;
    }

    await initializeRuntime(request.packages ?? []);
    if (pyodide === null) {
      throw new Error('Pyodide did not initialize.');
    }

    const configureOutputs = pyodide.globals.get('set_output_cache');
    try { configureOutputs(JSON.stringify(request.knownOutputs ?? null)); } finally { configureOutputs.destroy(); }

    if (request.type === 'console' || request.type === 'cell-memory') {
      const call = pyodide.globals.get(request.type === 'console' ? 'run_console' : 'cell_memory');
      try {
        const serialized = request.type === 'console' ? call(request.source ?? '', request.sheet ?? '') : call();
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally { call?.destroy?.(); }
      return;
    }

    if (request.type === 'apply') {
      pyodide.globals.set('_sheet_request', JSON.stringify(request.cells ?? []));
      pyodide.globals.set('_sheet_variables', JSON.stringify(request.variables ?? {}));
      pyodide.globals.set('_sheet_imports', JSON.stringify(request.imports ?? []));
      pyodide.globals.set('_sheet_sheets', JSON.stringify(request.sheets ?? null));
      pyodide.globals.set('_sheet_code', typeof request.code === 'string' ? request.code : null);
      pyodide.globals.set('_sheet_stopped', JSON.stringify(request.stopped ?? null));
      pyodide.globals.set('_sheet_allow_writes', request.allowCellWrites !== false);
      pyodide.globals.set('_sheet_trace', request.enableUpdateTracing === true);
      pyodide.globals.set('_sheet_actions', JSON.stringify(request.actions ?? []));
      try {
        const serialized = await pyodide.runPythonAsync(
          'await apply_model_async(_sheet_request, _sheet_variables, _sheet_imports, _sheet_sheets, _sheet_code, _sheet_stopped, _sheet_allow_writes, _sheet_actions, _sheet_trace)',
        );
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        pyodide.globals.delete('_sheet_request');
        pyodide.globals.delete('_sheet_variables');
        pyodide.globals.delete('_sheet_imports');
        pyodide.globals.delete('_sheet_sheets');
        pyodide.globals.delete('_sheet_code');
        pyodide.globals.delete('_sheet_stopped');
        pyodide.globals.delete('_sheet_allow_writes');
        pyodide.globals.delete('_sheet_actions');
        pyodide.globals.delete('_sheet_trace');
      }
      return;
    }

    if (request.type === 'update-action') {
      pyodide.globals.set('_action_definition', JSON.stringify(request.definition));
      pyodide.globals.set('_action_revision', request.expectedRevision);
      try {
        const serialized = await pyodide.runPythonAsync('await update_action(_action_definition, _action_revision)');
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        pyodide.globals.delete('_action_definition');
        pyodide.globals.delete('_action_revision');
      }
      return;
    }

    if (request.type === 'inspect-document') {
      pyodide.globals.set('_sheet_source', request.source ?? '');
      try {
        const serialized = pyodide.runPython('inspect_document(_sheet_source)');
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        pyodide.globals.delete('_sheet_source');
      }
      return;
    }

    // Before saving: does the file the app wrote load back as the same workbook?
    if (request.type === 'verify-document') {
      pyodide.globals.set('_sheet_source', request.source ?? '');
      pyodide.globals.set('_sheet_document', JSON.stringify(request.document ?? {}));
      try {
        const serialized = pyodide.runPython('verify_document(_sheet_source, _sheet_document)');
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        pyodide.globals.delete('_sheet_source');
        pyodide.globals.delete('_sheet_document');
      }
      return;
    }

    if (request.type === 'resample') {
      const resample = pyodide.globals.get('resample_view');
      try {
        const serialized = resample(request.token ?? '', JSON.stringify(request.ranges ?? {}));
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        resample?.destroy?.();
      }
      return;
    }

    if (request.type === 'move-workbook') {
      pyodide.globals.set('_move_command', JSON.stringify({expectedRevision:request.expectedRevision,
        sourceId:request.sourceId,targetId:request.targetId,sourceIds:request.sourceIds}));
      try {
        const serialized = await pyodide.runPythonAsync('await move_workbook_command(_move_command)');
        reply({id:request.id,type:'result',result:JSON.parse(String(serialized))});
      } finally { pyodide.globals.delete('_move_command'); }
      return;
    }

    if (request.type === 'tick-timer') {
      pyodide.globals.set('_sheet_timer_cell', request.cellId ?? '');
      try {
        const serialized = await pyodide.runPythonAsync('await tick_timer(_sheet_timer_cell)');
        reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
      } finally {
        pyodide.globals.delete('_sheet_timer_cell');
      }
      return;
    }

    if (request.type === 'run-action' || request.type === 'set-inputs') {
      const call = pyodide.globals.get(request.type === 'run-action' ? 'run_action' : 'set_inputs');
      try {
        const pending = request.type === 'run-action'
          ? call(request.actionName, JSON.stringify(request.arguments ?? {}), request.runId ?? '')
          : call(JSON.stringify(request.sources ?? {}));
        try {
          const serialized = await pending;
          reply({id:request.id,type:'result',result:JSON.parse(String(serialized))});
        } finally { pending?.destroy?.(); }
      } finally { call.destroy(); }
      return;
    }

    const functionName =
      request.type === 'widget-update'
        ? 'update_widget'
        : request.type === 'widget-message'
        ? 'widget_message'
        : request.type === 'run-effect'
        ? 'run_effect'
        : request.type === 'move-cells'
          ? request.sourceIds?.length
            ? 'move_model_group'
            : 'move_model'
          : 'clear_logs';
    const pythonFunction = pyodide.globals.get(functionName);
    try {
      let serialized;
      if (request.type === 'widget-update') {
        serialized = pythonFunction(request.cellId, JSON.stringify(request.state ?? {}), request.modelId ?? null);
      } else if (request.type === 'widget-message') {
        serialized = pythonFunction(
          request.cellId,
          JSON.stringify({ content: request.content ?? null, buffers: request.buffers ?? [], modelId: request.modelId ?? null }),
        );
      } else if (request.type === 'run-effect') {
        serialized = pythonFunction(request.cellId);
      } else if (request.type === 'move-cells') {
        serialized = request.sourceIds?.length
          ? pythonFunction(
              JSON.stringify(request.cells ?? []),
              JSON.stringify(request.sourceIds),
              request.sourceId,
              request.targetId,
              JSON.stringify(request.sheets ?? null),
            )
          : pythonFunction(
              JSON.stringify(request.cells ?? []),
              request.sourceId,
              request.targetId,
              JSON.stringify(request.sheets ?? null),
            );
      } else if (request.type === 'clear-logs') {
        serialized = pythonFunction();
      }
      reply({ id: request.id, type: 'result', result: JSON.parse(String(serialized)) });
    } finally {
      pythonFunction?.destroy?.();
    }
  } catch (error) {
    reply({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function initializeRuntime(packages) {
  if (initialization !== null) {
    return initialization;
  }

  initialization = (async () => {
    try {
      status('Downloading Pyodide');
      pyodide = await loadPyodide({
        indexURL: PYODIDE_INDEX_URL,
        convertNullToNone: true,
      });

      status('Loading NumPy');
      await pyodide.loadPackage('numpy');

      if (packages.length > 0) {
        status(`Installing ${packages.length} document package${packages.length === 1 ? '' : 's'}`);
        await pyodide.loadPackage('micropip');
        await pyodide.runPythonAsync(
          `import micropip\nawait micropip.install(${JSON.stringify(packages)})`,
        );
      }

      status('Loading local Python sources');
      await loadPythonPackage('reaktiv');
      await loadPythonPackage('reaktiv_workbook');

      status('Starting reactive spreadsheet engine');
      const engineResponse = await fetch('python/reaktiv_workbook_runtime.py', { cache: 'no-store' });
      if (!engineResponse.ok) {
        throw new Error('Could not load the spreadsheet runtime.');
      }
      const engine = await engineResponse.text();
      pyodide.runPython(
        "import sys\nif '/home/pyodide' not in sys.path:\n    sys.path.insert(0, '/home/pyodide')",
      );
      await pyodide.runPythonAsync(engine);
      // Each cell's start and end reaches the app while Python is still running.
      pyodide.globals.get('set_progress_reporter')((event, cellId) =>
        respond({ type: 'progress', event, cellId }),
      );
      pyodide.globals.get('set_log_reporter')((entry) =>
        respond({ type: 'log', log: JSON.parse(entry) }),
      );
      pyodide.globals.get('set_snapshot_reporter')((snapshot) =>
        respond({ type: 'snapshot', snapshot: JSON.parse(snapshot) }),
      );
      status('Python and reaktiv ready');
    } catch (error) {
      initialization = null;
      throw error;
    }
  })();

  return initialization;
}

// Sources have stable URLs. Bypass even previously fresh HTTP cache entries so an
// updated manifest cannot be combined with modules from an older deployment.
async function loadPythonPackage(packageName) {
  const manifestResponse = await fetch(`python/${packageName}/manifest.json`, { cache: 'no-store' });
  if (!manifestResponse.ok) {
    throw new Error(`Could not load the generated ${packageName} module manifest.`);
  }
  const manifest = await manifestResponse.json();
  pyodide.runPython(`import os; os.makedirs('/home/pyodide/${packageName}', exist_ok=True)`);

  await Promise.all(
    manifest.files.map(async (file) => {
      const response = await fetch(`python/${packageName}/${file}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not load ${packageName} module ${file}.`);
      }
      pyodide.FS.writeFile(`/home/pyodide/${packageName}/${file}`, await response.text(), {
        encoding: 'utf8',
      });
    }),
  );
}

function status(message) {
  respond({ type: 'status', message });
}

function respond(response) {
  self.postMessage(response);
}
