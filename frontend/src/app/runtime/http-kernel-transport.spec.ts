import { vi } from 'vitest';
import { PerformanceDiagnostics } from '../performance-diagnostics';
import { HttpKernelTransport, RequestTooLargeError } from './http-kernel-transport';

describe('HttpKernelTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not dispatch an obsolete mutation after its initial progress query finishes', async () => {
    let finishProgress!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishProgress = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const transport = new HttpKernelTransport(
      () => ({ url: 'http://kernel', token: null }),
      new PerformanceDiagnostics(),
      vi.fn(),
      vi.fn(),
    );
    const pending = transport.request('/v1/apply', {});
    transport.invalidate();
    finishProgress(new Response('{"seq":0,"events":[]}'));
    await expect(pending).rejects.toThrow('kernel changed');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps request/progress credentials together and stops obsolete progress polling', async () => {
    vi.useFakeTimers();
    let connection = { url: 'http://first', token: 'secret', sessionRevision: 4 };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return String(input).endsWith('/v1/progress')
          ? Promise.resolve(new Response('{"seq":0,"events":[],"logs":[]}'))
          : new Promise<Response>((resolve) => {
              complete = resolve;
            });
      }),
    );
    const transport = new HttpKernelTransport(
      () => connection,
      new PerformanceDiagnostics(),
      vi.fn(),
      vi.fn(),
    );
    const pending = transport.request('/v1/apply', {});
    await vi.advanceTimersByTimeAsync(0);
    connection = { url: 'http://second', token: 'other', sessionRevision: 0 };
    await vi.advanceTimersByTimeAsync(200);
    expect(requests.every((request) => request.url.startsWith('http://first/'))).toBe(true);
    expect(
      requests.every(
        (request) =>
          (request.init?.headers as Record<string, string>)['Authorization'] === 'Bearer secret',
      ),
    ).toBe(true);
    expect(
      JSON.parse(String(requests.find((request) => request.url.endsWith('/v1/apply'))!.init?.body)),
    ).toEqual({ sessionRevision: 4 });
    transport.invalidate();
    const count = requests.length;
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toHaveLength(count);
    complete(new Response('{}'));
    await expect(pending).resolves.toEqual({});
  });

  it('classifies a size refusal without retrying the mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":"too large"}', { status: 413 }));
    vi.stubGlobal('fetch', fetch);
    const transport = new HttpKernelTransport(
      () => ({ url: 'http://kernel', token: null }),
      new PerformanceDiagnostics(),
      vi.fn(),
      vi.fn(),
    );
    await expect(transport.request('/v1/apply', {}, false)).rejects.toBeInstanceOf(
      RequestTooLargeError,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it('delivers intermediate HTTP snapshots and ignores an in-flight poll after completion', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (response: Response) => void;
    let finishPoll!: (response: Response) => void;
    let polls = 0;
    const snapshot = vi.fn();
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (!String(input).endsWith('/v1/progress')) return new Promise<Response>(resolve => { finish = resolve; });
      if (++polls === 1) return Promise.resolve(new Response('{"seq":0,"events":[]}'));
      if (polls === 2) return Promise.resolve(new Response('{"seq":1,"events":[],"snapshot":{"cells":[{"id":"A1","value":2}]}}'));
      if (polls === 3) return new Promise<Response>(resolve => { finishPoll = resolve; });
      return Promise.resolve(new Response('{"seq":2,"events":[]}'));   // the final read after completion
    }));
    const transport = new HttpKernelTransport(() => ({url: 'http://kernel', token: null}), new PerformanceDiagnostics(), vi.fn(), vi.fn(), snapshot);
    const running = transport.request('/v1/run-action', {});
    await vi.advanceTimersByTimeAsync(200);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(snapshot.mock.calls[0][0].cells[0].value).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    finish(new Response('{}')); await running;
    finishPoll(new Response('{"seq":2,"events":[],"snapshot":{"cells":[]}}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

it('negotiates rich-output references only with supporting servers and resets on reconnect',async()=>{
 const requests:Record<string,unknown>[]=[];
 const data={mimeType:'test',dataBase64:'abcd',cacheKey:'one'};
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));requests.push(body);
  return new Response(JSON.stringify({outputCacheVersion:1,cells:[{id:'A1',richOutput:body.knownOutputs?.includes('one')?{cacheKey:'one'}:data}]}));
 }));
 try {
  const transport=new HttpKernelTransport(()=>({url:'http://kernel',token:null}),new PerformanceDiagnostics(),vi.fn(),vi.fn());
  const first=await transport.request<{cells:{richOutput:unknown}[]}>('/v1/clear-logs',{},false);
  const second=await transport.request<typeof first>('/v1/clear-logs',{},false);
  expect(requests[0]['knownOutputs']).toBeUndefined();expect(requests[1]['knownOutputs']).toEqual(['one']);
  expect(second.cells[0].richOutput).toBe(first.cells[0].richOutput);
  transport.invalidate();await transport.request('/v1/clear-logs',{},false);
  expect(requests[2]['knownOutputs']).toBeUndefined();
 } finally{vi.unstubAllGlobals();}
});

