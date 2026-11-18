import { describe, expect, it, vi } from 'vitest';
import {
  inferWidgetType,
  isRichWidget,
  stepValue,
  renderRichWidget,
  widgetSource,
  withInputComments,
} from './input-widgets';

describe('widgetSource', () => {
  it('writes Python literals', () => {
    expect(widgetSource(true, 'checkbox')).toBe('True');
    expect(widgetSource('0.25', 'range')).toBe('0.25');
    expect(widgetSource('Jul', 'select')).toBe('"Jul"');
    expect(widgetSource('line 1\nline "2"', 'textarea')).toBe('"line 1\\nline \\"2\\""');
    expect(widgetSource('2026-10-02', 'date')).toBe('"2026-10-02"');
    expect(widgetSource(['milk', 'bread & "butter"'], 'list')).toBe('["milk", "bread & \\"butter\\""]');
    expect(widgetSource([], 'multiselect')).toBe('[]');
    expect(widgetSource(4, 'button')).toBe('4');
    expect(widgetSource('abc', 'number')).toBeNull();
  });

  it('infers a widget from the value and keeps comments above the value', () => {
    expect(inferWidgetType(['a'])).toBe('list');
    expect(inferWidgetType([1, 2])).toBe('text');
    expect(inferWidgetType('a\nb')).toBe('textarea');
    expect(inferWidgetType(3)).toBe('number');
    expect(isRichWidget('list')).toBe(true);
    expect(isRichWidget('date')).toBe(false);
    expect(isRichWidget('file')).toBe(true);
    expect(isRichWidget('folder')).toBe(true);
    expect(widgetSource('C:\\data\\measurement.csv', 'file')).toBe(JSON.stringify('C:\\data\\measurement.csv'));
    expect(widgetSource('/tmp/folder with spaces', 'folder')).toBe(JSON.stringify('/tmp/folder with spaces'));
    expect(withInputComments('# rent per month\n1200', '1300')).toBe('# rent per month\n1300');
    expect(withInputComments('1200', '1300')).toBe('1300');
    expect(withInputComments('# only a comment', '1')).toBe('1');
  });
});

describe('renderRichWidget', () => {
  const model = (overrides: object) => ({ type: 'list' as const, label: 'Items', value: [], options: [], disabled: false, ...overrides });

  it('adds and removes list items', () => {
    const host = document.createElement('div');
    const change = vi.fn();
    renderRichWidget(host, model({ value: ['milk', 'bread'] }), change);
    expect([...host.querySelectorAll('li span')].map((item) => item.textContent)).toEqual(['milk', 'bread']);

    const field = host.querySelector<HTMLInputElement>('.rw-add input')!;
    field.value = '  eggs ';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(change).toHaveBeenLastCalledWith(['milk', 'bread', 'eggs']);
    expect(field.value).toBe('');

    field.value = '   ';
    host.querySelector<HTMLButtonElement>('.rw-add button')!.click();
    expect(change).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('.rw-remove')!.click();
    expect(change).toHaveBeenLastCalledWith(['bread']);
  });

  it('keeps the text being typed when results arrive', () => {
    const host = document.createElement('div');
    document.body.append(host);
    renderRichWidget(host, model({ value: ['milk'] }), vi.fn());
    const field = host.querySelector<HTMLInputElement>('.rw-add input')!;
    field.value = 'half-typed';
    field.focus();
    renderRichWidget(host, model({ value: ['milk', 'bread'] }), vi.fn());
    const next = host.querySelector<HTMLInputElement>('.rw-add input')!;
    expect(next.value).toBe('half-typed');
    expect(document.activeElement).toBe(next);
    host.remove();
  });

  it('selects several options in option order, counts clicks, and edits long text', () => {
    const host = document.createElement('div');
    const change = vi.fn();
    renderRichWidget(host, model({ type: 'multiselect', value: ['West'], options: ['North', 'South', 'West'] }), change);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((box) => box.checked)).toEqual([false, false, true]);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));
    expect(change).toHaveBeenLastCalledWith(['North', 'West']);

    renderRichWidget(host, model({ type: 'button', label: 'Refresh', value: 2 }), change);
    const button = host.querySelector<HTMLButtonElement>('.rw-button')!;
    expect(button.textContent).toBe('Refresh');
    button.click();
    expect(change).toHaveBeenLastCalledWith(3);

    renderRichWidget(host, model({ type: 'textarea', value: 'a\nb' }), change);
    const area = host.querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = 'c';
    area.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenLastCalledWith('c');

    renderRichWidget(host, model({ type: 'list', value: ['x'], disabled: true }), change);
    expect(host.querySelector<HTMLButtonElement>('.rw-remove')!.disabled).toBe(true);
  });
});

