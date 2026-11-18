import { TestBed } from '@angular/core/testing';
import { CellPerformanceComponent } from './cell-performance.component';
import type { CellResult } from './sheet.types';

describe('cell performance hints', () => {
  const result = (id: string, fields: Partial<CellResult> = {}): CellResult => ({
    id, value: null, display: '', valueType: 'int', error: null, ...fields,
  });
  async function setup(results: CellResult[]) {
    await TestBed.configureTestingModule({ imports: [CellPerformanceComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CellPerformanceComponent);
    fixture.componentRef.setInput('results', results);
    fixture.detectChanges();
    return fixture;
  }
  it('ranks cached executions across sheets and navigates to the chosen cell', async () => {
    const fixture = await setup([result('A1', { durationMs: 2 }), result('PLC!B2', { durationMs: 2000 }), result('C1')]);
    fixture.componentRef.setInput('cells', [{ id: 'PLC!B2', name: 'spectrum' }]);
    const navigate = vi.fn();
    fixture.componentInstance.navigate.subscribe(navigate);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('li button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('PLC!B2 · spectrum');
    expect(buttons[0].textContent).toContain('2.00 s');
    buttons[0].click();
    expect(navigate).toHaveBeenCalledWith('PLC!B2');
    expect(fixture.nativeElement.textContent).toContain('Cached last execution');
    fixture.destroy();
  });
  it('separates output preparation from evaluation and rich output size', async () => {
    const fixture = await setup([
      result('A1', { durationMs: 900, outputPreparationMs: 1 }),
      result('B1', { durationMs: 2, outputPreparationMs: 400, richOutput: { mimeType: 'text/html', dataBase64: 'AAAA' } }),
    ]);
    const select = fixture.nativeElement.querySelector('select');
    select.value = 'output'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('li button').textContent).toContain('B1');
    expect(fixture.nativeElement.querySelector('li strong').textContent).toBe('400.0 ms');
    select.value = 'size'; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(1);
    expect(fixture.nativeElement.querySelector('li strong').textContent).toBe('4 chars');
    fixture.destroy();
  });
  it('bounds the list, handles older kernels, and never serializes cell values', async () => {
    const value = { toJSON: () => { throw new Error('must not serialize'); } };
    const fixture = await setup(Array.from({ length: 20 }, (_, i) => result(`A${i + 1}`, { durationMs: i, value })));
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(10);
    fixture.componentInstance.metric.set('output'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No measurements available');
    fixture.componentRef.setInput('results', [result('A1', { durationMs: NaN }), result('B1', { durationMs: -1 })]);
    fixture.componentInstance.metric.set('evaluation'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(0);
    fixture.destroy();
  });
});
