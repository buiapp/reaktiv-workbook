import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PythonEditorComponent } from './python-editor.component';

describe('PythonEditorComponent', () => {
  it('shows an example only while empty without inserting it into the code', async () => {
    await TestBed.configureTestingModule({ imports: [PythonEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    const changed = vi.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    fixture.componentRef.setInput('placeholder', 'source if previous is None else previous.value');
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('.cm-placeholder')).not.toBeNull());
    expect(fixture.nativeElement.querySelector('.cm-placeholder').textContent).toContain('previous.value');
    expect(fixture.componentInstance.value).toBe('');
    expect(changed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('value', 'source');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cm-placeholder')).toBeNull();
    fixture.componentRef.setInput('value', '');
    fixture.componentRef.setInput('placeholder', 'Updated example');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cm-placeholder').textContent).toBe('Updated example');
    expect(changed).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('loads CodeMirror with Python source on demand', async () => {
    await TestBed.configureTestingModule({ imports: [PythonEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    fixture.componentRef.setInput('value', 'return await fetch(A1)');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    for (
      let attempt = 0;
      attempt < 50 && compiled.querySelector('.cm-editor') === null;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();
    }
    expect(compiled.querySelector('.cm-editor')).not.toBeNull();
    expect(compiled.querySelector('.cm-content')?.textContent).toContain('await fetch(A1)');
  });

  it('applies multiline code with Shift+Enter or Ctrl/Cmd+Enter', async () => {
    await TestBed.configureTestingModule({ imports: [PythonEditorComponent] }).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    fixture.componentRef.setInput('value', 'value = 1\nvalue');
    let commits = 0;
    fixture.componentInstance.commit.subscribe(() => commits++);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(compiled.querySelector('.cm-content')).not.toBeNull());
    const editor = compiled.querySelector('.cm-content') as HTMLElement;

    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );

    expect(commits).toBe(2);
  });
  it('changes formula-bar layout and Enter behavior without replacing the editor', async () => {
    await TestBed.configureTestingModule({imports: [PythonEditorComponent]}).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    fixture.componentRef.setInput('singleLine', true);
    fixture.componentRef.setInput('value', 'x = 1');
    let commits = 0;
    fixture.componentInstance.commit.subscribe(() => commits++);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(root.querySelector('.cm-content')).not.toBeNull());
    const content = root.querySelector('.cm-content')!;
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(commits).toBe(1);
    expect(root.querySelector('.cm-lineNumbers')).toBeNull();
    fixture.componentRef.setInput('singleLine', false);
    fixture.detectChanges();
    expect(root.querySelector('.cm-content')).toBe(content);
    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull();
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(commits).toBe(1);
    expect(content.querySelectorAll('.cm-line')).toHaveLength(2);
    fixture.componentRef.setInput('singleLine', true);
    fixture.detectChanges();
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(commits).toBe(2);
    expect(content.textContent).toContain('x = 1');
    fixture.destroy();
  });

  it('uses REPL keys without changing cell-editor shortcuts', async () => {
    await TestBed.configureTestingModule({imports: [PythonEditorComponent]}).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    fixture.componentRef.setInput('consoleMode', true);
    let commits = 0;
    const recall: number[] = [];
    fixture.componentInstance.commit.subscribe(() => commits++);
    fixture.componentInstance.historyStep.subscribe(step => recall.push(step));
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('.cm-content')).not.toBeNull());
    const content = fixture.nativeElement.querySelector('.cm-content') as HTMLElement;
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(commits).toBe(1);
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(recall).toEqual([-1]);
    content.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true, bubbles: true}));
    expect(commits).toBe(1);
    expect(content.querySelectorAll('.cm-line')).toHaveLength(2);
    fixture.destroy();
  });

  it('marks reads, updates sheet context and navigates without applying code', async () => {
    await TestBed.configureTestingModule({imports: [PythonEditorComponent]}).compileComponents();
    const fixture = TestBed.createComponent(PythonEditorComponent);
    fixture.componentRef.setInput('value', 'price + 1');
    fixture.componentRef.setInput('referencesEnabled', true);
    fixture.componentRef.setInput('completions', [{label: 'price', cellId: 'A1', valueType: 'int'}]);
    let commits = 0;
    const navigated: string[] = [];
    fixture.componentInstance.commit.subscribe(() => commits++);
    fixture.componentInstance.referenceNavigate.subscribe(id => navigated.push(id));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(root.querySelector('.cm-cell-reference')).not.toBeNull());
    expect(root.querySelector('.cm-cell-reference')?.textContent).toBe('price');
    fixture.componentRef.setInput('completions', [{label: 'price', cellId: 'Other!A1'}]);
    fixture.detectChanges();
    expect(root.querySelector('.cm-cell-reference')?.getAttribute('data-cell-id')).toBe('Other!A1');
    root.querySelector('.cm-cell-reference')?.dispatchEvent(new MouseEvent('mousedown', {ctrlKey: true, bubbles: true}));
    expect(navigated).toEqual(['Other!A1']);
    expect(commits).toBe(0);
    fixture.componentRef.setInput('referencesEnabled', false);
    fixture.detectChanges();
    expect(root.querySelector('.cm-cell-reference')).toBeNull();
    fixture.destroy();
  });

});

