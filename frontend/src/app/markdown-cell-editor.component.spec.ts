import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import type { Editor } from 'prosekit/core';
import { Selection } from 'prosekit/pm/state';
import { closeHistory, undo, redo } from 'prosekit/pm/history';
import {
  MarkdownCellEditorComponent,
  resolveEvaluatedExpressions,
  type MarkdownInterpolationValue,
} from './markdown-cell-editor.component';
import { ProseKitBlockEditorComponent } from './prosekit-block-editor.component';

/** A note editor showing `source`, with the page editor (ProseKit) mounted. */
async function mountNote(
  source: string,
  values: MarkdownInterpolationValue[] = [],
  inputs: Record<string, unknown> = {},
): Promise<{ fixture: ComponentFixture<MarkdownCellEditorComponent>; page: HTMLElement; emitted: string[] }> {
  await TestBed.configureTestingModule({ imports: [MarkdownCellEditorComponent] }).compileComponents();
  const fixture = TestBed.createComponent(MarkdownCellEditorComponent);
  fixture.componentRef.setInput('source', source);
  fixture.componentRef.setInput('title', 'Note');
  fixture.componentRef.setInput('cellId', 'D1');
  fixture.componentRef.setInput('values', values);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  const emitted: string[] = [];
  fixture.componentInstance.sourceChange.subscribe((value) => emitted.push(value));
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  await vi.waitFor(() => expect(host.querySelector('.note-document .ProseMirror')).not.toBeNull(), {
    timeout: 5000,
  });
  fixture.detectChanges();
  return { fixture, page: host.querySelector('.note-document .ProseMirror') as HTMLElement, emitted };
}

function editorOf(fixture: ComponentFixture<MarkdownCellEditorComponent>): Editor {
  const component = fixture.debugElement.query(By.directive(ProseKitBlockEditorComponent))
    .componentInstance as unknown as { instance: Editor };
  return component.instance;
}

