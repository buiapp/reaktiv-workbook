import { renderPathWidget } from './path-widget';
import type { RichWidgetModel } from './input-widgets';
import { afterEach, describe, expect, it, vi } from 'vitest';

const model: RichWidgetModel = {type:'file', label:'Input file', value:'/old.csv', options:[], disabled:false};
const mount = () => { const root=document.createElement('div'); document.body.append(root); return root; };
afterEach(() => document.body.replaceChildren());

describe('path widget', () => {
  it('uses a host capability to pick a single file or folder and emits its path unchanged', async () => {
    for (const type of ['file','folder'] as const) {
      const root=mount(), change=vi.fn(), pickPath=vi.fn().mockResolvedValue('C:\\my data\\測定.csv');
      renderPathWidget(root,{...model,type},change,{pickPath});
      root.querySelector('button')!.click();
      expect(root.querySelector('button')!.disabled).toBe(true);
      expect(root.getAttribute('aria-busy')).toBe('true');
      await vi.waitFor(()=>expect(change).toHaveBeenCalledWith('C:\\my data\\測定.csv'));
      expect(pickPath).toHaveBeenCalledWith({kind:type,current:'/old.csv',label:'Input file'});
      expect(root.querySelector('input')!.value).toBe('C:\\my data\\測定.csv');
    }
  });

  it('keeps the input unchanged on cancellation and permits retry after an error', async () => {
    const root=mount(), change=vi.fn();
    const pickPath=vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Dialog failed')).mockResolvedValueOnce('/new.csv');
    renderPathWidget(root,model,change,{pickPath});
    root.querySelector('button')!.click();
    await vi.waitFor(()=>expect(root.querySelector('button')!.disabled).toBe(false));
    expect(change).not.toHaveBeenCalled(); expect(root.querySelector('input')!.value).toBe('/old.csv');
    root.querySelector('button')!.click();
    await vi.waitFor(()=>expect(root.querySelector('[role=alert]')!.textContent).toBe('Dialog failed'));
    expect(change).not.toHaveBeenCalled();
    root.querySelector('button')!.click();
    await vi.waitFor(()=>expect(change).toHaveBeenCalledWith('/new.csv'));
  });

  it('ignores results from removed or replaced controls', async () => {
    for (const removed of [true,false]) {
      const root=mount(), change=vi.fn(); let finish!: (path:string)=>void;
      const pickPath=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
      renderPathWidget(root,model,change,{pickPath}); root.querySelector('button')!.click();
      if(removed)root.remove(); else renderPathWidget(root,{...model,value:'/newer.csv',disabled:true},change,{pickPath});
      finish('/late.csv'); await Promise.resolve();
      expect(change).not.toHaveBeenCalled();
      if(!removed) { expect(root.querySelector('input')!.value).toBe('/newer.csv'); expect(root.querySelector('button')!.disabled).toBe(true); }
    }
  });

  it('offers manual path entry in a browser without inventing a local absolute path', () => {
    const root=mount(),change=vi.fn(); renderPathWidget(root,model,change,{});
    expect(root.querySelector('button')!.disabled).toBe(true);
    expect(root.textContent).toContain('reaktiv-workbook edit');
    const field=root.querySelector('input')!;field.value='/remote/data.csv';field.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith('/remote/data.csv');
  });

  it('does not open a dialog or write while disabled', () => {
    const root=mount(),change=vi.fn(),pickPath=vi.fn();
    renderPathWidget(root,{...model,disabled:true},change,{pickPath});
    root.querySelector('button')!.click(); root.querySelector('input')!.dispatchEvent(new Event('change'));
    expect(pickPath).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  });
});
