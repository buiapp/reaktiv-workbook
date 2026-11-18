import { signal } from '@angular/core';
import { vi } from 'vitest';
import { createSheetDocument } from '../sheet-file';
import type { GraphResult } from '../sheet.types';
import { WorkbookCommandQueue } from '../workbook-command-queue';
import { WorkbookState } from '../workbook/workbook-state';
import { ActionWorkspace, type ActionWorkspacePorts } from './action-workspace';

describe('ActionWorkspace lifetime', () => {
  it('does not publish or settle a retired workbook action into a new workbook', async () => {
    const state = new WorkbookState();
    const commands = new WorkbookCommandQueue();
    let finish!: (graph: GraphResult) => void;
    let receive!: (graph: GraphResult) => void;
    const unsubscribe = vi.fn();
    const ports: ActionWorkspacePorts = {
      state,
      commands,
      runtime: {
        status: signal('ready'),
        onSnapshot: listener => { receive = listener; return unsubscribe; },
        updateAction: async definition => ({...state.graph(), appliedAction: definition}),
        noteMoveDocument: vi.fn(),
        runAction: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        cancelAction: async () => {},
      },
      document: () => createSheetDocument('test', 4, 8, []),
      requireKernel: () => true,
      recordHistory: vi.fn(),
      evaluate: async () => {},
      acceptGraph: vi.fn(),
      acceptLiveGraph: vi.fn(),
      flash: vi.fn(),
      settle: vi.fn(),
      runEffect: async () => {},
    };
    const actions = new ActionWorkspace(ports);
    const pending = actions.invoke({ name: 'old', arguments: {} });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    receive(state.graph());
    expect(ports.acceptLiveGraph).toHaveBeenCalledOnce();
    commands.reset();
    receive(state.graph());
    expect(ports.acceptLiveGraph).toHaveBeenCalledOnce();
    actions.runningAction.set('new-workbook-action');
    finish(state.graph());
    await pending;
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(ports.acceptGraph).not.toHaveBeenCalled();
    expect(ports.settle).not.toHaveBeenCalled();
    expect(actions.runningAction()).toBe('new-workbook-action');
    expect(actions.actionError()).toBe('');
  });
});

it('allows different actions, refuses duplicates, shares frames and settles after the last completion',async()=>{
  const state=new WorkbookState(),commands=new WorkbookCommandQueue();
  const finishes=new Map<string,(graph:GraphResult)=>void>();
  let receive!:(graph:GraphResult)=>void;
  const unsubscribe=vi.fn(), subscribe=vi.fn((listener:(graph:GraphResult)=>void)=>{receive=listener;return unsubscribe;});
  const ports:ActionWorkspacePorts={
    state,commands,
    runtime:{status:signal('ready'),onSnapshot:subscribe,updateAction:async()=>state.graph(),noteMoveDocument:vi.fn(),
      runAction:(_name,_arguments,id)=>new Promise(resolve=>finishes.set(id!,resolve)),cancelAction:vi.fn(async()=>{})},
    document:()=>createSheetDocument('test',4,8,[]),requireKernel:()=>true,recordHistory:vi.fn(),evaluate:async()=>{},
    acceptGraph:vi.fn(),acceptLiveGraph:vi.fn(),flash:vi.fn(),settle:vi.fn(),runEffect:async()=>{},
  };
  const actions=new ActionWorkspace(ports);
  const first=actions.invoke({name:'measure',arguments:{}}),second=actions.invoke({name:'export',arguments:{}});
  await vi.waitFor(()=>expect(finishes.size).toBe(2));
  await actions.invoke({name:'measure',arguments:{}});
  expect(finishes.size).toBe(2);
  expect(actions.actionError()).toContain('already running');
  const [one,two]=actions.invocations();
  expect(one.id).not.toBe(two.id);expect(subscribe).toHaveBeenCalledTimes(1);
  receive(state.graph());expect(ports.acceptLiveGraph).toHaveBeenCalledTimes(1);
  await actions.cancel('measure',one.id);
  expect(ports.runtime.cancelAction).toHaveBeenCalledWith('measure',one.id);
  await actions.cancel('measure',one.id);expect(ports.runtime.cancelAction).toHaveBeenCalledTimes(1);
  expect(actions.cancellingIds().has(one.id)).toBe(true);
  finishes.get(one.id)!(state.graph());await first;
  expect(actions.cancellingIds().has(one.id)).toBe(false);
  expect(actions.runningAction()).toBe('export');expect(actions.invocations()).toEqual([two]);
  expect(ports.settle).not.toHaveBeenCalled();expect(unsubscribe).not.toHaveBeenCalled();
  finishes.get(two.id)!(state.graph());await second;
  expect(actions.runningAction()).toBeNull();expect(ports.settle).toHaveBeenCalledTimes(1);expect(unsubscribe).toHaveBeenCalledTimes(1);
});