describe('stepValue', () => {
  it('steps by the step size within min and max, without float noise', () => {
    expect(stepValue(5, 1, { min: 0, max: 10, step: 1 })).toBe(6);
    expect(stepValue(0.2, 1, { step: 0.1 })).toBe(0.3);
    expect(stepValue(9.81, -1, { min: 1.6, step: 0.01 })).toBe(9.8);
    expect(stepValue(10, 1, { min: 0, max: 10, step: 1 })).toBe(10);
    expect(stepValue(0, -1, { min: 0 })).toBe(0);
    expect(stepValue(Number.NaN, 1, {})).toBe(1);
  });
});


describe('widget states and value preservation', () => {
  it('toggles Boolean state, counts every click, and blocks busy buttons', () => {
    const host=document.createElement('div'); const change=vi.fn();
    const model={type:'button' as const,label:'Run',value:false,options:[],disabled:false,buttonMode:'toggle' as const};
    renderRichWidget(host,model,change);
    const button=host.querySelector('button')!;
    button.click();button.click();
    expect(change.mock.calls).toEqual([[true],[false]]);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(widgetSource(true,'button','toggle')).toBe('True');
    change.mockClear();
    renderRichWidget(host,{...model,buttonMode:'count',value:0},change);
    host.querySelector('button')!.click();host.querySelector('button')!.click();
    expect(change.mock.calls).toEqual([[1],[2]]);
    renderRichWidget(host,{...model,loading:true,pressed:true},change);
    const busy=host.querySelector('button')!;
    expect(busy.disabled).toBe(true);expect(busy.getAttribute('aria-busy')).toBe('true');
    busy.click();expect(change).toHaveBeenCalledTimes(2);
  });

  it('keeps unavailable selections until the user removes them', () => {
    const host=document.createElement('div');const change=vi.fn();
    renderRichWidget(host,{type:'multiselect',label:'Choices',value:['old'],options:['new'],disabled:false},change);
    const boxes=host.querySelectorAll<HTMLInputElement>('input');
    expect(boxes[1].checked).toBe(true);expect(host.textContent).toContain('old (unavailable)');
    boxes[0].checked=true;boxes[0].dispatchEvent(new Event('change'));expect(change).toHaveBeenLastCalledWith(['new','old']);
    boxes[1].checked=false;boxes[1].dispatchEvent(new Event('change'));expect(change).toHaveBeenLastCalledWith(['new']);
  });
});

describe('single choice widgets', () => {
  it('writes one string value and keeps groups independent', () => {
    const left = document.createElement('div'), right = document.createElement('div');
    document.body.append(left, right);
    const change = vi.fn();
    const config = {type: 'radio' as const, label: 'Region', value: 'EU', options: ['EU', 'US'], disabled: false};
    renderRichWidget(left, config, change);
    renderRichWidget(right, config, vi.fn());
    expect(left.querySelector('[role=radiogroup]')?.getAttribute('aria-label')).toBe('Region');
    const radios = left.querySelectorAll<HTMLInputElement>('input');
    expect(radios[0].checked).toBe(true);
    expect(radios[0].name).not.toBe(right.querySelector('input')!.name);
    radios[1].click();
    expect(change).toHaveBeenCalledWith('US');
    expect(radios[0].checked).toBe(false);
    expect(widgetSource('US', 'radio')).toBe('"US"');
    renderRichWidget(left, {...config, disabled: true}, change);
    expect([...left.querySelectorAll('input')].every(input => input.disabled)).toBe(true);
    left.remove(); right.remove();
  });

  it('shows a missing selection without silently replacing its value', () => {
    const host = document.createElement('div'), change = vi.fn();
    renderRichWidget(host, {type:'radio',label:'Region',value:'EU',options:['US'],disabled:false}, change);
    expect(host.textContent).toContain('EU (unavailable)');
    expect(host.querySelector<HTMLInputElement>('input:checked')?.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });
});

describe('path widgets in the shared renderer', () => {
  it.each(['file','folder'] as const)('loads the %s renderer and writes a manual path', async type => {
    const host = document.createElement('div'); document.body.append(host);
    const change = vi.fn();
    renderRichWidget(host, {type, label:'Data path', value:'', options:[], disabled:false}, change);
    await vi.waitFor(() => expect(host.querySelector('input')).not.toBeNull());
    const field = host.querySelector('input')!;
    field.value = '/tmp/my data'; field.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith('/tmp/my data'); host.remove();
  });
});
