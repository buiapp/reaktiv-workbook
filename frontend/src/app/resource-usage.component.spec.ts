import { TestBed } from '@angular/core/testing';
import { ResourceUsageComponent } from './resource-usage.component';

describe('workbook resource usage', () => {
  it('shows CPU across multiple cores and resident memory with details', async () => {
    await TestBed.configureTestingModule({ imports: [ResourceUsageComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ResourceUsageComponent);
    fixture.componentRef.setInput('usage', { cpuPercent: 175.5, memoryBytes: 2 * 1024 ** 3, memoryKind: 'resident' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('summary').textContent).toContain('Kernel RAM 2.00 GiB · CPU 175.5%');
    fixture.nativeElement.querySelector('details').open = true;
    fixture.componentInstance.reposition();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('App windows and child processes are excluded');
    fixture.destroy();
  });

  it('labels browser heap explicitly and leaves CPU unavailable', async () => {
    await TestBed.configureTestingModule({ imports: [ResourceUsageComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ResourceUsageComponent);
    fixture.componentRef.setInput('usage', { cpuPercent: null, memoryBytes: 128 * 1024 ** 2, memoryKind: 'wasm' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('summary').textContent).toContain('Heap 128 MiB · CPU —');
    fixture.nativeElement.querySelector('details').open = true;
    fixture.componentInstance.reposition();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('browser does not expose CPU usage');
    fixture.componentRef.setInput('usage', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('summary').textContent).toContain('Kernel RAM — · CPU —');
    fixture.destroy();
  });
  it('opens cell performance and closes the popup before navigating', async () => {
    await TestBed.configureTestingModule({ imports: [ResourceUsageComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ResourceUsageComponent);
    fixture.componentRef.setInput('results', [{ id: 'Other!B2', display: '42', value: 42, valueType: 'int', error: null, durationMs: 1200 }]);
    const navigate = vi.fn();
    fixture.componentInstance.navigate.subscribe(navigate);
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('details');
    details.open = true;
    fixture.componentInstance.reposition();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cell performance');
    fixture.nativeElement.querySelector('app-cell-performance button').click();
    expect(details.open).toBe(false);
    expect(navigate).toHaveBeenCalledWith('Other!B2');
    fixture.destroy();
  });

});
