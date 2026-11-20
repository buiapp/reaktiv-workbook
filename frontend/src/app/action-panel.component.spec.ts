import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PythonEditorComponent } from './python-editor.component';
import { serializeSheetDocument } from '../../../tests/python-writer';
import { describe, it, expect } from 'vitest';
import { ActionPanelComponent } from './action-panel.component';
import { createSheetDocument } from './sheet-file';
import type { ActionResult, SheetDocument } from './sheet.types';

describe('explicit model actions', () => {
  const method = {
    name: 'add',
    label: 'Add',
    source:
      'def add(self, quantity: int = 2):\n    # self.count stays in comments\n    self.count.set(quantity)',
    references: { count: 'A1' },
    bindings: {},
    exposed: true,
  };
  it('captures typed literals, defaults and cell bindings without executing on selection', () => {
    const panel = new ActionPanelComponent();
    panel.definitions = [method];
    panel.actions = [
      {
        name: 'add',
        label: 'Add',
        description: '',
        parameters: [{ name: 'quantity', annotation: 'int', required: false, default: 2 }],
        bindings: {},
        running: false,
        status: 'idle',
        error: null,
        output: {
          id: 'action:set_quantity',
          value: null,
          display: 'None',
          valueType: 'NoneType',
          error: null,
        },
      } as ActionResult,
    ];
    const calls: unknown[] = [];
    panel.invoked.subscribe((value) => calls.push(value));
    panel.ngOnChanges();
    expect(calls).toEqual([]);
    panel.invoke();
    expect(calls).toEqual([{ name: 'add', arguments: { quantity: { default: true } } }]);
    panel.arguments['quantity'] = { mode: 'literal', text: '3', cell: '' };
    panel.invoke();
    expect(calls[1]).toEqual({ name: 'add', arguments: { quantity: { value: 3 } } });
    panel.arguments['quantity'].text = '3.5';
    panel.invoke();
    expect(calls).toHaveLength(2);
    expect(panel.localError).toContain('integer');
    panel.arguments['quantity'] = { mode: 'cell', text: '', cell: 'A1' };
    panel.invoke();
    expect(calls[2]).toEqual({ name: 'add', arguments: { quantity: { cell: 'A1' } } });
  });
  it('writes model methods and rewrites member references without touching comments', () => {
    const doc = createSheetDocument(
      'Actions',
      4,
      8,
      [{ id: 'A1', kind: 'input', source: '1', name: 'quantity', enabled: true }],
      [],
      undefined,
      {},
      [],
      undefined,
      { actions: [method] },
    );
    const source = serializeSheetDocument(doc);
    expect(source).toContain('@action(label="Add")');
    expect(source).toContain('self.Sheet1.quantity.set(quantity)');
    expect(source).toContain('# self.count stays in comments');
  });
});

it('prefills missing-argument forms with button overrides and explicitly bypasses saved values for defaults', () => {
  const panel = new ActionPanelComponent();
  panel.selected = 'set_quantity';
  panel.initialArguments = { origin: { value: 'from button' }, limit: { default: true } };
  panel.actions = [
    {
      name: 'set_quantity',
      label: 'Set quantity',
      description: '',
      parameters: [
        { name: 'amount', annotation: 'int', required: true },
        { name: 'origin', annotation: 'str', required: false, default: 'method' },
        { name: 'limit', annotation: 'int', required: false, default: 2 },
      ],
      bindings: { origin: { value: 'saved' }, limit: { value: 100 } },
      running: false,
      error: null,
      output: {
        id: 'action:set_quantity',
        value: null,
        display: 'None',
        valueType: 'NoneType',
        error: null,
      },
    } as ActionResult,
  ];
  panel.ngOnChanges();
  expect(panel.arguments['origin'].text).toBe('from button');
  expect(panel.arguments['limit'].mode).toBe('default');
  panel.arguments['amount'].text = '7';
  const calls: unknown[] = [];
  panel.invoked.subscribe((value) => calls.push(value));
  panel.invoke();
  expect(calls).toEqual([
    {
      name: 'set_quantity',
      arguments: {
        amount: { value: 7 },
        origin: { value: 'from button' },
        limit: { default: true },
      },
    },
  ]);
});