describe('familiar editor completion and documentation controls', () => {
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
  beforeAll(() => {
    // jsdom does not measure text; real popup layout is checked in WebKit.
    if (!rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', {configurable:true,value:()=>[]});
    if (!rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable:true,value:()=>new DOMRect(10,10,10,18)});
  });
  afterAll(() => {
    if (!rangeRects) Reflect.deleteProperty(Range.prototype, 'getClientRects');
    if (!rangeBounds) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  });
  async function editor(inputs:Record<string,unknown>={}) {
    await TestBed.configureTestingModule({imports:[PythonEditorComponent]}).compileComponents();
    const fixture=TestBed.createComponent(PythonEditorComponent);
    for(const [name,value] of Object.entries(inputs)) fixture.componentRef.setInput(name,value);
    fixture.detectChanges();
    await vi.waitFor(()=>expect(fixture.nativeElement.querySelector('.cm-content')).not.toBeNull());
    const view=(fixture.componentInstance as unknown as {view:import('@codemirror/view').EditorView}).view;
    view.focus();view.dispatch({selection:{anchor:view.state.doc.length}});
    await Promise.resolve();
    return {fixture,view,press:(key:string,modifiers:KeyboardEventInit={})=>view.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers}))};
  }
  for(const mode of ['multiline','single-line','console']) for(const key of ['Tab','Enter']) it(`accepts the selected completion with ${key} before editing or submitting (${mode})`,async()=>{
    const {completionStatus}=await import('@codemirror/autocomplete');
    const {fixture,view,press}=await editor({value:'pri',completions:[{label:'price'}],singleLine:mode==='single-line',consoleMode:mode==='console'});
    const commit=vi.fn();fixture.componentInstance.commit.subscribe(commit);
    press(' ',{ctrlKey:true,code:'Space'});
    await vi.waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
    press(key);
    expect(view.state.doc.toString()).toBe('price');
    expect(commit).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('indents and outdents without suggestions and retains the comment shortcut',async()=>{
    const {fixture,view,press}=await editor({value:'amount = 1'});
    press('Tab');expect(view.state.doc.toString()).toBe('    amount = 1');
    press('Tab',{shiftKey:true});expect(view.state.doc.toString()).toBe('amount = 1');
    press('/',{ctrlKey:true});expect(view.state.doc.toString()).toBe('# amount = 1');
    fixture.destroy();
  });
  it('dismisses suggestions with Escape without applying them',async()=>{
    const {completionStatus}=await import('@codemirror/autocomplete');
    const {fixture,view,press}=await editor({value:'pri',completions:[{label:'price'}]});
    press(' ',{ctrlKey:true,code:'Space'});
    await vi.waitFor(()=>expect(completionStatus(view.state)).toBe('active'));
    press('Escape');expect(completionStatus(view.state)).toBeNull();
    expect(view.state.doc.toString()).toBe('pri');
    fixture.destroy();
  });
  it('bounds long hover documentation in a focusable scroll region and closes it with Escape',async()=>{
    const {activateHover}=await import('@codemirror/view');
    const {fixture,view,press}=await editor({value:'calculate',languageService:async()=>({available:true,result:'Long documentation\n'.repeat(500)})});
    activateHover(view,3,1);
    await vi.waitFor(()=>expect(document.querySelector('.cm-tooltip-hover .cm-cell-tooltip')).not.toBeNull());
    const docs=document.querySelector<HTMLElement>('.cm-tooltip-hover .cm-cell-tooltip')!;
    const popup=docs.closest('.cm-tooltip')!;
    expect(getComputedStyle(popup).overflow).toBe('auto');
    expect(getComputedStyle(popup).maxHeight).toContain('320px');
    expect(docs.tabIndex).toBe(0);
    expect(docs.getAttribute('aria-label')).toBe('Python documentation');
    docs.focus();
    const dismiss=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
    docs.dispatchEvent(dismiss);
    expect(dismiss.defaultPrevented).toBe(true);
    await vi.waitFor(()=>expect(document.querySelector('.cm-tooltip-hover')).toBeNull());
    expect(view.hasFocus).toBe(true);
    fixture.destroy();
  });
  it('opens parameter hints with Ctrl+Shift+Space and dismisses them with Escape',async()=>{
    const service=vi.fn(async(_query:import('./editor-intelligence').EditorQuery)=>({available:true,result:'calculate(value: int)'}));
    const {fixture,press}=await editor({value:'calculate(\n',languageService:service});
    press(' ',{ctrlKey:true,shiftKey:true,code:'Space'});
    await vi.waitFor(()=>expect(document.querySelector('.cm-tooltip.cm-cell-tooltip')).not.toBeNull());
    expect(service).toHaveBeenCalledWith(expect.objectContaining({action:'signatureHelp'}));
    press('Escape');
    await vi.waitFor(()=>expect(document.querySelector('.cm-tooltip.cm-cell-tooltip')).toBeNull());
    fixture.destroy();
  });
});

