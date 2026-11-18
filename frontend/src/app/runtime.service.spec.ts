import { RuntimeService } from './runtime.service';
import type { CellDefinition, GraphResult, SheetDocument } from './sheet.types';

const emptyGraph: GraphResult = {
  cells: [],
  dependencies: {},
  effects: [],
  logs: [],
  changed: [],
  rebuilt: false,
  updateMode: 'incremental',
};

describe('RuntimeService remote kernel', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects a late result without changing the new kernel status', async () => {
    let complete!: (response: Response) => void;
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).endsWith('/v1/progress')) return new Response('{"seq":0,"events":[]}');
      if (String(input).endsWith('/v1/apply')) return new Promise<Response>(resolve => { complete = resolve; });
      return new Response('{"status":"ok"}');
    });
    const service = new RuntimeService();
    await service.configureKernel('remote', 'http://first', [], {});
    const pending = service.apply([]);
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await service.configureKernel('remote', 'http://second', [], {});
    complete(new Response(JSON.stringify(emptyGraph)));
    await expect(pending).rejects.toThrow('kernel changed');
    expect(service.status()).toBe('ready');
    expect(service.statusMessage()).toBe('Remote Python ready');
    expect(service.error()).toBeNull();
  });

  it('cancels a resource beside an apply already waiting on Python, without changing runtime status', async () => {
    let complete!: (response: Response) => void;
    const requests: {url:string; body:unknown}[]=[];
    globalThis.fetch=vi.fn(async (input,init)=>{
      const url=String(input); requests.push({url,body:init?.body?JSON.parse(String(init.body)):null});
      if(url.endsWith('/v1/progress')) return new Response('{"seq":0,"events":[]}');
      if(url.endsWith('/v1/apply')) return new Promise<Response>(resolve=>complete=resolve);
      if(url.endsWith('/v1/cancel-resource')) return new Response('{"cancelled":true}');
      return new Response('{"status":"ok"}');
    });
    const service=new RuntimeService(); await service.configureKernel('remote','http://kernel',[],{});
    const pending=service.apply([]); await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
    expect(service.status()).toBe('running');
    await expect(service.cancelResource('Budget!B3')).resolves.toBe(true);
    expect(service.status()).toBe('running'); expect(service.error()).toBeNull();
    expect(requests).toContainEqual({url:'http://kernel/v1/cancel-resource',body:{cellId:'Budget!B3'}});
    complete(new Response(JSON.stringify(emptyGraph))); await pending;
    expect(service.status()).toBe('ready');
  });

  it('interrupts console or action execution without inventing a stopped cell', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async input => {
      requests.push(String(input));
      return new Response(JSON.stringify({status: 'ok', interrupted: true}));
    }) as typeof fetch;
    const service = new RuntimeService();
    await service.configureKernel('remote', 'http://127.0.0.1:8765', [], {});
    await expect(service.stopRun(null)).resolves.toBe('interrupted');
    expect(requests.at(-1)).toBe('http://127.0.0.1:8765/v1/interrupt');
    expect(service.stoppedCells().size).toBe(0);
    await expect(service.stopRun(null, true)).resolves.toBe('unavailable');
  });

  it('checks health and sends workbook updates to the selected backend', async () => {
    const requests: string[] = [];
    const bodies: unknown[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/health')) {
        return new Response('{"status":"ok"}', { status: 200 });
      }
      if (url.endsWith('/v1/progress')) {
        return new Response('{"seq": 0, "events": []}', { status: 200 });
      }
      expect(init?.method).toBe('POST');
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(emptyGraph), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const service = new RuntimeService();
    const cells: CellDefinition[] = [
      { id: 'A1', kind: 'input', source: '2', enabled: true, trigger: 'auto' },
    ];

    await service.configureKernel('remote', 'http://127.0.0.1:8765/', [], { REGION: 'eu' });
    await expect(service.apply(cells, ['import pandas as pd'])).resolves.toEqual(emptyGraph);
    await service.restart([]);

    expect(requests).toEqual([
      'http://127.0.0.1:8765/health',
      // Where the cell progress log stands before the update.
      'http://127.0.0.1:8765/v1/progress',
      'http://127.0.0.1:8765/v1/apply',
      'http://127.0.0.1:8765/v1/restart',
    ]);
    expect(bodies).toEqual([
      { enableUpdateTracing:false, cells, variables: { REGION: 'eu' }, imports: ['import pandas as pd'], stopped: [], actions: [] },
      {},
    ]);
    expect(service.status()).toBe('ready');
  });

  it('sends only one action definition and revision, and keeps a refusing kernel available', async () => {
    const requests: {url:string;body:Record<string,unknown>}[]=[];
    const definition={name:'test',source:'def test(self):\n    return 42',label:'Test',references:{},bindings:{},exposed:true};
    let refuse=false;
    globalThis.fetch=vi.fn(async (url,init)=>{
      if (String(url).endsWith('/health')) return new Response('{"status":"ok"}');
      if (String(url).endsWith('/v1/progress')) return new Response('{"seq":0,"events":[]}');
      requests.push({url:String(url),body:JSON.parse(String(init?.body))});
      if (refuse) return new Response('{"error":"SyntaxError: invalid action"}',{status:400});
      return new Response(JSON.stringify({...emptyGraph,workbookRevision:'current',appliedAction:definition}));
    });
    const service=new RuntimeService();
    await service.configureKernel('remote','http://kernel',[],{});
    await service.apply([{id:'A1',kind:'input',source:'[123]'.repeat(100000),enabled:true,trigger:'auto'}]);
    await expect(service.updateAction(definition)).resolves.toMatchObject({appliedAction:definition});
    expect(requests.at(-1)).toEqual({url:'http://kernel/v1/update-action',body:{definition,expectedRevision:'current'}});
    refuse=true;
    await expect(service.updateAction(definition)).rejects.toThrow('SyntaxError');
    expect(service.status()).toBe('ready');expect(service.error()).toBeNull();
  });

  it('polls the cells a long update starts and finishes', async () => {
    let polls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response('{"status":"ok"}', { status: 200 });
      if (url.endsWith('/v1/progress')) {
        const after = JSON.parse(String(init?.body)).after;
        polls++;
        return new Response(
          JSON.stringify(
            after === undefined
              ? { seq: 4, events: [] }
              : { seq: 6, events: after < 6 ? [{ seq: 5, event: 'start', cellId: 'B2' }, { seq: 6, event: 'end', cellId: 'B2' }] : [] },
          ),
          { status: 200 },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 450));
      return new Response(JSON.stringify(emptyGraph), { status: 200 });
    }) as typeof fetch;
    const service = new RuntimeService();
    const seen: string[] = [];
    service.onProgress(({ event, cellId }) => seen.push(`${event} ${cellId}`));
    await service.configureKernel('remote', 'http://127.0.0.1:8765/', [], {});
    await service.apply([{ id: 'B2', kind: 'formula', source: '1', enabled: true, trigger: 'auto' }]);
    expect(seen).toEqual(['start B2', 'end B2']);
    expect(polls).toBeGreaterThan(1);
  });

  it('delivers action logs before the action response without replaying cursor entries', async () => {
    const entry = {id:'live-1',timestamp:'2026-10-28T10:00:00Z',cellId:'action:measure',level:'info',message:'started'};
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/progress')) {
        const after = JSON.parse(String(init?.body)).after;
        return new Response(JSON.stringify({seq:after === undefined ? 0 : 1, events:[], logs:after === 0 ? [entry] : []}));
      }
      if (url.endsWith('/v1/run-action')) {
        await held;
        return new Response(JSON.stringify({...emptyGraph,logs:[entry]}));
      }
      return new Response('{}');
    }) as typeof fetch;
    const service = new RuntimeService();
    await service.configureKernel('remote','http://127.0.0.1:8765',[]);
    const seen: unknown[] = [];
    const unsubscribe = service.onLog(entry => seen.push(entry));
    let completed = false;
    const running = service.runAction('measure',{}).then(result => {completed = true;return result;});
    try {
      await vi.waitFor(() => expect(seen).toEqual([entry]), {timeout:1500});
      expect(completed).toBe(false);
      await new Promise(resolve => setTimeout(resolve,250));
      expect(seen).toEqual([entry]);
    } finally {
      finish();
      await running;
      unsubscribe();
    }
  });

  it('admits widget writes beside a running action without changing runtime status', async () => {
    let finish!: () => void;
    const held = new Promise<void>(resolve => finish=resolve);
    const requests: {url:string; body:Record<string,unknown>}[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url=String(input), body=JSON.parse(String(init?.body ?? '{}'));
      requests.push({url,body});
      if (url.endsWith('/v1/progress')) return new Response('{"seq":0,"events":[]}');
      if (url.endsWith('/v1/run-action')) {await held; return new Response(JSON.stringify(emptyGraph));}
      if (url.endsWith('/v1/action-inputs')) return new Response('{"accepted":true}');
      return new Response('{"status":"ok"}');
    });
    const service = new RuntimeService(); await service.configureKernel('remote','http://kernel',[],{});
    const pending = service.runAction('measure',{});
    await vi.waitFor(() => expect(requests.some(request => request.url.endsWith('/v1/run-action'))).toBe(true));
    await expect(service.queueActionInputs({A1:'True'})).resolves.toBe(true);
    expect(service.status()).toBe('running');
    const run=requests.find(request => request.url.endsWith('/v1/run-action'))!;
    expect(requests).toContainEqual({url:'http://kernel/v1/action-inputs',body:{runId:run.body['runId'],sources:{A1:'True'}}});
    finish(); await pending;
    await expect(service.queueActionInputs({A1:'False'})).resolves.toBe(false);
  });

  it('preserves rapid widget write order across separate HTTP requests', async () => {
    let finish!:()=>void, admit!:()=>void;
    const held=new Promise<void>(resolve=>finish=resolve), admission=new Promise<void>(resolve=>admit=resolve);
    const seen:unknown[]=[];
    globalThis.fetch=vi.fn(async(input,init)=>{
      const url=String(input);
      if(url.endsWith('/v1/progress')) return new Response('{"seq":0,"events":[]}');
      if(url.endsWith('/v1/run-action')) {await held;return new Response(JSON.stringify(emptyGraph));}
      if(url.endsWith('/v1/action-inputs')) {
        seen.push(JSON.parse(String(init?.body)).sources);
        if(seen.length===1) await admission;
        return new Response('{"accepted":true}');
      }
      return new Response('{"status":"ok"}');
    });
    const service=new RuntimeService();await service.configureKernel('remote','http://kernel',[],{});
    const action=service.runAction('measure',{});
    const first=service.queueActionInputs({A1:'True'}), second=service.queueActionInputs({A1:'False'});
    await vi.waitFor(()=>expect(seen).toEqual([{A1:'True'}]));
    admit(); await first; await second;
    expect(seen).toEqual([{A1:'True'},{A1:'False'}]);
    finish(); await action;
  });

  it('reports an unavailable backend as a kernel error', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    const service = new RuntimeService();

    await expect(service.configureKernel('remote', 'http://127.0.0.1:8765', [])).rejects.toThrow(
      /health check failed/,
    );
    expect(service.status()).toBe('error');
    expect(service.statusMessage()).toBe('Remote Python unavailable');
  });
});