it('keeps action invocation explicit while searching and opens required argument forms', () => {
  const panel = new ActionPanelComponent();
  panel.mode = 'runner';
  panel.enabled = true;
  panel.actions = [
    { name: 'reset', label: 'Reset', description: '', parameters: [], bindings: {} },
    {
      name: 'set',
      label: 'Set amount',
      description: '',
      parameters: [{ name: 'amount', annotation: 'int', required: true }],
      bindings: {},
    },
  ] as ActionResult[];
  const calls: unknown[] = [];
  panel.invoked.subscribe((value) => calls.push(value));
  panel.ngOnChanges();
  panel.search = 'amount';
  expect(panel.filteredActions.map((item) => item.name)).toEqual(['set']);
  expect(calls).toEqual([]);
  panel.choose('set');
  expect(calls).toEqual([]);
  panel.arguments['amount'].text = '4';
  panel.invoke();
  expect(calls).toEqual([{ name: 'set', arguments: { amount: { value: 4 } } }]);
  panel.choose('reset');
  expect(calls).toHaveLength(1);
  expect(panel.current?.name).toBe('reset');
  panel.invoke();
  expect(calls[1]).toEqual({ name: 'reset', arguments: {} });
  panel.busyName = 'reset';
  panel.choose('reset');
  expect(calls).toHaveLength(2);
});

it.each(['optional', 'literal', 'cell'])('opens runnable actions for inspection with %s arguments', binding => {
  const panel = new ActionPanelComponent();
  panel.mode = 'runner'; panel.enabled = true;
  panel.actions = [{
    name: 'set', label: 'Set amount', description: 'Inspect before running',
    parameters: [{name: 'amount', annotation: 'int', required: binding !== 'optional', default: 2}],
    bindings: binding === 'literal' ? {amount: {value: 7}} : binding === 'cell' ? {amount: {cell: 'A1'}} : {},
  }] as ActionResult[];
  const calls: unknown[] = [];
  panel.invoked.subscribe(value => calls.push(value));
  panel.ngOnChanges(); panel.choose('set'); panel.choose('set');
  expect(panel.current?.description).toBe('Inspect before running');
  expect(calls).toEqual([]);
  panel.invoke();
  expect(calls).toEqual([{name: 'set', arguments: {amount: binding === 'literal' ? {value: 7} : binding === 'cell' ? {cell: 'A1'} : {default: true}}}]);
});

it('opens methods in the shared editor and preserves unsaved edits between selections', () => {
  const panel = new ActionPanelComponent();
  panel.definitions = ['one', 'two'].map((name) => ({
    name,
    label: name,
    source: `def ${name}(self):\n    return 1`,
    references: {},
    bindings: {},
    exposed: true,
  }));
  panel.actions = panel.definitions.map((item) => ({
    ...item,
    parameters: [],
  })) as unknown as ActionResult[];
  panel.ngOnChanges();
  expect(panel.editing).toBe(false);
  panel.edit();
  expect(panel.editing).toBe(true);
  panel.draftSource = 'def one(self):\n    return 42';
  panel.choose('two');
  expect(panel.selectedDefinition?.source).toContain('def two');
  expect(panel.editing).toBe(false);
  panel.choose('one');
  expect(panel.draftSource).toContain('return 42');
  panel.cancelEdit();
  panel.edit();
  expect(panel.draftSource).toContain('return 1');
});


it('leaves Escape to CodeMirror while keeping the runner dismissible', () => {
  const panel = new ActionPanelComponent();
  const closed: boolean[] = [];
  panel.closed.subscribe(() => closed.push(true));
  const editor = document.createElement('app-python-editor');
  const source = document.createElement('div');
  editor.appendChild(source);
  const escape = new Event('keydown');
  Object.defineProperty(escape, 'target', {value: source});
  panel.escape(escape);
  expect(closed).toEqual([]);
  panel.escape(new Event('keydown'));
  expect(closed).toEqual([true]);
});