const plotValue: MarkdownInterpolationValue = {
  reference: 'plot',
  cellId: 'A1',
  display: 'Plot',
  error: null,
  richOutput: { mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' },
};

describe('Note page editor', () => {
  it('shows the whole note as one editable page', async () => {
    const { page } = await mountNote('# Note\n\nFirst paragraph\n\n- one\n- two\n');
    expect(page.getAttribute('contenteditable')).toBe('true');
    expect(page.querySelector('h1')?.textContent).toBe('Note');
    expect(page.textContent).toContain('First paragraph');
    expect(page.textContent).toContain('one');
    expect(page.textContent).toContain('two');
  });

  it('renders persisted image dimensions', async () => {
    const { page } = await mountNote('![chart](https://example.com/chart.png "reaktiv-size:320x180")');
    const image = page.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('width')).toBe('320');
    expect(image.getAttribute('height')).toBe('180');
  });

  it('edits the same note in the raw and rendered views', async () => {
    const { fixture, emitted } = await mountNote('# Note\n\nFirst paragraph\n');
    const buttons = () => [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];

    buttons().find((button) => button.textContent?.trim() === 'Raw')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.raw-markdown-editor')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.note-page')).toBeNull();

    const edited = '# Note\n\nFirst paragraph\n\nWritten in **raw**\n';
    (fixture.componentInstance as unknown as { updateRawSource(source: string): void }).updateRawSource(
      edited,
    );
    fixture.componentRef.setInput('source', edited);
    buttons().find((button) => button.textContent?.trim() === 'Rendered')!.click();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('.ProseMirror strong')?.textContent).toBe('raw'),
    );
    expect(emitted).toEqual([edited]);
  });

  it('keeps the note toolbar horizontally scrollable', async () => {
    const { fixture } = await mountNote('# Note');
    const toolbar = fixture.nativeElement.querySelector('.toolbar-actions') as HTMLElement;
    expect(getComputedStyle(toolbar).overflowX).toBe('auto');
  });

  it('renders an interpolated image artifact linked to its source cell', async () => {
    const { page } = await mountNote('# Plot\n\n{{ A1 }}', [
      {
        reference: 'A1',
        cellId: 'A1',
        display: 'plot.png',
        error: null,
        artifact: {
          filename: 'plot.png',
          mimeType: 'image/png',
          size: 8,
          sha256: 'digest',
          dataBase64: 'iVBORw0KGgo=',
        },
      },
    ]);
    const image = page.querySelector('.cell-value-node .artifact-value img') as HTMLImageElement;
    expect(image.src).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(image.closest('a')?.getAttribute('href')).toBe('#cell-A1');
    expect(image.closest('.cell-value-node')?.classList).toContain('block-value');
  });

  it('renders a rich plot result', async () => {
    const { page } = await mountNote('{{ plot }}', [plotValue]);
    const image = page.querySelector('.artifact-value img') as HTMLImageElement;
    expect(image.src).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('resizes a live plot while keeping its reactive reference', async () => {
    const { fixture, page, emitted } = await mountNote('{{ plot }}', [plotValue]);
    page.querySelector('.cell-value-node')!.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
    fixture.detectChanges();
    const small = [...fixture.nativeElement.querySelectorAll('.image-size-presets button')].find(
      (button) => (button as HTMLElement).textContent?.trim() === 'Small',
    ) as HTMLButtonElement;
    small.click();
    fixture.detectChanges();

    expect(emitted.at(-1)).toContain('[{{ plot }}](#sheet-output?width=240&height=135)');
    const resized = page.querySelector('.artifact-value img') as HTMLImageElement;
    expect(resized.getAttribute('width')).toBe('240');
  });

  it('inserts a cell as a live value and keeps the Markdown readable', async () => {
    const { fixture, page, emitted } = await mountNote('Revenue: ', [
      { reference: 'revenue', cellId: 'A1', display: '125,000', error: null },
    ]);
    const editor = fixture.debugElement.query(By.directive(ProseKitBlockEditorComponent))
      .componentInstance as ProseKitBlockEditorComponent;
    const view = editorOf(fixture).view;
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    editor.insertCell('revenue');
    expect(page.querySelector('.cell-value-node .live-value')?.textContent).toBe('125,000');
    expect(emitted.at(-1)).toBe('Revenue:{{ revenue }}');
  });

  it('formats Markdown string values like the note around them, sanitised', async () => {
    const summary = '## Summary\n\n- **42** items\n- see [docs](https://example.com)\n\n<img src=x onerror="alert(1)">';
    const { fixture, page, emitted } = await mountNote('Intro\n\n{{ summary }}\n\nName: {{ name }} and {{ plain }}', [
      { reference: 'summary', cellId: 'A1', display: summary, error: null, value: summary, markdownString: true },
      { reference: 'name', cellId: 'A2', display: '**Ada**', error: null, value: '**Ada**', markdownString: true },
      { reference: 'plain', cellId: 'A3', display: '**raw**', error: null, value: '**raw**' },
    ]);
    fixture.detectChanges();
    const block = page.querySelector('.cell-value-node.block-value div.markdown-value') as HTMLElement;
    expect(block.querySelector('h2')?.textContent).toBe('Summary');
    expect([...block.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['42 items', 'see docs']);
    expect(block.querySelector('li strong')?.textContent).toBe('42');
    expect(block.querySelector('img')?.getAttribute('onerror')).toBeNull();
    const inline = page.querySelector('span.live-value.markdown-value') as HTMLElement;
    expect(inline.innerHTML).toBe('<strong>Ada</strong>');
    // A cell with Markdown turned off keeps its literal text.
    expect([...page.querySelectorAll('.live-value')].map((value) => value.textContent)).toContain('**raw**');
    expect(emitted).toEqual([]);
  });

  it('turns typed {{ expression }} text into a live value', async () => {
    const { fixture, page, emitted } = await mountNote('Total', [
      { reference: 'total', cellId: 'B1', display: '42', error: null },
    ]);
    const view = editorOf(fixture).view;
    view.dispatch(view.state.tr.insertText(' is {{ total }}', view.state.doc.content.size - 1));
    expect(page.querySelector('.cell-value-node .live-value')?.textContent).toBe('42');
    expect(emitted.at(-1)).toBe('Total is {{ total }}');
  });

  it('keeps expressions with Markdown characters intact', async () => {
    const { fixture, emitted } = await mountNote('Double: {{ total * 2 }} and {{ rows[0]["a_b"] }}');
    const view = editorOf(fixture).view;
    view.dispatch(view.state.tr.insertText('!', view.state.doc.content.size - 1));
    expect(emitted.at(-1)).toBe('Double: {{ total * 2 }} and {{ rows[0]["a_b"] }}!');
  });

  it('renders values inside inline code and tables', async () => {
    const { page } = await mountNote(
      "Average: `{{ average }}`\n\n| Metric | Value |\n| --- | ---: |\n| Revenue | {{ metrics['revenue'] }} |",
      [
        { reference: 'average', cellId: 'B2', display: '126,833.3333', error: null },
        { reference: 'metrics', cellId: 'B3', display: '{}', value: {}, error: null },
      ],
      {
        evaluatedSource:
          'Average: `126,833.3333`\n\n| Metric | Value |\n| --- | ---: |\n| Revenue | $125,000 |',
      },
    );
    expect(page.querySelector('code .live-value')?.textContent).toBe('126,833.3333');
    const cell = page.querySelector('td .live-value') as HTMLElement;
    expect(cell.textContent).toBe('$125,000');
    expect(cell.closest('a')?.getAttribute('href')).toBe('#cell-B3');
  });

  it('keeps the slash and cell menus available', async () => {
    const { fixture } = await mountNote('Text');
    expect(fixture.nativeElement.querySelectorAll('prosekit-autocomplete-root')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('prosekit-block-handle-root')).not.toBeNull();
    // The handle's buttons read their own `editor` property (no context from the root).
    for (const selector of ['prosekit-block-handle-add', 'prosekit-block-handle-draggable']) {
      expect((fixture.nativeElement.querySelector(selector) as { editor?: unknown }).editor).toBeTruthy();
    }
  });

  it('renders input widgets and emits Python input values', async () => {
    const { fixture, page, emitted } = await mountNote(
      '[Revenue: {{ revenue }}](#sheet-input:revenue?type=range&min=0&max=100&step=5)',
      [{ reference: 'revenue', cellId: 'A1', display: '50', value: 50, editable: true, error: null, widget: {type: 'range'} }],
    );
    let update: { cellId: string; source: string } | undefined;
    fixture.componentInstance.widgetChange.subscribe((value) => (update = value));
    const widget = page.querySelector('.sheet-widget input') as HTMLInputElement;
    expect(widget.type).toBe('range');
    expect(widget.min).toBe('0');
    expect(widget.max).toBe('100');
    widget.value = '75';
    widget.dispatchEvent(new Event('change', { bubbles: true }));
    expect(update).toEqual({ cellId: 'A1', source: '75' });
    expect(emitted).toEqual([]);
  });

  it.each([
    { value: .35, min: .05, max: .95, step: .01, next: .36 },
    { value: 1200, min: 1000, max: 2000, step: 10, next: 1210 },
    { value: -7.5, min: -10, max: -1, step: .5, next: -7 },
  ])('initializes a slider at $value before the first interaction', async ({ value, min, max, step, next }) => {
    const { fixture, page } = await mountNote(
      `[Amount](#sheet-input:amount?type=range&min=${min}&max=${max}&step=${step})`,
      [{ reference: 'amount', cellId: 'A1', display: String(value), value, editable: true, error: null, widget: {type: 'range'} }],
    );
    const update = vi.fn();
    fixture.componentInstance.widgetChange.subscribe(update);
    const control = page.querySelector<HTMLInputElement>('.sheet-widget input')!;
    expect(control.valueAsNumber).toBe(value);
    page.querySelectorAll<HTMLButtonElement>('.widget-step')[1].click();
    expect(control.valueAsNumber).toBe(next);
    expect(update).toHaveBeenLastCalledWith({ cellId: 'A1', source: String(next) });
  });

  it('updates widget bounds from reactive note expressions without editing the source', async () => {
    const source = '[Amount: {{ amount }}](#sheet-input:amount?type=range&min=0&max={{ limit + 10 }}&step={{ precision }})';
    const { fixture, page, emitted } = await mountNote(source, [
      { reference: 'amount', cellId: 'A1', display: '2', value: 2, editable: true, error: null, widget: {type: 'range'} },
      { reference: 'precision', cellId: 'A3', display: '0.5', value: .5, editable: true, error: null },
    ], { evaluatedSource: '[Amount: 2](#sheet-input:amount?type=range&min=0&max=20&step=0.5)' });
    expect((page.querySelector('.sheet-widget input') as HTMLInputElement).max).toBe('20');
    expect((page.querySelector('.sheet-widget input') as HTMLInputElement).step).toBe('0.5');
    fixture.componentRef.setInput('evaluatedSource', '[Amount: 2](#sheet-input:amount?type=range&min=0&max=30&step=0.5)');
    fixture.detectChanges();
    await vi.waitFor(() => expect((page.querySelector('.sheet-widget input') as HTMLInputElement).max).toBe('30'));
    expect(emitted).toEqual([]);
  });

  it('uses a list-valued cell for reactive dropdown options, preserving commas', async () => {
    const { page } = await mountNote('[Choice](#sheet-input:choice?type=select&options={{ choices }})', [
      { reference: 'choice', cellId: 'A1', display: 'a,b', value: 'a,b', editable: true, error: null, widget: {type: 'select'} },
      { reference: 'choices', cellId: 'A2', display: "['a,b', 'c']", value: ['a,b', 'c'], editable: true, error: null },
    ]);
    expect([...page.querySelectorAll('option')].map(option => option.value)).toEqual(['a,b', 'c']);
  });

  it('inherits reactive options and labels from the input configuration and preserves unavailable values', async () => {
    const initial: MarkdownInterpolationValue={reference:'choice',cellId:'A1',display:'a,b',value:'a,b',editable:true,error:null,
      widget:{type:'select',label:'Choose device',options:['a,b','c']}};
    const {fixture,page,emitted}=await mountNote('[Choice](#sheet-input:choice)',[initial],{readOnly:true,interactive:true});
    const select=page.querySelector('select')!;
    expect([...select.options].map(option=>option.value)).toEqual(['a,b','c']);
    expect(page.textContent).toContain('Choose device');
    fixture.componentRef.setInput('values',[{...initial,widget:{type:'select',label:'Available devices',options:['c'],disabled:true}}]);
    fixture.detectChanges();
    await vi.waitFor(()=>expect(page.textContent).toContain('Available devices'));
    expect(page.querySelector('select')).toBe(select);
    expect(select.value).toBe('a,b');expect(select.options[0].textContent).toContain('unavailable');
    expect(select.disabled).toBe(true);expect(emitted).toEqual([]);
  });

  it('shares toggle, loading, pressed and visibility state with note buttons', async () => {
    const initial: MarkdownInterpolationValue={reference:'running',cellId:'A1',display:'True',value:true,editable:true,error:null,
      widget:{type:'button',label:'Stop',buttonMode:'toggle',loading:true,pressed:true}};
    const {fixture,page,emitted}=await mountNote('[Run](#sheet-input:running)',[initial],{readOnly:true,interactive:true});
    const changes: Array<{cellId:string;source:string}>=[];
    fixture.componentInstance.widgetChange.subscribe(change=>changes.push(change));
    let button=page.querySelector<HTMLButtonElement>('.rw-button')!;
    expect(button.textContent).toBe('Stop');expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');button.click();expect(changes).toEqual([]);
    fixture.componentRef.setInput('values',[{...initial,widget:{...initial.widget,loading:false}}]);fixture.detectChanges();
    await vi.waitFor(()=>expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(false));
    button=page.querySelector<HTMLButtonElement>('.rw-button')!;button.click();
    expect(changes).toEqual([{cellId:'A1',source:'False'}]);
    expect(emitted).toEqual([]);
    fixture.componentRef.setInput('values',[{...initial,widget:{...initial.widget,visible:false}}]);fixture.detectChanges();
    await vi.waitFor(()=>expect(page.querySelector<HTMLElement>('.sheet-widget-node')!.hidden).toBe(true));
  });

  it('updates slider configuration without replacing the dragged control', async () => {
    const initial: MarkdownInterpolationValue={reference:'amount',cellId:'A1',display:'3',value:3,editable:true,error:null,
      widget:{type:'range',label:'Amount',min:0,max:10}};
    const {fixture,page}=await mountNote('[Amount](#sheet-input:amount)',[initial],{readOnly:true,interactive:true});
    const slider=page.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.dispatchEvent(new Event('pointerdown'));
    fixture.componentRef.setInput('values',[{...initial,widget:{type:'range',label:'New label',min:0,max:20,disabled:true}}]);fixture.detectChanges();
    await vi.waitFor(()=>expect(page.textContent).toContain('New label'));
    expect(page.querySelector('input[type="range"]')).toBe(slider);expect(slider.max).toBe('20');expect(slider.disabled).toBe(true);
  });

  it('keeps focused textarea drafts when reactive presentation changes', async () => {
    const initial: MarkdownInterpolationValue={reference:'text',cellId:'A1',display:'saved',value:'saved',editable:true,error:null,
      widget:{type:'textarea',label:'Text',placeholder:'Enter text'}};
    const {fixture,page}=await mountNote('[Text](#sheet-input:text)',[initial],{readOnly:true,interactive:true});
    const area=page.querySelector('textarea')!;area.focus();area.value='unsaved draft';area.setSelectionRange(3,3);
    fixture.componentRef.setInput('values',[{...initial,widget:{type:'textarea',label:'New text label',placeholder:'New placeholder'}}]);fixture.detectChanges();
    await vi.waitFor(()=>expect(page.querySelector('textarea')!.placeholder).toBe('New placeholder'));
    expect(page.querySelector('textarea')!.value).toBe('unsaved draft');
    expect(document.activeElement).toBe(page.querySelector('textarea'));
  });

  it('shows an override reset action for linked widgets in reading mode', async () => {
    const { fixture, page, emitted } = await mountNote('[Price](#sheet-input:price?type=number)', [
      { reference: 'price', cellId: 'B1', display: '7', value: 7, editable: true, error: null, kind: 'linked', linkedOverride: '7' },
    ], { readOnly: true, interactive: true });
    const reset = vi.fn(); fixture.componentInstance.linkedReset.subscribe(reset);
    const button = page.querySelector('.linked-reset') as HTMLButtonElement;
    expect(button.title).toContain('Value overridden'); expect(button.querySelector('svg')).not.toBeNull(); expect(button.disabled).toBe(false);
    button.click(); expect(reset).toHaveBeenCalledWith('B1'); expect(emitted).toEqual([]);
  });

  it('keeps the slider control when a linked override appears during dragging', async () => {
    const initial: MarkdownInterpolationValue = { reference: 'price', cellId: 'B1', display: '7', value: 7, editable: true, error: null, kind: 'linked', linkedOverride: null, widget: {type:'range'} };
    const { fixture, page } = await mountNote('[Price](#sheet-input:price?type=range&min=0&max=1000000&step=0.001)', [initial], { readOnly: true, interactive: true });
    const slider = page.querySelector('input[type="range"]') as HTMLInputElement;
    slider.dispatchEvent(new Event('pointerdown'));
    fixture.componentRef.setInput('values', [{ ...initial, display: '100000.123', value: 100000.123, linkedOverride: '100000.123' }]);
    fixture.detectChanges();
    await vi.waitFor(() => expect(page.querySelector('.linked-reset')).not.toBeNull());
    expect(page.querySelector('input[type="range"]')).toBe(slider);
    slider.dispatchEvent(new Event('pointerup'));
  });

  it('uses the cell widget type even when note source requests another type', async () => {
    const { page, fixture } = await mountNote('[Choice](#sheet-input:choice?type=multiselect)', [
      {reference:'choice',cellId:'A1',display:'EU',value:'EU',editable:true,error:null,
       widget:{type:'radio',options:['EU','US']}},
    ]);
    expect(page.querySelectorAll('input[type=radio]').length).toBe(2);
    expect(page.querySelector('input[type=checkbox]')).toBeNull();
    const change = vi.fn(); fixture.componentInstance.widgetChange.subscribe(change);
    page.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();
    expect(change).toHaveBeenCalledWith({cellId:'A1',source:'"US"'});
    fixture.componentRef.setInput('values', [
      {reference:'choice',cellId:'A1',display:'4',value:4,editable:true,error:null},
    ]);
    fixture.detectChanges();
    await vi.waitFor(() => expect(page.querySelector('input')?.type).toBe('number'));
  });

  it('is read-only while the kernel is not running', async () => {
    const { page } = await mountNote('Text', [], { readOnly: true });
    expect(page.getAttribute('contenteditable')).toBe('false');
  });

  it('shows a quiet placeholder for values not computed yet', async () => {
    const { page } = await mountNote('Total: {{ total }}', [
      { reference: 'total', cellId: 'B1', display: '', error: null, pending: true },
    ]);
    expect(page.innerHTML).toContain('class="pending-value"');
    expect(page.innerHTML).not.toContain('missing-value');
  });

  it('embeds a referenced note', async () => {
    const { page } = await mountNote('# Report\n\n{{ summary }}', [
      { reference: 'summary', cellId: 'Notes!A1', display: 'Left: **10** of 100', error: null, kind: 'markdown' },
    ]);
    expect(page.querySelector('.note-embed')?.innerHTML).toContain('<strong>10</strong>');
  });
});

describe('evaluated expressions', () => {
  it('aligns values with the evaluated note, including a value at the very end', () => {
    const resolved = resolveEvaluatedExpressions(
      'A {{ a }} and B {{ b * 2 }}',
      'A 1 and B [1, 2, 1, 2]\n',
    );
    expect(resolved.get('a')).toBe('1');
    expect(resolved.get('b * 2')).toBe('[1, 2, 1, 2]');
  });
});

it('blocks the running note action but permits a different action and preserves source and errors',async()=>{
  const {fixture,page,emitted}=await mountNote('[Add](#sheet-input:command?type=button)',[
    {reference:'command',cellId:'A1',display:'0',value:0,editable:true,error:null,widget:{type:'button',action:'add',buttonMode:'action',actionArguments:{amount:{value:3}}}},
  ],{readOnly:true,interactive:true});
  const calls:unknown[]=[];const writes:unknown[]=[];
  fixture.componentInstance.actionInvoked.subscribe(value=>calls.push(value));
  fixture.componentInstance.widgetChange.subscribe(value=>writes.push(value));
  page.querySelector<HTMLButtonElement>('.rw-button')!.click();
  expect(calls).toEqual([{cellId:'A1',name:'add',arguments:{amount:{value:3}}}]);
  expect(writes).toEqual([]);expect(emitted).toEqual([]);
  fixture.componentRef.setInput('runningActions',['add','measure']);fixture.componentRef.setInput('actionBusy',false);fixture.detectChanges();
  expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(true);
  page.querySelector<HTMLButtonElement>('.rw-button')!.click();expect(calls).toHaveLength(1);
  fixture.componentRef.setInput('runningActions',['measure']);fixture.detectChanges();
  expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(false);
  fixture.componentRef.setInput('actionBusy',true);fixture.detectChanges();
  expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(true);
  fixture.componentRef.setInput('runningAction',null);fixture.componentRef.setInput('actionBusy',false);
  fixture.componentRef.setInput('actionFeedback',{cellId:'A1',name:'add',error:'Failed command'});fixture.detectChanges();
  expect(page.querySelector('[role="alert"]')!.textContent).toBe('Failed command');
  expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(false);
  page.querySelector<HTMLButtonElement>('.rw-button')!.click();expect(calls).toHaveLength(2);expect(writes).toEqual([]);
});


it.each(['file', 'folder'] as const)('uses the shared %s control and emits quoted path writes from Notes', async (type) => {
  const {fixture, page, emitted} = await mountNote('[Path](#sheet-input:path)', [
    {reference:'path', cellId:'A1', display:'', value:'', editable:true, error:null,
      widget:{type, label:'Choose path'}},
  ], {readOnly:true, interactive:true});
  const writes: Array<{cellId:string;source:string}> = [];
  fixture.componentInstance.widgetChange.subscribe(value => writes.push(value));
  await vi.waitFor(() => expect(page.querySelector('.rw-path input')).not.toBeNull());
  const field = page.querySelector<HTMLInputElement>('.rw-path input')!;
  field.value = '/tmp/a file.csv'; field.dispatchEvent(new Event('change'));
  expect(writes).toEqual([{cellId:'A1',source:'"/tmp/a file.csv"'}]);
  expect(emitted).toEqual([]);
});

it('toggles an input reference to its configured widget and back without writing the input', async () => {
  const {fixture, page, emitted} = await mountNote('File: **{{ path }}**', [
    {reference:'path',cellId:'A1',display:'/tmp/data.csv',value:'/tmp/data.csv',editable:true,error:null,
      widget:{type:'file',label:'Input file'}},
  ]);
  // TestBed hosts are detached by default; popovers require a mounted anchor.
  document.body.append(fixture.nativeElement);
  const writes = vi.fn(); fixture.componentInstance.widgetChange.subscribe(writes);
  page.querySelector<HTMLElement>('.cell-value-node')!.click();
  await vi.waitFor(() => expect([...document.querySelectorAll('.cell-popover button')].some(b => b.textContent === 'Show as widget')).toBe(true));
  [...document.querySelectorAll<HTMLButtonElement>('.cell-popover button')].find(b => b.textContent === 'Show as widget')!.click();
  await vi.waitFor(() => expect(page.querySelector('.rw-path input')).not.toBeNull());
  expect(page.querySelector<HTMLInputElement>('.rw-path input')!.value).toBe('/tmp/data.csv');
  await vi.waitFor(() => expect(emitted.at(-1)).toContain('#sheet-input:path'));
  expect(page.querySelector('strong .sheet-widget-node')).not.toBeNull();
  const editor = editorOf(fixture);
  editor.view.dispatch(closeHistory(editor.view.state.tr));
  page.querySelector<HTMLButtonElement>('[aria-label="Show as value"]')!.click();
  await vi.waitFor(() => expect(page.querySelector('.cell-value-node')).not.toBeNull());
  await vi.waitFor(() => expect(emitted.at(-1)).toContain('{{ path }}'));
  expect(page.querySelector('strong .cell-value-node')).not.toBeNull();
  // jsdom has no text layout; keep history's scroll request out of geometry APIs.
  editor.view.setProps({handleScrollToSelection: () => true});
  expect(undo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(page.querySelector('.sheet-widget-node')).not.toBeNull();
  expect(redo(editor.view.state, editor.view.dispatch)).toBe(true);
  expect(page.querySelector('.cell-value-node')).not.toBeNull();
  expect(writes).not.toHaveBeenCalled();
  fixture.nativeElement.remove();
});

it.each([
  {expression:'amount * 2', editable:true, readOnly:false},
  {expression:'amount', editable:false, readOnly:false},
  {expression:'amount', editable:true, readOnly:true},
])('keeps expression/noninput/reading references as values: %j', async ({expression,editable,readOnly}) => {
  const {fixture,page} = await mountNote(`{{ ${expression} }}`, [
    {reference:'amount',cellId:'A1',display:'3',value:3,editable,error:null},
  ], {readOnly});
  document.body.append(fixture.nativeElement);
  page.querySelector<HTMLElement>('.cell-value-node')!.click();
  await vi.waitFor(() => expect(document.querySelector('.cell-popover')).not.toBeNull());
  expect(document.querySelector('.cell-popover')!.textContent).not.toContain('Show as widget');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  fixture.nativeElement.remove();
});

it('applies a widget debounce: 0 writes every change at once, unset text waits for the commit', async () => {
  const {fixture,page} = await mountNote(
    '[Amount](#sheet-input:amount?debounce=0) [Name](#sheet-input:name) [Query](#sheet-input:query)', [
    {reference:'amount',cellId:'A1',display:'3',value:3,editable:true,error:null,widget:{type:'range',min:0,max:10}},
    {reference:'name',cellId:'A2',display:'a',value:'a',editable:true,error:null,widget:{type:'text'}},
    {reference:'query',cellId:'A3',display:'',value:'',editable:true,error:null,widget:{type:'text',debounce:0}},
  ]);
  const writes = vi.fn(); fixture.componentInstance.widgetChange.subscribe(writes);
  const slider = page.querySelector<HTMLInputElement>('input[type=range]')!;
  slider.value='7'; slider.dispatchEvent(new Event('input'));
  expect(writes).toHaveBeenLastCalledWith(expect.objectContaining({cellId:'A1', source:'7'}));
  const [name, query] = [...page.querySelectorAll<HTMLInputElement>('input[type=text]')];
  name.value='ab'; name.dispatchEvent(new Event('input'));
  query.value='sea'; query.dispatchEvent(new Event('input'));
  expect(writes).toHaveBeenCalledTimes(2);
  expect(writes).toHaveBeenLastCalledWith(expect.objectContaining({cellId:'A3', source:'"sea"'}));
  name.dispatchEvent(new Event('change'));
  expect(writes).toHaveBeenLastCalledWith(expect.objectContaining({cellId:'A2', source:'"ab"'}));
});

it('cancels a pending slider write when switching back to a value reference', async () => {
  const {fixture,page} = await mountNote('[Amount](#sheet-input:amount)', [
    {reference:'amount',cellId:'A1',display:'3',value:3,editable:true,error:null,widget:{type:'range',min:0,max:10}},
  ]);
  const writes = vi.fn(); fixture.componentInstance.widgetChange.subscribe(writes);
  const slider = page.querySelector<HTMLInputElement>('input[type=range]')!;
  slider.value='7'; slider.dispatchEvent(new Event('input'));
  page.querySelector<HTMLButtonElement>('[aria-label="Show as value"]')!.click();
  expect(page.querySelector('.sheet-widget-node')).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 450));
  expect(writes).not.toHaveBeenCalled();
});

