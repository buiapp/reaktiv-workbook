import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DebugConsoleComponent } from './debug-console.component';
import { RuntimeService } from './runtime.service';

describe('Python debug console', () => {
  it('runs multiline commands on the selected sheet and retains error output', async () => {
    const runtime = {consoleSession: signal(0), status: signal('ready'), kernel: signal('remote'), runConsole: vi.fn().mockResolvedValue({output: 'before\n', stderr: '', display: '', error: 'ZeroDivisionError'})};
    await TestBed.configureTestingModule({imports: [DebugConsoleComponent], providers: [{provide: RuntimeService, useValue: runtime}]}).compileComponents();
    const fixture = TestBed.createComponent(DebugConsoleComponent);
    fixture.componentRef.setInput('enabled', true); fixture.componentRef.setInput('sheet', 'Budget');
    fixture.detectChanges();
    fixture.componentInstance.source.set('print(rate)\n1 / 0');
    await fixture.componentInstance.run(); fixture.detectChanges();
    expect(runtime.runConsole).toHaveBeenCalledWith('print(rate)\n1 / 0', 'Budget');
    expect(fixture.nativeElement.textContent).toContain('before');
    expect(fixture.nativeElement.textContent).toContain('ZeroDivisionError');
    runtime.consoleSession.set(1); fixture.detectChanges();
    expect(fixture.componentInstance.entries()).toHaveLength(0);
    fixture.destroy();
  });
  it('shows submitted commands immediately, preserves next input and recalls history after clearing output', async () => {
    let finish!: (result: {output: string; stderr: string; display: string; error: null}) => void;
    const runtime = {consoleSession: signal(0), status: signal('ready'), kernel: signal('remote'), runConsole: vi.fn(() => new Promise(resolve => {finish = resolve;}))};
    await TestBed.configureTestingModule({imports: [DebugConsoleComponent], providers: [{provide: RuntimeService, useValue: runtime}]}).compileComponents();
    const fixture = TestBed.createComponent(DebugConsoleComponent);
    fixture.componentRef.setInput('enabled', true); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.source.set('x = 3'); const running = component.run();
    expect(component.entries()[0].source).toBe('x = 3');
    expect(component.entries()[0].result).toBeNull();
    component.source.set('x + 1');
    finish({output: '', stderr: '', display: '', error: null}); await running;
    expect(component.source()).toBe('x + 1');
    component.entries.set([]); component.recall(-1);
    expect(component.source()).toBe('x = 3');
    component.recall(1); expect(component.source()).toBe('x + 1');
    runtime.consoleSession.set(1); fixture.detectChanges();
    component.recall(-1); expect(component.source()).toBe('');
    fixture.destroy();
  });

});