it('keeps drafts until the submitted action is explicitly acknowledged, not on unrelated definitions',()=>{
  const panel=new ActionPanelComponent();
  const original={name:'one',source:'def one(self):\n    return 1',label:'One',references:{},bindings:{},exposed:true};
  panel.enabled=true;panel.definitions=[original];panel.selected='one';panel.edit();
  panel.draftSource='def one(self):\n    return 42';panel.saveDraft();
  panel.definitions=[{...original}];panel.ngOnChanges();
  expect(panel.draftSource).toContain('return 42');
  expect(panel.applyMessage).toBe('');
  panel.applied={...original,source:panel.draftSource};panel.ngOnChanges();
  expect(panel.applyMessage).toContain('Edits applied to one');
  expect(panel.applyMessage).toContain('Use Run');
});

it('prevents overlapping applies and selecting another action during an apply',()=>{
  const panel=new ActionPanelComponent();panel.enabled=true;panel.editing=true;
  panel.draftSource='def one(self):\n    return 1';panel.selected='one';
  const saved:unknown[]=[];panel.saved.subscribe(value=>saved.push(value));
  panel.saveDraft();panel.applying=true;panel.saveDraft();panel.choose('two');
  expect(saved).toHaveLength(1);expect(panel.selected).toBe('one');
});

it('reports changed and stashed action drafts even when another method is selected', () => {
  const panel = new ActionPanelComponent();
  const first = { name: 'one', source: 'def one(self):\n    return 1', label: 'One', references: {}, bindings: {}, exposed: true };
  const second = { ...first, name: 'two', source: 'def two(self):\n    return 2', label: 'Two' };
  panel.definitions = [first, second]; panel.selected = 'one'; panel.edit();
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.draftSource = 'def one(self):\n    return 42';
  expect(panel.hasUnappliedDrafts).toBe(true);
  panel.choose('two');
  expect(panel.selectedDefinition?.source).toBe(second.source);
  expect(panel.editing).toBe(false);
  expect(panel.hasUnappliedDrafts).toBe(true);
});

it('collects visible, stashed and newly created action drafts with saved argument bindings', () => {
  const panel = new ActionPanelComponent();
  const one = {name: 'one', source: 'def one(self):\n    return 1', label: 'One', references: {x: 'A1'}, bindings: {amount: {value: 3}}, exposed: true};
  const two = {...one, name: 'two', source: 'def two(self):\n    return 2'};
  panel.definitions = [one, two]; panel.selected = 'one'; panel.edit();
  panel.draftSource = 'def one(self):\n    return 42'; panel.draftLabel = 'Updated';
  panel.choose('two'); panel.edit(); panel.draftSource = 'def two(self):\n    return 43';
  panel.create(); panel.draftSource = 'async def three(self):\n    return 44';
  expect(panel.pendingDefinitions()).toEqual([
    {...one, source: 'def one(self):\n    return 42', label: 'Updated'},
    {...two, source: 'def two(self):\n    return 43'},
    {name: 'three', source: 'async def three(self):\n    return 44', label: '', references: {}, bindings: {}, exposed: true},
  ]);
});

it('preserves newer typing when an apply acknowledgement arrives and resets drafts on replacement', () => {
  const panel = new ActionPanelComponent();
  const original = {name: 'one', source: 'def one(self):\n    return 1', label: 'One', references: {}, bindings: {}, exposed: true};
  panel.definitions = [original]; panel.selected = 'one'; panel.edit();
  panel.draftSource = 'def one(self):\n    return 2'; panel.pendingDefinitions();
  panel.draftSource = 'def one(self):\n    return 3';
  panel.applied = {...original, source: 'def one(self):\n    return 2'}; panel.ngOnChanges();
  expect(panel.draftSource).toContain('return 3');
  expect(panel.pendingDefinitions()[0].source).toContain('return 3');
  panel.resetDrafts();
  expect(panel.hasUnappliedDrafts).toBe(false);
  expect(panel.pendingDefinitions()).toEqual([]);
});

