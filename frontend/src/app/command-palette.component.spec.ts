import { TestBed } from '@angular/core/testing';
import { CommandPaletteComponent, matchesCommand, type PaletteCommand } from './command-palette.component';

describe('command palette', () => {
  const commands = (ran: string[]): PaletteCommand[] => [
    { id: 'save', group: 'File', label: 'Save', run: () => ran.push('save') },
    { id: 'open', group: 'File', label: 'Open workbook…', run: () => ran.push('open') },
    { id: 'run-add', group: 'Actions', label: 'Run action: Add items', run: () => ran.push('add') },
    { id: 'redo', group: 'Workbook', label: 'Redo', disabled: true, run: () => ran.push('redo') },
  ];

  it('matches every typed word in label or group', () => {
    const [save, open, add] = commands([]);
    expect(matchesCommand(add, 'add run')).toBe(true);
    expect(matchesCommand(open, 'file wor')).toBe(true);
    expect(matchesCommand(save, 'save open')).toBe(false);
  });

  it('filters, moves with the arrow keys, runs with Enter and never runs disabled commands', async () => {
    const ran: string[] = [];
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    fixture.componentRef.setInput('commands', commands(ran));
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const search = root.querySelector<HTMLInputElement>('input[aria-label="Search commands"]')!;
    expect(root.querySelectorAll('[role="option"]')).toHaveLength(4);
    search.value = 'file';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect([...root.querySelectorAll('[role="option"]')].map(item => item.textContent?.trim())).toEqual(['Save', 'Open workbook…']);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ran).toEqual(['open']);
    expect(closed).toBe(1);
    search.value = 'redo';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ran).toEqual(['open']);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // closes even with text typed
    expect(closed).toBe(2);
  });
});