it('keeps direct presentation controls across errors, recovery and editing-mode changes', async () => {
  const initial: MarkdownInterpolationValue = {
    reference:'path',cellId:'A1',display:'',value:'',editable:true,error:null,
    widget:{type:'file',label:'Input file'},
  };
  const {fixture,page} = await mountNote('File: {{ path }}',[initial]);
  const toggle = () => page.querySelector<HTMLButtonElement>('.cell-value-node > .reference-presentation');
  expect(toggle()?.textContent).toBe('Show as widget');
  const original = toggle();
  fixture.componentRef.setInput('values',[{...initial,error:'File setup failed'}]);fixture.detectChanges();
  await vi.waitFor(() => expect(page.textContent).toContain('File setup failed'));
  expect(toggle()).toBe(original);
  toggle()!.click();
  await vi.waitFor(() => expect(page.querySelector('.rw-path input')).not.toBeNull());
  expect(page.querySelector<HTMLInputElement>('.rw-path input')!.disabled).toBe(true);
  expect(page.textContent).toContain('File setup failed');
  const back = page.querySelector<HTMLButtonElement>('[aria-label="Show as value"]')!;
  expect(back.closest('.layout-toolbar')).toBeNull();
  fixture.componentRef.setInput('values',[{...initial,value:'/tmp/recovered.csv',display:'/tmp/recovered.csv'}]);fixture.detectChanges();
  await vi.waitFor(() => expect(page.querySelector<HTMLInputElement>('.rw-path input')?.disabled).toBe(false));
  expect(page.querySelector('[aria-label="Show as value"]')).toBe(back);
  fixture.componentRef.setInput('readOnly',true);fixture.detectChanges();
  await vi.waitFor(() => expect(page.querySelector('[aria-label="Show as value"]')).toBeNull());
  fixture.componentRef.setInput('readOnly',false);fixture.detectChanges();
  await vi.waitFor(() => expect(page.querySelector('[aria-label="Show as value"]')).toBe(back));
  back.click();
  expect(toggle()).not.toBeNull();
  fixture.componentRef.setInput('readOnly',true);fixture.detectChanges();
  await vi.waitFor(() => expect(toggle()).toBeNull());
  fixture.componentRef.setInput('readOnly',false);fixture.detectChanges();
  await vi.waitFor(() => expect(toggle()).not.toBeNull());
});