it('names invalid or renamed action drafts before attempting a file save', () => {
  const panel = new ActionPanelComponent();
  panel.definitions = [{name: 'one', source: 'def one(self):\n    pass', label: '', references: {}, bindings: {}, exposed: true}];
  panel.selected = 'one'; panel.edit(); panel.draftSource = 'def changed(self):\n    pass';
  expect(() => panel.pendingDefinitions()).toThrow('Action one: keep the method name');
  panel.draftSource = 'not a method';
  expect(() => panel.pendingDefinitions()).toThrow('Action one: define one method');
});

it('keeps one new draft across renames and lets Discard remove a failed new-action save', () => {
  const panel = new ActionPanelComponent(); panel.enabled = true; panel.create();
  panel.draftSource = 'def first_name(self):\n    return 1';
  expect(panel.pendingDefinitions().map(item => item.name)).toEqual(['first_name']);
  panel.draftSource = 'def renamed(self):\n    return 2';
  expect(panel.pendingDefinitions().map(item => item.name)).toEqual(['renamed']);
  panel.cancelEdit();
  expect(panel.pendingDefinitions()).toEqual([]);
  expect(panel.hasUnappliedDrafts).toBe(false);
});

it('allows repeated Apply on a new action without saving the workbook', () => {
  const panel = new ActionPanelComponent(); panel.enabled = true; panel.create();
  const submitted: import('./sheet.types').ActionDefinition[] = [];
  panel.saved.subscribe(definition => submitted.push(definition));
  const apply = () => {
    panel.saveDraft();
    const definition = submitted.at(-1)!;
    panel.definitions = [definition];
    panel.actions = [{...definition, parameters: []}] as unknown as ActionResult[];
    panel.selected = definition.name;
    panel.applied = definition;
    panel.ngOnChanges();
  };
  apply();
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.draftSource = 'def new_action(self):\n    return 42';
  apply();
  expect(panel.hasUnappliedDrafts).toBe(false);
  expect(panel.pendingDefinitions()).toEqual([]);
});

it.each([false, true])('acknowledges a switched draft while preserving other edits (%s)', otherEdited => {
  const panel = new ActionPanelComponent(); panel.enabled = true;
  const one = {name: 'one', source: 'def one(self):\n    return 1', label: 'One', references: {}, bindings: {}, exposed: true};
  const two = {...one, name: 'two', source: 'def two(self):\n    return 2'};
  panel.definitions = [one, two]; panel.selected = 'one'; panel.ngOnChanges(); panel.edit();
  panel.draftSource = 'def one(self):\n    return 10';
  panel.choose('two'); panel.edit();
  if (otherEdited) panel.draftSource = 'def two(self):\n    return 20';
  panel.choose('one'); panel.draftSource = 'def one(self):\n    return 100';
  const applied = {...one, source: panel.draftSource};
  panel.definitions = [applied, two]; panel.applied = applied; panel.ngOnChanges();
  expect(panel.hasUnappliedDrafts).toBe(otherEdited);
  panel.choose('two'); panel.cancelEdit();
  expect(panel.hasUnappliedDrafts).toBe(false);
  expect(panel.pendingDefinitions()).toEqual([]);
});