describe('workbook usage sampling', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; vi.useRealTimers(); });

  it('reads usage without changing cell activity or kernel status, and clears failures', async () => {
    let fail = false;
    globalThis.fetch = (async (input) => {
      if (String(input).endsWith('/health')) return new Response('{}');
      return fail ? new Response('oops', { status: 503 }) : new Response(JSON.stringify({ cpuPercent: 120, memoryBytes: 4096, memoryKind: 'resident' }));
    }) as typeof fetch;
    const runtime = new RuntimeService();
    await runtime.configureKernel('remote', 'https://kernel.example', []);
    runtime.status.set('running');
    await runtime.refreshUsage();
    expect(runtime.usage()?.cpuPercent).toBe(120);
    expect(runtime.status()).toBe('running');
    fail = true;
    await runtime.refreshUsage();
    expect(runtime.usage()).toBeNull();
    expect(runtime.error()).toBeNull();
  });

  it('discards an in-flight reading after switching or suspending a workbook', async () => {
    let finish!: (response: Response) => void;
    globalThis.fetch = (async (input) => String(input).endsWith('/health')
      ? new Response('{}')
      : new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch;
    const runtime = new RuntimeService();
    await runtime.configureKernel('remote', 'https://kernel.example', []);
    const pending = runtime.refreshUsage();
    runtime.suspend();
    finish(new Response(JSON.stringify({ cpuPercent: 100, memoryBytes: 4096, memoryKind: 'resident' })));
    await pending;
    expect(runtime.usage()).toBeNull();
  });

  it('polls only visible running workbooks, stops polling on teardown, and rejects invalid readings', async () => {
    vi.useFakeTimers();
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    let visible = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
    let polls = 0;
    let running = true;
    globalThis.fetch = (async (input) => {
      if (String(input).endsWith('/health')) return new Response('{}');
      polls++;
      return new Response(JSON.stringify({ cpuPercent: -1, memoryBytes: 1, memoryKind: 'resident' }));
    }) as typeof fetch;
    const runtime = new RuntimeService();
    await runtime.configureKernel('remote', 'https://kernel.example', []);
    const stop = runtime.monitorUsage(() => running);
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(polls).toBe(1);
      expect(runtime.usage()).toBeNull();
      visible = false;
      await vi.advanceTimersByTimeAsync(2000);
      visible = true;
      running = false;
      await vi.advanceTimersByTimeAsync(2000);
      expect(polls).toBe(1);
      stop();
      running = true;
      await vi.advanceTimersByTimeAsync(2000);
      expect(polls).toBe(1);
    } finally {
      stop();
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
      else Reflect.deleteProperty(document, 'visibilityState');
    }
  });
});


