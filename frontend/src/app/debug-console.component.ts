import { ChangeDetectionStrategy, Component, input, output, inject, signal, effect, viewChild, ElementRef, afterNextRender, Injector } from '@angular/core';
import { PythonEditorComponent, type PythonCompletion } from './python-editor.component';
import { RuntimeService } from './runtime.service';
import type { ConsoleResult } from './sheet.types';

@Component({
  selector: 'app-debug-console',
  imports: [PythonEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Python debug console">
      <header><strong>Python console</strong><span>{{ sheet() || 'First sheet' }}</span>
        <button type="button" (click)="entries.set([])">Clear output</button>
        <button type="button" aria-label="Close Python console" (click)="closed.emit()">×</button>
      </header>
      <div class="history" #history role="log" aria-label="Console output" aria-live="polite">
        @for (entry of entries(); track $index) {
          <article><pre class="command">{{ prompt(entry.source) }}</pre>
            @if (entry.result?.output) { <pre>{{ entry.result!.output }}</pre> }
            @if (entry.result?.stderr) { <pre class="error">{{ entry.result!.stderr }}</pre> }
            @if (entry.result?.display) { <pre>{{ entry.result!.display }}</pre> }
            @if (entry.result?.error) { <pre class="error">{{ entry.result!.error }}</pre> }
            @if (!entry.result) { <span class="pending">Running…</span> }
          </article>
        } @empty { <p>Explore live values by cell label or coordinate. Try A1, np.shape(A1), or cells.keys().</p> }
      </div>
      <div class="prompt" (click)="editor()?.focus()"><span aria-hidden="true">&gt;&gt;&gt;</span>
        <app-python-editor [value]="source()" (valueChange)="source.set($event)" [consoleMode]="true" [autoFocus]="visible()" [completions]="completions()" ariaLabel="Python console command" [readOnly]="!enabled()" [resizable]="false" (commit)="run()" (historyStep)="recall($event)" (cancelCommand)="cancel()" />
        <button type="button" aria-label="Execute Python command" title="Execute (Enter)" (click)="run()" [disabled]="busy() || !enabled() || runtime.status() !== 'ready' || !source().trim()">↵</button>
      </div>
      <footer><small>{{ enabled() ? 'Enter to execute · Shift+Enter for a new line · ↑↓ history · _ last result' : 'Start Python to use the console' }}</small>
        @if (busy()) {
          <button type="button" (click)="stop()">{{ runtime.kernel() === 'pyodide' ? 'Stop & restart Python' : 'Interrupt' }}</button>
        }
      </footer>
    </section>
  `,
  styles: `
    :host { display: block; height: 100%; min-height: 0; background: var(--paper); }
    :host([hidden]) { display: none; }
    section { padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; box-sizing: border-box; }
    header, footer { display: flex; gap: 12px; align-items: center; flex: 0 0 auto; }
    header span, footer small { flex: 1; color: var(--muted); min-width: 0; }
    button { font: inherit; cursor: pointer; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink); }
    button:disabled { opacity: .5; cursor: default; }
    .history { overflow: auto; flex: 1; min-height: 0; }
    article { padding: 4px 0; }
    pre { margin: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, monospace; }
    .command, .prompt > span { color: var(--purple); } .error { color: var(--danger); }
    p, small, .pending { font-size: 11px; color: var(--muted); }
    .prompt { display: flex; align-items: start; gap: 10px; border-top: 1px solid var(--line); padding-top: 4px; flex: 0 0 auto; }
    .prompt > span { font: 12px/1.55 ui-monospace, monospace; padding-top: 6px; }
    app-python-editor { flex: 1; min-width: 0; max-height: 130px; overflow: auto; }
    .prompt button { margin-top: 2px; }
  `,
})
export class DebugConsoleComponent {
  readonly runtime = inject(RuntimeService);
  private readonly injector = inject(Injector);
  readonly enabled = input(false);
  readonly visible = input(true);
  readonly completions = input<readonly PythonCompletion[]>([]);
  readonly sheet = input('');
  readonly closed = output<void>();
  readonly resetRequested = output<void>();
  readonly executed = output<void>();
  readonly editor = viewChild(PythonEditorComponent);
  private readonly history = viewChild<ElementRef<HTMLElement>>('history');
  readonly source = signal('');
  readonly busy = signal(false);
  readonly entries = signal<Array<{source: string; result: ConsoleResult | null}>>([]);
  private commands: string[] = [];
  private historyIndex = 0;
  private savedInput = '';

  private readonly resetSession = effect(() => {
    this.runtime.consoleSession();
    this.entries.set([]);
    this.source.set('');
    this.busy.set(false);
    this.commands = [];
    this.historyIndex = 0;
    this.savedInput = '';
  });
  private readonly scrollOutput = effect(() => {
    this.entries();
    afterNextRender(() => { const element = this.history()?.nativeElement; if (element) element.scrollTop = element.scrollHeight; }, {injector: this.injector});
  });

  prompt(source: string): string { return source.split('\n').map((line, index) => `${index ? '...' : '>>>'} ${line}`).join('\n'); }

  recall(step: number): void {
    if (!this.commands.length) return;
    if (this.historyIndex === this.commands.length) this.savedInput = this.source();
    this.historyIndex = Math.max(0, Math.min(this.commands.length, this.historyIndex + step));
    this.source.set(this.commands[this.historyIndex] ?? this.savedInput);
  }

  cancel(): void {
    if (this.busy()) void this.stop();
    else { this.source.set(''); this.historyIndex = this.commands.length; this.savedInput = ''; }
  }

  async run(): Promise<void> {
    const source = this.source().trim();
    if (!source || this.busy() || !this.enabled() || this.runtime.status() !== 'ready') return;
    const session = this.runtime.consoleSession();
    this.busy.set(true);
    if (this.commands.at(-1) !== source) this.commands = [...this.commands.slice(-99), source];
    this.historyIndex = this.commands.length;
    this.savedInput = '';
    this.source.set('');
    const entry = {source, result: null as ConsoleResult | null};
    this.entries.update(entries => [...entries.slice(-49), entry]);
    const finish = (result: ConsoleResult) => this.entries.update(entries => entries.map(item => item === entry ? {...item, result} : item));
    try {
      const result = await this.runtime.runConsole(source, this.sheet());
      if (session !== this.runtime.consoleSession()) return;
      finish(result);
      this.executed.emit();
    } catch (error) {
      if (session !== this.runtime.consoleSession()) return;
      finish({output: '', stderr: '', display: '', error: String(error)});
    } finally { if (session === this.runtime.consoleSession()) this.busy.set(false); }
  }

  async stop(): Promise<void> {
    if (this.runtime.kernel() === 'pyodide') this.resetRequested.emit();
    else await this.runtime.interruptConsole().catch(() => undefined);
  }
}