it('remembers separate scroll and cursor positions for action drafts and clears them for a new workbook', () => {
  const panel = new ActionPanelComponent();
  const make = (name: string) => ({name,label:name,source:`def ${name}(self):\n    pass`,references:{},bindings:{},exposed:true});
  panel.definitions = [make('first'), make('second')];
  panel.choose('first'); panel.edit();
  const first = {top:800,left:0,anchor:15,head:15};
  const second = {top:230,left:0,anchor:9,head:12};
  const presentation = panel as unknown as {
    editor: {capturePosition(): typeof first}; editorPosition: typeof first;
  };
  presentation.editor = {capturePosition: () => first};
  panel.draftSource += '\n    # draft kept';
  panel.choose('second');
  expect(presentation.editorPosition.top).toBe(0);
  presentation.editor = {capturePosition: () => second};
  panel.choose('first');
  expect(presentation.editorPosition).toEqual(first);
  expect(panel.draftSource).toContain('# draft kept');
  presentation.editor = {capturePosition: () => first};
  panel.choose('second');
  expect(presentation.editorPosition).toEqual(second);
  panel.resetDrafts(); panel.choose('first');
  expect(presentation.editorPosition).toEqual({top:0,left:0,anchor:0,head:0});
});

it('opens inline run controls without leaving the editor or executing on inspection', () => {
  const panel = new ActionPanelComponent();
  panel.enabled = true;
  panel.definitions = [{name: 'run', label: 'Run', source: 'def run(self):\n    return 1', references: {}, bindings: {}, exposed: true}];
  panel.actions = [{name: 'run', parameters: [], bindings: {}}] as unknown as ActionResult[];
  const calls: unknown[] = [];
  panel.invoked.subscribe(event => calls.push(event));
  panel.ngOnChanges();
  panel.showRun();
  expect(panel.runOpen).toBe(true);
  expect(panel.editing).toBe(false);
  expect(calls).toEqual([]);
  panel.invoke();
  expect(calls).toEqual([{name: 'run', arguments: {}}]);
  panel.choose('run');
  expect(panel.runOpen).toBe(false);
  expect(panel.editing).toBe(false);
});

it('keeps inspected actions clean when MCP replaces their definitions', () => {
  const panel = new ActionPanelComponent();
  const one = {name:'one', source:'def one(self):\n    return 1', label:'One', references:{}, bindings:{}, exposed:true};
  const two = {...one, name:'two', source:'def two(self):\n    return 2', label:'Two'};
  panel.definitions = [one, two]; panel.selected = 'one'; panel.ngOnChanges();
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.choose('two'); panel.choose('one');
  expect(panel.pendingDefinitions()).toEqual([]);
  const updated = {...one, source:'def one(self):\n    return 42', label:'Agent update'};
  panel.definitions = [updated, two];
  // A second MCP request may arrive before Angular calls ngOnChanges.
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.ngOnChanges();
  if (panel.editing) {
    expect(panel.draftSource).toBe(updated.source);
    expect(panel.draftLabel).toBe(updated.label);
  }
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.choose('two'); panel.choose('one');
  expect(panel.pendingDefinitions()).toEqual([]);
  panel.edit();
  panel.definitions = [{...updated, source:'def one(self):\n    return 99'}, two];
  expect(panel.hasUnappliedDrafts).toBe(false);
  panel.ngOnChanges();
  expect(panel.draftSource).toContain('return 99');
  expect(panel.pendingDefinitions()).toEqual([]);
});

it('refreshes untouched stashed actions while preserving actual user edits', () => {
  const panel = new ActionPanelComponent();
  const one = {name:'one', source:'def one(self):\n    return 1', label:'One', references:{}, bindings:{}, exposed:true};
  const two = {...one, name:'two', source:'def two(self):\n    return 2', label:'Two'};
  panel.definitions = [one, two]; panel.selected = 'one'; panel.ngOnChanges(); panel.edit();
  panel.draftSource = 'def one(self):\n    return 7';
  panel.choose('two'); panel.edit(); panel.choose('one'); panel.edit();
  const updated = {...two, source:'def two(self):\n    return 42'};
  panel.definitions = [one, updated]; panel.ngOnChanges();
  expect(panel.hasUnappliedDrafts).toBe(true);
  expect(panel.pendingDefinitions().map(definition => definition.name)).toEqual(['one']);
  panel.choose('two'); panel.edit();
  expect(panel.draftSource).toBe(updated.source);
  panel.choose('one'); panel.edit();
  expect(panel.draftSource).toBe('def one(self):\n    return 7');
});