it('an obsolete response cannot enable rich-output negotiation for a new kernel',async()=>{
 let finish!:(value:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>finish=resolve))
  .mockResolvedValue(new Response('{}'));
 vi.stubGlobal('fetch',fetcher);
 try {
  const transport=new HttpKernelTransport(()=>({url:'http://kernel',token:null}),new PerformanceDiagnostics(),vi.fn(),vi.fn());
  const old=transport.request('/v1/clear-logs',{},false);transport.invalidate();
  finish(new Response(JSON.stringify({outputCacheVersion:1,cells:[{richOutput:{cacheKey:'old',mimeType:'test',dataBase64:'old'}}]})));
  await old;await transport.request('/v1/clear-logs',{},false);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).knownOutputs).toBeUndefined();
 }finally{vi.unstubAllGlobals();}
});

it('delivers cell ends and logs that the kernel recorded after the last progress poll', async () => {
  // The kernel's progress log: a poll returns the entries numbered after its cursor.
  vi.useFakeTimers();
  try {
    const log: Array<{seq: number; event?: {event: string; cellId: string}; entry?: {level: string; message: string}}> = [];
    const record = (item: {event?: {event: string; cellId: string}; entry?: {level: string; message: string}}) => log.push({seq: log.length + 1, ...item});
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
      if (!String(input).endsWith('/v1/progress')) return new Promise<Response>(resolve => { finish = resolve; });
      const after = JSON.parse(String(init.body)).after as number | undefined;
      const newer = after === undefined ? [] : log.filter(item => item.seq > after);
      return new Response(JSON.stringify({
        seq: log.length,
        events: newer.flatMap(item => item.event ? [item.event] : []),
        logs: newer.flatMap(item => item.entry ? [item.entry] : []),
      }));
    }));
    const progress = vi.fn(), logs = vi.fn();
    const transport = new HttpKernelTransport(() => ({url: 'http://kernel', token: null}), new PerformanceDiagnostics(), progress, logs);
    const running = transport.request('/v1/set-inputs', {});
    await vi.advanceTimersByTimeAsync(0);
    record({event: {event: 'start', cellId: 'Algorithm!A17'}});
    await vi.advanceTimersByTimeAsync(200);            // a poll delivers the start
    expect(progress).toHaveBeenLastCalledWith({event: 'start', cellId: 'Algorithm!A17'});
    // The cell finishes and the response arrives before the next poll.
    record({entry: {level: 'info', message: 'done'}});
    record({event: {event: 'end', cellId: 'Algorithm!A17'}});
    finish(new Response('{}'));
    await running;
    await vi.advanceTimersByTimeAsync(400);
    expect(progress).toHaveBeenLastCalledWith({event: 'end', cellId: 'Algorithm!A17'});
    expect(logs).toHaveBeenCalledWith({level: 'info', message: 'done'});
  } finally {
    vi.unstubAllGlobals(); vi.useRealTimers();
  }
});