describe('passive editor intelligence', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const document: SheetDocument = {format: 'reaktiv-workbook', version: 4, name: 'Test', grid: {columns: 4, rows: 4}, cells: [], environment: {packages: [], variables: {}}, layout: {columnWidths: {}, rowHeights: {}, zoom: 1}};
  const query = {source: 'title.', position: {line: 0, character: 6}, action: 'completion' as const};
  it('never starts a kernel and treats unavailable intelligence as optional', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async input => {requests.push(String(input)); return new Response('{}');}) as typeof fetch;
    const runtime = new RuntimeService();
    await expect(runtime.editor(document, '', query)).resolves.toBeNull();
    expect(requests).toEqual([]);
    await runtime.configureKernel('remote', 'https://kernel.example', []);
    runtime.status.set('running');
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe('https://kernel.example/v1/editor');
      expect(JSON.parse(String(init?.body))).toEqual({document, sheet: '', ...query});
      return new Response('unavailable', {status: 404});
    }) as typeof fetch;
    await expect(runtime.editor(document, '', query)).resolves.toBeNull();
    expect(runtime.status()).toBe('running');
    expect(runtime.error()).toBeNull();
  });
});


describe('embedded Python session', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  it('attaches without applying and carries authentication and revision on edits', async () => {
    const document = {format:'reaktiv-workbook',version:4,name:'Host',grid:{columns:2,rows:2},environment:{packages:[],variables:{}},layout:{columnWidths:{},rowHeights:{},zoom:1},cells:[]} as SheetDocument;
    const requests: {url:string;init?:RequestInit}[] = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({url:String(url),init});
      const value = String(url).endsWith('/v1/session') ? {revision:4, document,graph:emptyGraph} : String(url).endsWith('/v1/apply') ? {...emptyGraph,sessionRevision:5} : {};
      return new Response(JSON.stringify(value));
    }) as typeof fetch;
    const runtime = new RuntimeService();
    expect((await runtime.attachSession('http://127.0.0.1:8765', 'secret')).revision).toBe(4);
    expect(requests.some(request=>request.url.endsWith('/v1/apply'))).toBe(false);
    await runtime.apply([], [], ['Sheet1'], '', true, document);
    const request = requests.find(request=>request.url.endsWith('/v1/apply'))!;
    expect(request.init?.headers).toMatchObject({Authorization:'Bearer secret'});
    expect(JSON.parse(String(request.init?.body))).toMatchObject({sessionRevision:4,document});
    expect(runtime.attachedSession()).toBe(true);
  });
  it('keeps action Apply synchronized on attach/save and ignores delayed older session snapshots', async () => {
    const document = {format:'reaktiv-workbook',version:4,name:'Host',grid:{columns:2,rows:2},environment:{packages:[],variables:{}},layout:{columnWidths:{},rowHeights:{},zoom:1},cells:[]} as SheetDocument;
    const definition = {name:'capture',source:'def capture(self):\n    return 42',label:'',references:{},bindings:{},exposed:true};
    const requests: {url:string;body:Record<string, unknown>}[] = [];
    let sessionRevision = 4;
    let workbookRevision = 'attached';
    let delayed!: (response: Response) => void;
    let holdRead = false;
    globalThis.fetch = (async (url, init) => {
      const path = String(url); const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({url:path,body});
      if (path.endsWith('/v1/session')) {
        if (holdRead) return new Promise<Response>(resolve => {delayed = resolve;});
        return new Response(JSON.stringify({revision:sessionRevision,document,graph:{...emptyGraph,workbookRevision}}));
      }
      if (path.endsWith('/v1/session-save')) {
        sessionRevision++; workbookRevision = 'saved';
        return new Response(JSON.stringify({revision:sessionRevision,document,graph:{...emptyGraph,workbookRevision}}));
      }
      if (path.endsWith('/v1/update-action')) {
        expect(body.expectedRevision).toBe(workbookRevision);
        expect(body.sessionRevision).toBe(sessionRevision);
        sessionRevision++; workbookRevision = 'edited-' + sessionRevision;
        return new Response(JSON.stringify({...emptyGraph,workbookRevision,sessionRevision,appliedAction:definition}));
      }
      return new Response('{}');
    }) as typeof fetch;
    const runtime = new RuntimeService();
    await runtime.attachSession('http://host', 'token');
    await runtime.updateAction(definition); // Requires the graph revision from attach.
    await runtime.saveSession(document);
    holdRead = true;
    const oldPoll = runtime.readSession();
    await vi.waitFor(() => expect(delayed).toBeTypeOf('function'));
    await runtime.updateAction(definition); // Requires the graph revision from Save.
    delayed(new Response(JSON.stringify({revision:4,document,graph:{...emptyGraph,workbookRevision:'retired'}})));
    await expect(oldPoll).resolves.toBeNull();
    await runtime.updateAction(definition); // Late polling must not roll back either revision.
    expect(requests.filter(request => request.url.endsWith('/v1/update-action'))).toHaveLength(3);
  });

});


