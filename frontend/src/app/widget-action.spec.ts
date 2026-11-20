import { copiedCellsSource } from '../../../tests/python-writer';
import { describe, it, expect, vi } from 'vitest';
import { actionWidgetState, remapWidgetActionBindings } from './widget-action';
import { renderRichWidget, widgetSource } from './input-widgets';
import { ActionArgumentsComponent } from './action-arguments.component';
import { duplicateSheet } from './sheet-file';
import type { CellDefinition } from './sheet.types';

describe('button action intent', () => {
  it('blocks only the running action while allowing other actions and explicit guards', () => {
    const host = document.createElement('div');
    const change = vi.fn();
    const invoke = vi.fn();
    const widget = {
      type: 'button' as const,
      buttonMode: 'action' as const,
      action: 'add',
      label: 'Add',
      value: 10,
      options: [],
      disabled: false,
    };
    renderRichWidget(host, widget, change, invoke);
    host.querySelector('button')!.click();
    expect(invoke).toHaveBeenCalledWith('add');
    expect(change).not.toHaveBeenCalled();
    expect(widgetSource(10, 'button', 'action')).toBeNull();
    renderRichWidget(host, actionWidgetState(widget, 'A1', ['add', 'measure'], false, null), change, invoke);
    expect(host.querySelector('button')!.getAttribute('aria-busy')).toBe('true');
    host.querySelector('button')!.click();
    expect(invoke).toHaveBeenCalledTimes(1);
    renderRichWidget(
      host,
      actionWidgetState(widget, 'A1', null, false, {
        cellId: 'A1',
        name: 'add',
        error: 'Failed; retry',
      }),
      change,
      invoke,
    );
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('retry');
    expect(host.querySelector('button')!.disabled).toBe(false);
    host.querySelector('button')!.click();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(change).not.toHaveBeenCalled();
    renderRichWidget(host, actionWidgetState(widget, 'A1', ['measure','export'], false, null), change, invoke);
    expect(host.querySelector('button')!.disabled).toBe(false);
  });
  it('preserves arguments through copies and distinguishes cell bindings from coordinate-looking literals', () => {
    const view = {
      widget: {
        type: 'button' as const,
        action: 'add',
        actionArguments: { amount: { cell: 'A1' }, message: { value: 'A1' } },
      },
    };
    const remapped = remapWidgetActionBindings(view, (id) => 'Other!' + id)!;
    expect(remapped.widget!.actionArguments).toEqual({
      amount: { cell: 'Other!A1' },
      message: { value: 'A1' },
    });
    const cells: CellDefinition[] = [
      { id: 'A1', kind: 'input', source: '3', enabled: true },
      { id: 'B1', kind: 'input', source: '0', enabled: true, view },
    ];
    const { copies } = duplicateSheet(
      cells,
      { name: 'Sheet1', prefix: '' },
      { name: 'Copy', prefix: 'Copy' },
      ['Sheet1', 'Copy'],
    );
    expect(copies[1].view!.widget!.actionArguments!['amount']).toEqual({ cell: 'Copy!A1' });
    const copied = copiedCellsSource(copies);
    expect(copied).toContain('"cell": "A1"');
  });
});

describe('per-button action arguments', () => {
  it('supports inheritance, method defaults, literal values and live cell bindings', () => {
    const form = new ActionArgumentsComponent();
    form.parameters = [{ name: 'amount', annotation: 'int', required: false, default: 2 }];
    form.ngOnChanges();
    const changed = vi.fn();
    form.changed.subscribe(changed);
    form.publish();
    expect(changed).toHaveBeenLastCalledWith({});
    form.fields['amount'].mode = 'default';
    form.publish();
    expect(changed).toHaveBeenLastCalledWith({ amount: { default: true } });
    form.fields['amount'] = { mode: 'literal', text: '10', cell: '' };
    form.publish();
    expect(changed).toHaveBeenLastCalledWith({ amount: { value: 10 } });
    form.fields['amount'].text = '1.2';
    form.publish();
    expect(form.error).toContain('integer');
    expect(changed).toHaveBeenCalledTimes(3);
    form.fields['amount'] = { mode: 'cell', text: '', cell: 'Budget!A1' };
    form.publish();
    expect(changed).toHaveBeenLastCalledWith({ amount: { cell: 'Budget!A1' } });
  });
});

it('offers cancellation only when enabled and disables repeat cancellation until completion',()=>{
  const host=document.createElement('div'),change=vi.fn(),invoke=vi.fn();
  const widget={type:'button' as const,buttonMode:'action' as const,action:'measure',cancelWhileRunning:true,label:'Measurement',value:0,options:[],disabled:false};
  renderRichWidget(host,actionWidgetState(widget,'A1',['measure','export'],false,null),change,invoke);
  const button=host.querySelector('button')!;expect(button.disabled).toBe(false);expect(button.textContent).toBe('Cancel Measurement');
  button.click();expect(invoke).toHaveBeenCalledWith('measure');expect(change).not.toHaveBeenCalled();
  renderRichWidget(host,actionWidgetState(widget,'A1',['measure'],false,null,['measure']),change,invoke);
  expect(host.querySelector('button')!.disabled).toBe(true);expect(host.textContent).toContain('Cancelling');
  renderRichWidget(host,actionWidgetState(widget,'A1',[],false,null),change,invoke);
  expect(host.querySelector('button')!.textContent).toBe('Measurement');expect(host.querySelector('button')!.disabled).toBe(false);
  expect(actionWidgetState({...widget,disabled:true},'A1',['measure'],false,null).disabled).toBe(true);
});
