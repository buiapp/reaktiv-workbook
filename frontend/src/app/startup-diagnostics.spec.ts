import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('frontend/public/startup.js', 'utf8');
const html = readFileSync('frontend/src/index.html', 'utf8');
function start(domReady = true) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const win = Object.assign(new EventTarget(), {
    reaktivStartup: undefined as Window['reaktivStartup'],
  });
  const storage = new Map<string,string>();
  const context = {window:win, document:doc, Error, URL, location:{href:'http://app.test/index.html?token=secret'},
    navigator:{userAgent:'test agent',clipboard:{writeText:vi.fn().mockRejectedValue(new Error('Unavailable'))}},
    localStorage:{setItem:(key:string,value:string)=>storage.set(key,value)}, console:{error:vi.fn()}, setTimeout, clearTimeout};
  runInNewContext(source,context);
  if (domReady) doc.dispatchEvent(new Event('DOMContentLoaded'));
  return {doc,win,api:win.reaktivStartup!,context,storage};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

describe('pre-Angular startup diagnostics',()=>{
  it('recovers from a slow startup and does not show failures over a running workbook',()=>{
    const {doc,api,storage}=start();
    vi.advanceTimersByTime(20000);
    expect(doc.getElementById('startup-status')!.textContent).toContain('longer than expected');
    api.ready();
    expect(doc.getElementById('startup-screen')!.hidden).toBe(true);
    api.fail(new Error('later error'));
    expect(doc.getElementById('startup-screen')!.hidden).toBe(true);
    expect([...storage.values()][0]).toContain('frontend-ready');
  });
  it('binds diagnostic controls even when module loading stalls DOMContentLoaded',async()=>{
    const {doc}=start(false);
    await vi.advanceTimersByTimeAsync(20000);
    doc.querySelector<HTMLButtonElement>('#startup-copy')!.click();
    await vi.waitFor(()=>expect(doc.querySelector<HTMLTextAreaElement>('#startup-report')!.value).toContain('startup-timeout'));
    expect(doc.querySelector<HTMLButtonElement>('#startup-copy')!.disabled).toBe(false);
  });
  it('keeps the error message when WebKit stack traces omit it',()=>{
    const {doc,api}=start();
    const error=new Error('Application root missing');
    error.stack='selectRootElement@http://app.test/chunk.js:1:20';
    api.fail(error);
    expect(doc.getElementById('startup-status')!.textContent).toBe('Error: Application root missing');
  });
  it('captures bootstrap failures and exposes a manual copy fallback without a clipboard',async()=>{
    const {doc,api,context}=start();
    context.location.href='http://127.0.0.1:8765/index.html?token=secret#private';
    api.fail(new Error('Chunk could not load'));
    expect(doc.getElementById('startup-title')!.textContent).toBe('Reaktiv Workbook could not start');
    doc.querySelector<HTMLButtonElement>('#startup-copy')!.click();
    await vi.waitFor(()=>expect(doc.querySelector<HTMLTextAreaElement>('#startup-report')!.value).toContain('Chunk could not load'));
    expect(doc.querySelector<HTMLTextAreaElement>('#startup-report')!.value).not.toContain('token=secret');
    expect(doc.querySelector<HTMLTextAreaElement>('#startup-report')!.value).toContain('http://127.0.0.1:8765/index.html');
    expect(doc.getElementById('startup-copy-status')!.textContent).toContain('Select and copy');
    expect(doc.querySelector<HTMLDetailsElement>('#startup-details')!.open).toBe(true);
    expect(doc.querySelector<HTMLButtonElement>('#startup-copy')!.disabled).toBe(false);
  });
  it('copies the report with the browser clipboard when it is available',async()=>{
    const {doc,api,context}=start();
    context.navigator.clipboard.writeText=vi.fn().mockResolvedValue(undefined);
    api.fail(new Error('startup stopped'));
    doc.querySelector<HTMLButtonElement>('#startup-copy')!.click();
    await vi.waitFor(()=>expect(doc.getElementById('startup-copy-status')!.textContent).toBe('Diagnostics copied.'));
    expect(context.navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('startup stopped'));
  });
});