it('renders inspectable source read-only until Edit and follows agent updates without a draft', async () => {
  await TestBed.configureTestingModule({imports:[ActionPanelComponent]}).compileComponents();
  const fixture = TestBed.createComponent(ActionPanelComponent);
  const definition = {name:'inspect', source:'def inspect(self):\n    return 1', label:'Inspect', references:{}, bindings:{}, exposed:true};
  fixture.componentRef.setInput('definitions', [definition]);
  fixture.componentRef.setInput('selected', 'inspect');
  fixture.componentRef.setInput('enabled', true);
  fixture.detectChanges(); await fixture.whenStable();
  const panel = fixture.componentInstance;
  const editor = () => fixture.debugElement.query(By.directive(PythonEditorComponent)).componentInstance as PythonEditorComponent;
  expect(editor().readOnly).toBe(true); expect(editor().value).toBe(definition.source);
  expect(panel.editing).toBe(false); expect(panel.hasUnappliedDrafts).toBe(false);
  fixture.componentRef.setInput('definitions', [{...definition, source:'def inspect(self):\n    return 42'}]);
  fixture.detectChanges(); await fixture.whenStable();
  expect(editor().value).toContain('return 42'); expect(editor().readOnly).toBe(true);
  expect(panel.pendingDefinitions()).toEqual([]);
  fixture.nativeElement.querySelector('button[aria-label="Edit action"]').click();
  fixture.detectChanges(); await fixture.whenStable();
  expect(editor().readOnly).toBe(false); expect(panel.hasUnappliedDrafts).toBe(false);
  editor().valueChange.emit('def inspect(self):\n    return 99');
  expect(panel.hasUnappliedDrafts).toBe(true);
  panel.cancelEdit(); fixture.detectChanges(); await fixture.whenStable();
  expect(editor().readOnly).toBe(true); expect(editor().value).toContain('return 42');
  expect(panel.hasUnappliedDrafts).toBe(false);
  fixture.destroy();
});

it('refuses the running method while allowing a different action to run',()=>{
  const panel=new ActionPanelComponent();
  panel.enabled=true;
  panel.actions=['measure','export'].map(name=>({name,label:name,description:'',parameters:[],bindings:{},running:name==='measure',error:null,output:{id:'action:'+name,value:null,display:'None',valueType:'NoneType',error:null}}));
  panel.busyName='measure';panel.runningNames=['measure'];
  const invoked=vi.fn();panel.invoked.subscribe(invoked);
  panel.ngOnChanges();panel.choose('measure');panel.invoke();
  expect(invoked).not.toHaveBeenCalled();
  panel.choose('export');panel.invoke();
  expect(invoked).toHaveBeenCalledWith({name:'export',arguments:{}});
});

async function executionPanel(mode: 'workspace' | 'runner', result: Partial<ActionResult> = {}) {
  await TestBed.configureTestingModule({imports: [ActionPanelComponent]}).compileComponents();
  const fixture = TestBed.createComponent(ActionPanelComponent);
  const definition = {name: 'measure', label: 'Measure', source: 'async def measure(self):\n    return 1', references: {}, bindings: {}, exposed: true};
  const action: ActionResult = {name: 'measure', label: 'Measure', description: '', parameters: [], bindings: {}, running: false, error: null,
    output: {id: 'action:measure', value: null, display: 'None', valueType: 'NoneType', error: null}, ...result};
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('enabled', true);
  fixture.componentRef.setInput('definitions', [definition]);
  fixture.componentRef.setInput('actions', [action]);
  fixture.detectChanges(); await fixture.whenStable();
  if (mode === 'workspace') { fixture.componentInstance.showRun(); fixture.detectChanges(); }
  return fixture;
}

