import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActivity } from './agent-activity';
import type { AgentCommand } from './live-agent-workbook';
import type { CellDefinition } from '../sheet.types';
const cell = (id: string, source = '1'): CellDefinition => ({id, source, kind: 'input', enabled: true, trigger: 'auto'});
const command = (operation: AgentCommand['operation'], payload: Record<string, unknown> = {}): AgentCommand =>
  ({id: crypto.randomUUID(), operation, payload, expiresAt: Date.now() + 60000});

afterEach(() => vi.useRealTimers());
describe('agent activity presentation', () => {
  it('pulses fast reads only for returned cells and expires them without changing source', async () => {
    vi.useFakeTimers();
    const cells = signal([cell('A1'), cell('B1')]);
    const activity = new AgentActivity(cells);
    const before = cells();
    const result = {cells: [cell('B1')]};
    expect(await activity.observe(command('inspect', {cellIds: ['B1']}), async () => result)).toBe(result);
    expect(activity.feedback().get('B1')?.activity).toBe('read');
    expect(activity.feedback().has('A1')).toBe(false);
    expect(activity.entries()[0]).toMatchObject({status: 'completed', cellIds: ['B1'], cellCount: 1});
    vi.advanceTimersByTime(1600);
    expect(activity.feedback().size).toBe(0); expect(cells()).toBe(before);
    activity.reset();
  });
  it('marks actual creates/edits, preserves created attribution across agent edits and respects undo/user edits', () => {
    const original = [cell('A1')], changed = [cell('A1', '2'), cell('B1')];
    const cells = signal(original), activity = new AgentActivity(cells);
    cells.set(changed); activity.recordChanges(original, changed);
    expect(activity.feedback().get('A1')?.origin).toBe('edited');
    expect(activity.feedback().get('B1')?.origin).toBe('created');
    const edited = [changed[0], cell('B1', '3')];
    cells.set(edited); activity.recordChanges(changed, edited);
    expect(activity.feedback().get('B1')?.origin).toBe('created');
    cells.set(original); expect(activity.feedback().size).toBe(0);
    cells.set(edited); expect(activity.created()).toBe(1); expect(activity.edited()).toBe(1);
    cells.set([cell('A1', '99'), cell('B1', '99')]); expect(activity.feedback().size).toBe(0);
    activity.reset();
  });
  it('keeps overlapping requests active independently and records failures without marking cells', async () => {
    const cells = signal([cell('A1'), cell('B1')]), activity = new AgentActivity(cells);
    let finish!: (value: Record<string, unknown>) => void;
    const write = activity.observe(command('edit', {cells: [cell('A1', '2')]}), () => new Promise(resolve => {finish = resolve;}));
    await activity.observe(command('inspect', {cellIds: ['A1']}), async () => ({cells: [cell('A1')]}));
    expect(activity.pending()).toBe(1); expect(activity.feedback().get('A1')?.activity).toBe('write');
    finish({}); await write;
    await expect(activity.observe(command('edit', {cells: [cell('B1', '2')]}), async () => {throw new Error('Draft conflict');})).rejects.toThrow('Draft conflict');
    expect(activity.entries()[0]).toMatchObject({status: 'failed', error: 'Draft conflict'});
    expect(activity.created()).toBe(0); expect(activity.edited()).toBe(0);
    activity.reset();
  });
  it('bounds activity history and ignores late completions after document replacement', async () => {
    vi.useFakeTimers();
    const activity = new AgentActivity(() => [cell('A1')]);
    for (let n = 0; n < 60; n++) await activity.observe(command('read'), async () => ({}));
    expect(activity.entries()).toHaveLength(50);
    let finish!: (value: Record<string, unknown>) => void;
    const pending = activity.observe(command('read'), () => new Promise(resolve => {finish = resolve;}));
    activity.reset(); finish({}); await pending; vi.runAllTimers();
    expect(activity.entries()).toHaveLength(0); expect(activity.feedback().size).toBe(0); expect(activity.pending()).toBe(0);
  });
});