describe('oversized workbook requests',()=>{
  for (const html of [false,true]) it(`keeps the kernel available after a 413 (${html ? 'proxy HTML' : 'JSON'}) without retrying`,async()=>{
    const saved=globalThis.fetch;
    const calls:string[]=[];
    globalThis.fetch=vi.fn(async(input)=>{
      const url=String(input);calls.push(url);
      if (url.endsWith('/health')) return new Response('{}');
      if (url.endsWith('/v1/inspect-document')) return new Response(html ? '<h1>Too large</h1>' : JSON.stringify({error:'Request exceeds the 10 MB limit'}),{status:413});
      return new Response(JSON.stringify({cpuPercent:0,memoryBytes:1234,memoryKind:'resident'}));
    });
    try {
      const runtime=new RuntimeService();
      await runtime.configureKernel('remote','http://kernel.local',[]);
      await expect(runtime.inspectDocument('large workbook')).rejects.toThrow(html ? 'server size limit' : '10 MB limit');
      expect(runtime.status()).toBe('ready');
      expect(runtime.statusMessage()).not.toContain('unavailable');
      expect(runtime.error()).toBeNull();
      expect(calls.filter(url=>url.endsWith('/v1/inspect-document'))).toHaveLength(1);
      await runtime.refreshUsage();
      expect(runtime.usage()?.memoryBytes).toBe(1234);
    } finally {globalThis.fetch=saved;}
  });
it('keeps the runtime busy until both different actions finish and cancels by ID', async()=>{
  const finishes=new Map<string,()=>void>(), calls:{url:string;body:Record<string,unknown>}[]=[];
  globalThis.fetch=vi.fn(async(input,init)=>{
    const url=String(input),body=JSON.parse(String(init?.body??'{}'));
    calls.push({url,body});
    if(url.endsWith('/v1/progress'))return new Response('{"seq":0,"events":[]}');
    if(url.endsWith('/v1/run-action')) {
      await new Promise<void>(resolve=>finishes.set(body.runId,resolve));
      return new Response(JSON.stringify(emptyGraph));
    }
    if(url.endsWith('/v1/set-inputs'))return new Response(JSON.stringify(emptyGraph));
    return new Response('{"status":"ok"}');
  });
  const service=new RuntimeService();await service.configureKernel('remote','http://kernel',[],{});
  const first=service.runAction('measure',{},'one'),second=service.runAction('export',{},'two');
  await vi.waitFor(()=>expect(finishes.size).toBe(2));
  await service.setInputs({A1:'True'});
  expect(service.status()).toBe('running');
  await service.cancelAction('measure','one');
  expect(calls).toContainEqual({url:'http://kernel/v1/cancel-action',body:{name:'measure',runId:'one'}});
  finishes.get('one')!();await first;
  expect(service.status()).toBe('running');
  finishes.get('two')!();await second;
  expect(service.status()).toBe('ready');
});

});
