import { loadPyodide } from './vendor/pyodide.mjs';

// Separate from the execution worker: saving never waits for a running cell,
// installs workbook packages, or needs a healthy local/remote kernel.
let initialization = null;
function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    const python = await loadPyodide({
      indexURL: new URL('vendor/file-python/', self.location.href).href,
      convertNullToNone: true,
    });
    const root = '/home/pyodide/reaktiv_workbook_files';
    python.FS.mkdirTree(root);
    const response = await fetch('python/reaktiv_workbook_files/manifest.json', {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not load the Python file serializer manifest.');
    const { files } = await response.json();
    await Promise.all(
      files.map(async (file) => {
        const module = await fetch(`python/reaktiv_workbook_files/${file}`, { cache: 'no-store' });
        if (!module.ok)
          throw new Error(`Could not load the Python file serializer module ${file}.`);
        python.FS.writeFile(`${root}/${file}`, await module.text(), { encoding: 'utf8' });
      }),
    );
    python.runPython('from reaktiv_workbook_files.file_api import serialize_document');
    return python;
  })().catch((error) => {
    initialization = null;
    throw error;
  });
  return initialization;
}

// Match the optional-field behavior of the previous JSON bridge without copying
// source strings into a JSON representation. Document data contains plain objects.
function pythonData(value) {
  if (Array.isArray(value))
    return value.map((item) => (item === undefined ? null : pythonData(item)));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, pythonData(item)]),
    );
  }
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

let queue = Promise.resolve();
self.addEventListener('message', ({ data }) => {
  queue = queue.then(async () => {
    try {
      const python = await initialize();
      const serialize = python.globals.get('serialize_document');
      let input;
      let output;
      try {
        // Convert the structured-cloned document directly. JSON strings here used
        // to duplicate large input sources and the generated Python file.
        input = python.toPy(pythonData({ ...data.document, snapshot: undefined }));
        output = serialize(input);
        const result = output.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
        self.postMessage({
          id: data.id,
          result,
          memory: { wasmHeapBytes: python._module?.HEAPU8?.byteLength ?? null },
        });
      } finally {
        output?.destroy();
        input?.destroy();
        serialize.destroy();
      }
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error) });
    }
  });
});
