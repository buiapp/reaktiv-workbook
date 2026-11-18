import { ChangeDetectionStrategy, Component, computed, input, output, signal, inject, ElementRef } from '@angular/core';
import { KeepInViewDirective } from './keep-in-view';
import { CellPerformanceComponent } from './cell-performance.component';
import type { CellDefinition, CellResult, ResourceUsage } from './sheet.types';

/** Per-workbook readings. Details explain what is measured, including browser limits. */
@Component({
  selector: 'app-resource-usage',
  imports: [KeepInViewDirective, CellPerformanceComponent],
  host: { '(document:click)': 'closeOutside($event)', '(document:keydown.escape)': 'close()', '(window:resize)': 'reposition()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details (toggle)="reposition()">
      <summary aria-label="Python kernel CPU and memory usage" title="Python kernel usage and cell performance; excludes app and webview memory">
        <span class="readings">{{ memoryLabel() }} · CPU {{ cpuLabel() }}</span>
        <span class="compact">Usage</span>
      </summary>
      @if (anchor(); as point) {
      <div class="usage-details" [appKeepInView]="point">
        <strong>Workbook resource usage</strong>
        <p>{{ memoryLabel() }} · CPU {{ cpuLabel() }}</p>
        @if (usage()?.memoryKind === 'wasm') {
          <p>Allocated Python heap. The browser does not expose CPU usage or resident RAM for individual workbooks.</p>
        } @else {
          <p>Python kernel process, including its runtime and loaded packages. App windows and child processes are excluded.</p>
          <p>CPU is averaged between samples. 100% means one full CPU core; multiple cores can exceed 100%.</p>
        }
        <small>Usage updates every 2 seconds while this window is visible. — means unavailable or waiting for a sample.</small>
        <app-cell-performance [cells]="cells()" [results]="results()" (navigate)="inspect($event)" />
      </div>
      }
    </details>
  `,
  styles: `
    :host { flex: none; }
    details { position: relative; }
    summary { cursor: pointer; list-style: none; width: 204px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
    summary::-webkit-details-marker { display: none; }
    summary:hover, details[open] summary { color: var(--purple); }
    .compact { display: none; }
    .usage-details { position: fixed; width: min(460px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: light-dark(#fff, #20221f); color: var(--muted); box-shadow: 0 6px 24px light-dark(#0002, #0006); z-index: 30; line-height: 1.5; }
    strong { color: var(--ink); }
    p { margin: 8px 0; }
    @media (max-width: 900px) { summary { width: 42px; } .readings { display: none; } .compact { display: inline; } }
  `,
})
export class ResourceUsageComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly anchor = signal<{ x: number; y: number } | null>(null);

  reposition(): void {
    const details = this.element.querySelector('details');
    const rect = details?.querySelector('summary')?.getBoundingClientRect();
    this.anchor.set(details?.open && rect ? { x: rect.right, y: rect.top - 8 } : null);
  }

  close(): void {
    const details = this.element.querySelector('details');
    if (details) details.open = false;
    this.anchor.set(null);
  }

  closeOutside(event: Event): void {
    if (event.target instanceof Node && !this.element.contains(event.target)) this.close();
  }

  readonly cells = input<readonly CellDefinition[]>([]);
  readonly results = input<readonly CellResult[]>([]);
  readonly navigate = output<string>();
  inspect(id: string): void { this.close(); this.navigate.emit(id); }
  readonly usage = input<ResourceUsage | null>(null);
  readonly cpuLabel = computed(() => {
    const cpu = this.usage()?.cpuPercent;
    return cpu == null ? '—' : `${cpu.toFixed(1)}%`;
  });
  readonly memoryLabel = computed(() => {
    const usage = this.usage();
    const label = usage?.memoryKind === 'wasm' ? 'Heap' : 'Kernel RAM';
    const bytes = usage?.memoryBytes;
    if (bytes == null) return `${label} —`;
    return bytes >= 1024 ** 3
      ? `${label} ${(bytes / 1024 ** 3).toFixed(2)} GiB`
      : `${label} ${(bytes / 1024 ** 2).toFixed(0)} MiB`;
  });
}
