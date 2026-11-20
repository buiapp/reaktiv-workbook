import { TestBed } from '@angular/core/testing';
import { CellDropPreviewComponent } from './cell-drop-preview.component';
import { previewCellMove } from './cell-placement';
import type { CellDefinition } from './sheet.types';

it('outlines the full footprint in grid coordinates with custom row/column sizes and an invalid reason', () => {
  const fixture = TestBed.createComponent(CellDropPreviewComponent);
  const cells: CellDefinition[] = [
    {id: 'A1', kind: 'input', source: '1', enabled: true, view: {span: [2, 2]}},
    {id: 'E1', kind: 'input', source: '2', enabled: true},
  ];
  for (const [name, value] of Object.entries({sheet: '', columns: ['A','B','C','D','E','F'], rows: [1,2,3,4,5],
    columnWidths: {B: 160}, rowHeights: {'3': 80}, preview: previewCellMove(cells, 'A1', 'B3', ['A1'])}))
    fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  let box = host.querySelector<HTMLElement>('.footprint')!;
  expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['150px','122px','272px','125px']);
  expect(host.textContent).toContain('B3'); expect(host.textContent).toContain('Move');
  fixture.componentRef.setInput('preview', previewCellMove(cells, 'E1', 'B2', ['E1']));
  fixture.detectChanges();
  box = host.querySelector<HTMLElement>('.footprint')!;
  expect(box.classList.contains('invalid')).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('overlap');
  fixture.destroy();
});