it('finds and replaces source through the search panel, supports undo, and protects read-only source', async () => {
  await TestBed.configureTestingModule({ imports: [PythonEditorComponent] }).compileComponents();
  const fixture = TestBed.createComponent(PythonEditorComponent);
  fixture.componentRef.setInput('value', 'sample = 1\nreturn sample');
  fixture.componentRef.setInput('searchEnabled', true);
  const changed = vi.fn(); fixture.componentInstance.valueChange.subscribe(changed);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  await vi.waitFor(() => expect(root.querySelector('.cm-content')).not.toBeNull());
  fixture.componentInstance.openSearch();
  const find = root.querySelector<HTMLInputElement>('input[name="search"]')!;
  const replace = root.querySelector<HTMLInputElement>('input[name="replace"]')!;
  find.value = 'sample'; find.dispatchEvent(new Event('change'));
  replace.value = 'reading'; replace.dispatchEvent(new Event('change'));
  root.querySelector<HTMLButtonElement>('button[name="replaceAll"]')!.click();
  expect(changed).toHaveBeenLastCalledWith('reading = 1\nreturn reading');
  const content = root.querySelector<HTMLElement>('.cm-content')!;
  content.dispatchEvent(new KeyboardEvent('keydown', {key:'z', ctrlKey:true, bubbles:true, cancelable:true}));
  expect(changed).toHaveBeenLastCalledWith('sample = 1\nreturn sample');
  fixture.componentRef.setInput('readOnly', true); fixture.detectChanges();
  changed.mockClear();
  root.querySelector<HTMLButtonElement>('button[name="replaceAll"]')?.click();
  expect(changed).not.toHaveBeenCalled();
  fixture.destroy();
});

it('restores a requested editor position even for identical source and clamps old selections', async () => {
  await TestBed.configureTestingModule({ imports: [PythonEditorComponent] }).compileComponents();
  const fixture = TestBed.createComponent(PythonEditorComponent);
  fixture.componentRef.setInput('value', 'return 1'); fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  await vi.waitFor(() => expect(root.querySelector('.cm-content')).not.toBeNull());
  fixture.componentRef.setInput('position', {top:120,left:0,anchor:200,head:200}); fixture.detectChanges();
  await vi.waitFor(() => expect(fixture.componentInstance.capturePosition()?.anchor).toBe(8));
  fixture.componentRef.setInput('position', {top:0,left:0,anchor:2,head:2}); fixture.detectChanges();
  await vi.waitFor(() => expect(fixture.componentInstance.capturePosition()?.anchor).toBe(2));
  fixture.destroy();
});

describe('scoped workbook action completion', () => {
  it('offers only the next path component at each level', async () => {
    const {pythonCompletionSource} = await import('./python-editor.component');
    const {EditorState} = await import('@codemirror/state');
    const {CompletionContext} = await import('@codemirror/autocomplete');
    const completions = [
      {label:'self'}, {label:'self.Inputs'}, {label:'self.Other'},
      {label:'self.Inputs.value'}, {label:'self.Inputs.value.set',apply:'self.Inputs.value.set('},
      {label:'self.Other.value'}, {label:'self.run'},
    ];
    const labels = (source:string) => {
      const state = EditorState.create({doc:source});
      return pythonCompletionSource(new CompletionContext(state,source.length,true),completions)?.options;
    };
    expect(labels('self.')?.map(item=>item.label)).toEqual(['Inputs','Other','run']);
    expect(labels('self.Inputs.')?.map(item=>item.label)).toEqual(['value']);
    expect(labels('self.Inputs.value.')?.[0]).toMatchObject({label:'set',apply:'set('});
    expect(labels('')?.map(item=>item.label)).toEqual(['self']);
  });
});