it.each(['workspace', 'runner'] as const)('groups running controls and targets cancellation in %s', async mode => {
  const fixture = await executionPanel(mode, {running: true, status: 'running', runs: [{id: 'active-invocation', name: 'measure', status: 'running', error: null}]});
  const root = fixture.nativeElement as HTMLElement;
  const cancelled = vi.fn(); const invoked = vi.fn();
  fixture.componentInstance.invocationCancelled.subscribe(cancelled);
  fixture.componentInstance.invoked.subscribe(invoked);
  const execution = root.querySelector('.execution-section')!;
  expect(execution.querySelector<HTMLButtonElement>('.primary-button')!.disabled).toBe(true);
  expect(root.querySelectorAll('.execution-status')).toHaveLength(1);
  expect(execution.textContent).toContain('Running…');
  execution.querySelector<HTMLButtonElement>('.cancel-button')!.click();
  expect(cancelled).toHaveBeenCalledWith({name: 'measure', id: 'active-invocation'});
  expect(invoked).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLDetailsElement>('.run-history')!.open).toBe(false);
  expect(root.querySelector('nav')!.textContent).not.toContain('active-invocation');
  fixture.destroy();
});

it.each(['workspace', 'runner'] as const)('shows cancellation without an error alert in %s', async mode => {
  const fixture = await executionPanel(mode, {status: 'cancelled', cancelled: true, error: 'Action cancelled', runs: [{id: 'cancelled-run', name: 'measure', status: 'cancelled', error: 'Action cancelled'}]});
  const root = fixture.nativeElement as HTMLElement;
  expect(root.querySelector('.execution-status')!.textContent).toContain('Action cancelled');
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(root.querySelector('.cancel-button')).toBeNull();
  expect(root.querySelector<HTMLButtonElement>('.execution-section .primary-button')!.disabled).toBe(false);
  expect(root.querySelectorAll('.action-invocation pre')).toHaveLength(0);
  fixture.destroy();
});

it('keeps retained output distinct from a failed run and details collapsed', async () => {
  const fixture = await executionPanel('workspace', {status: 'failed', error: 'Device disconnected', output: {id:'action:measure', value:42, display:'42', valueType:'int', error:null}});
  const root = fixture.nativeElement as HTMLElement;
  expect(root.querySelector('[role="alert"]')!.textContent).toContain('Device disconnected');
  expect(root.querySelector('.result-section')!.textContent).toContain('Last successful result');
  expect(root.querySelector('.result-section pre')!.textContent).toContain('42');
  expect(root.querySelector<HTMLInputElement>('.action-label-field input')).toBeNull();
  expect(root.querySelector<HTMLDetailsElement>('.secondary-section')!.open).toBe(false);
  fixture.destroy();
});

it('does not offer cooperative cancellation for synchronous actions', async () => {
  const fixture = await executionPanel('runner', {running: true});
  fixture.componentRef.setInput('definitions', [{name:'measure', label:'Measure', source:'def measure(self):\n    return 1', references:{}, bindings:{}, exposed:true}]);
  fixture.detectChanges();
  const cancelled = vi.fn(); fixture.componentInstance.cancelled.subscribe(cancelled);
  fixture.componentInstance.cancelCurrent();
  expect(fixture.nativeElement.querySelector('.cancel-button')).toBeNull();
  expect(cancelled).not.toHaveBeenCalled();
  fixture.destroy();
});

it('keeps source authoring locked in workbook View mode without disabling the runner',()=>{
  const panel=new ActionPanelComponent();panel.enabled=true;panel.canEdit=false;
  panel.create();expect(panel.editing).toBe(false);
  panel.definitions=[{name:'measure',source:'def measure(self):\n    return 1',label:'Measure',references:{},bindings:{},exposed:true}];
  panel.selected='measure';panel.edit();expect(panel.editing).toBe(false);
  expect(panel.enabled).toBe(true);
  panel.canEdit=true;panel.edit();expect(panel.editing).toBe(true);
});