it.each([false, true])('renders the Guide code boxes from qualified references (reading=%s)', async readOnly => {
  const names = ['code_rate', 'code_payment', 'code_rate_link'];
  const {page} = await mountNote(names.map(name => `{{ Snippets.${name} }}`).join('\n\n'),
    names.map((name, index) => ({reference:`Snippets.${name}`,cellId:`Snippets!A${index + 1}`,
      display:'HTML output',error:null,editable:false,kind:'formula',
      richOutput:{mimeType:'text/html',dataBase64:btoa(`<pre>${name}</pre>`)}})), {readOnly});
  expect(page.querySelectorAll('reaktiv-html')).toHaveLength(3);
  expect(page.querySelectorAll('.reference-presentation')).toHaveLength(0);
});

it('renders opt-in note action cancellation without writing inputs or Markdown',async()=>{
  const {fixture,page,emitted}=await mountNote('[Measurement](#sheet-input:command?type=button)',[
    {reference:'command',cellId:'A1',display:'0',value:0,editable:true,error:null,widget:{type:'button',action:'measure',buttonMode:'action',cancelWhileRunning:true}},
  ],{readOnly:true,interactive:true});
  const calls:unknown[]=[];fixture.componentInstance.actionInvoked.subscribe(value=>calls.push(value));
  fixture.componentRef.setInput('runningActions',['measure']);fixture.detectChanges();
  const button=page.querySelector<HTMLButtonElement>('.rw-button')!;
  expect(button.disabled).toBe(false);expect(button.textContent).toContain('Cancel');button.click();
  expect(calls).toEqual([{cellId:'A1',name:'measure',arguments:{}}]);expect(emitted).toEqual([]);
  fixture.componentRef.setInput('cancellingActions',['measure']);fixture.detectChanges();
  expect(page.querySelector<HTMLButtonElement>('.rw-button')!.disabled).toBe(true);
  expect(page.textContent).toContain('Cancelling');
});
