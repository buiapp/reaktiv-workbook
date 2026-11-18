import { EXAMPLE_LEVELS, type ExampleLevel, type ExampleWorkbook } from './examples';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

type View = 'sheet' | 'notes' | 'split' | 'graph';
type Tour = 'overview' | 'concepts';
interface Step {
  title: string;
  text: string;
  target: string;
  view?: View;
  example?: string;
}
const tours: Record<Tour, Step[]> = {
  overview: [
    {
      title: 'One workbook, several perspectives',
      text: 'Notes tell the story, Cells hold Python values and calculations, and Graph shows their dependencies. Split places any two views side by side. These views share the same workbook.',
      target: '.title-view-switch',
    },
    {
      title: 'Start and control Python',
      text: 'Start runs a workbook after you have reviewed it. Interrupt requests that running work stops; Restart starts the kernel again and reevaluates the workbook. Only start Python code you trust.',
      target: '.kernel-controls',
    },
    {
      title: 'Select a cell to edit it',
      text: 'Click a cell in the grid. Its address, readable label, type, and Python code appear above. Clicking the code field expands the editor without moving the grid. The cells need not run in visual order.',
      target: '.formula-bar',
      view: 'sheet',
    },
    {
      title: 'Apply your changes',
      text: 'Editing code creates a draft. Apply sends it to the running workbook; dependent results then update. Discard a draft to return to the applied version. Saving the workbook and applying a cell are separate steps.',
      target: '.cell-draft-actions',
      view: 'sheet',
    },
    {
      title: 'Read the connections',
      text: 'Graph follows the actual reads made by formulas and effects. Select a node to explore its connections. In Cells, dependency arrows are off by default; increase Depth to enable them.',
      target: '.title-view-switch',
      view: 'graph',
    },
    {
      title: 'Build a live report',
      text: 'Notes combine Markdown, live cell values, widgets, and plots. Switch to Edit to change a note; use / for blocks. In reading mode, people can interact with widgets without editing the prose.',
      target: '.notes-mode-button',
      view: 'notes',
    },
    {
      title: 'Save and find your way back',
      text: 'Use Save in the toolbar (Ctrl/Cmd+S) to save your workbook. Click its name to rename it. The save indicator shows whether changes remain unsaved; click it for details. The Getting started button in the top More menu reopens these tours whenever you need them.',
      target: '.document-identity',
    },
  ],
  concepts: [
    {
      title: 'Start with independent facts',
      text: 'An Input is writable state: a quantity, price, or chosen region. Give it a Python label so other cells can refer to it. A widget edits that same input rather than storing a separate copy.',
      example: '3    # Input cell labeled quantity',
      target: '[aria-label="Cell type"]',
      view: 'sheet',
    },
    {
      title: 'Formulas derive values',
      text: 'A Formula computes from other cells by label. Reading quantity and price creates dependencies. When an input changes, the runtime keeps its derived results current. Put a calculation in a formula instead of manually copying its result into an input.',
      example: 'quantity * price',
      target: '.formula-bar',
      view: 'sheet',
    },
    {
      title: 'Labels connect the model',
      text: 'Labels resolve within the current sheet by default. Use an explicit sheet reference for another sheet. Dependencies come from reads during execution, so a conditional formula can change which cells it depends on.',
      example: 'quantity * price if enabled else 0',
      target: '.cell-label-field',
      view: 'sheet',
    },
    {
      title: 'Linked inputs offer a default and an override',
      text: 'A Linked input derives its default from other cells, but allows a user to override it. Reset returns to the derived value. A change in its dependencies can replace an override. Use this for a suggested value that people may adjust.',
      example: 'recommended_budget * 1.1',
      target: '[aria-label="Cell type"]',
      view: 'sheet',
    },
    {
      title: 'Resources load asynchronously',
      text: 'An Async resource loads data without blocking on the result. It reports loading, errors, and its latest value. Optional synchronous parameters capture the inputs for an asynchronous request, giving you more control over its dependencies.',
      example: 'await fetch_report(region)',
      target: '[aria-label="Cell type"]',
      view: 'sheet',
    },
    {
      title: 'Effects react; actions respond to a request',
      text: 'An Effect runs when the dependencies it reads change, for work such as logging or an integration. An Action runs only when called, for example from a button. Both may change inputs; use a Formula for a value that can simply be derived.',
      target: '[aria-label="Cell type"]',
      view: 'sheet',
    },
    {
      title: 'Notes and widgets present the same state',
      text: 'Use Text / heading for worksheet labels, or create a note page from Notes. Show in Notes controls which Markdown cells appear in the sidebar. Insert a live value, plot, or input widget. Widget settings such as options, labels, and slider limits can also depend on cells.',
      example: 'Total: {{ total }}',
      target: '.title-view-switch',
      view: 'notes',
    },
    {
      title: 'Follow the state flow',
      text: 'Input → formula → plot or note. Change an input, and its consumers update through the reactive graph. The app currently evaluates cell results for display, including cells outside the visible area. Try an example from Getting started to explore this flow.',
      target: '.title-view-switch',
      view: 'graph',
    },
  ],
};

/** Keep the card on screen even when a target is absent or the viewport is small. */
export function tourPosition(
  width: number,
  height: number,
  cardHeight: number,
  target?: { left: number; right: number; top: number; bottom: number },
) {
  const cardWidth = Math.min(400, Math.max(0, width - 24));
  const maxTop = Math.max(12, height - cardHeight - 12);
  const left = target
    ? Math.max(12, Math.min(target.left, width - cardWidth - 12))
    : (width - cardWidth) / 2;
  const top = target
    ? target.bottom + cardHeight + 24 <= height
      ? target.bottom + 16
      : target.top - cardHeight - 16
    : (height - cardHeight) / 2;
  return { left, top: Math.max(12, Math.min(top, maxTop)) };
}

@Component({
  selector: 'app-getting-started',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <dialog
    #dialog
    aria-labelledby="tour-title"
    (cancel)="$event.preventDefault(); finish()"
    (keydown)="onKey($event)"
  >
    @if (highlight(); as box) {
      <div
        class="spotlight"
        aria-hidden="true"
        [style.left.px]="box.left"
        [style.top.px]="box.top"
        [style.width.px]="box.width"
        [style.height.px]="box.height"
      ></div>
    }
    <section
      #card
      class="tour-card"
      [style.left.px]="position().left"
      [style.top.px]="position().top"
    >
      <header>
        <span>{{
          tour()
            ? (tour() === 'overview' ? 'UI overview' : 'Cells & reactivity') +
              ' · ' +
              (index() + 1) +
              ' of ' +
              steps().length
            : 'Welcome to Reaktiv Workbook'
        }}</span
        ><button type="button" aria-label="Close getting started" (click)="finish()">×</button>
      </header>
      <div class="tour-body" aria-live="polite" aria-atomic="true">
        <h2 id="tour-title">{{ step()?.title ?? 'Your first reactive workbook' }}</h2>
        @if (step(); as current) {
          <p>{{ current.text }}</p>
          @if (current.example) {
            <pre><code>{{ current.example }}</code></pre>
          }
        } @else {
          <p>
            Write Python in cells, connect calculations by label, and present live results in notes.
            Choose a guided tour. You can go back, skip, or replay it anytime.
          </p>
          <div class="tour-choices">
            <button type="button" (click)="start('overview')">
              <strong>Show me around</strong
              ><span>Views, kernel, editing, drafts, and saving · 7 steps</span>
            </button>
            <button type="button" (click)="start('concepts')">
              <strong>Understand cells & reactivity</strong
              ><span>Inputs, formulas, linked inputs, resources, effects, and notes · 8 steps</span>
            </button>
          </div>
          <details>
            <summary>Explore an example workbook</summary>
            @if (session()) {
              <p class="example-hint">
                Examples open in a new browser tab. To keep one as a file next to this workbook, run
                <code>reaktiv-workbook new --from welcome</code> (or another example's name).
              </p>
            }
            @for (group of levels; track group.level) {
              @if (hasLevel(group.level)) {
                <h3 class="example-level">{{ group.label }}</h3>
                @for (example of examples(); track example.file) {
                  @if (example.level === group.level) {
                    <button class="example" type="button" (click)="exampleSelected.emit(example.file)">
                      <strong>{{ example.title }}</strong
                      ><span>{{ example.description }}</span>
                    </button>
                  }
                }
              }
            }
          </details>
        }
      </div>
      <footer>
        @if (tour()) {
          <button type="button" (click)="index() === 0 ? choose() : index.set(index() - 1)">
            {{ index() === 0 ? 'All tours' : 'Back' }}
          </button>
          <button type="button" class="quiet" (click)="finish()">Skip tour</button>
          <button type="button" class="primary-button" (click)="next()">
            {{ index() === steps().length - 1 ? 'Finish' : 'Next' }}
          </button>
        } @else {
          <button type="button" (click)="finish()">Explore on my own</button>
          <button type="button" class="primary-button" (click)="createRequested.emit()">
            Create a project
          </button>
        }
      </footer>
    </section>
  </dialog>`,
  styles: `
    dialog {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--ink);
    }
    dialog::backdrop {
      background: light-dark(#15212266, #0009);
    }
    .spotlight {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid light-dark(#7970d8, #b2a9ff);
      border-radius: 10px;
      box-shadow: 0 0 0 9999px light-dark(#15212266, #0009);
      pointer-events: none;
    }
    dialog:has(.spotlight)::backdrop {
      background: transparent;
    }
    .tour-card {
      position: fixed;
      width: min(400px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 12px 48px light-dark(#15212233, #0008);
    }
    header,
    footer {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 14px 18px;
      flex-shrink: 0;
    }
    header {
      color: var(--muted);
      font-size: 12px;
      justify-content: space-between;
    }
    header button {
      font-size: 22px;
      border: 0;
      padding: 0 6px;
    }
    .tour-body {
      overflow: auto;
      padding: 0 20px 12px;
    }
    h2 {
      margin: 4px 0 12px;
      font-size: 21px;
      line-height: 1.25;
    }
    p {
      font-size: 14px;
      line-height: 1.65;
      margin: 0 0 12px;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 12px;
      padding: 12px;
      border-radius: 8px;
      background: light-dark(#f0f1ed, #272b29);
    }
    button {
      cursor: pointer;
      color: inherit;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 12px;
      font: inherit;
    }
    button:focus-visible,
    summary:focus-visible {
      outline: 2px solid light-dark(#6554c0, #b2a9ff);
      outline-offset: 3px;
    }
    button:hover {
      background: light-dark(#eeefeb, #303530);
    }
    .primary-button,
    .primary-button:hover {
      background: var(--ink);
      color: var(--paper);
      border-color: var(--ink);
    }
    .tour-choices {
      display: grid;
      gap: 10px;
      margin: 16px 0;
    }
    .tour-choices button,
    .example {
      text-align: left;
      display: grid;
      gap: 6px;
      width: 100%;
    }
    span {
      line-height: 1.4;
    }
    .tour-choices span,
    .example span {
      color: var(--muted);
      font-size: 12px;
    }
    details {
      font-size: 13px;
      margin-top: 18px;
    }
    summary {
      cursor: pointer;
      margin-bottom: 10px;
    }
    .example {
      margin: 8px 0;
    }
    .example-hint {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--muted);
    }
    .example-level {
      margin: 14px 0 2px;
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    footer {
      border-top: 1px solid var(--line);
      justify-content: space-between;
      font-size: 13px;
      flex-wrap: wrap;
    }
    .quiet {
      border: 0;
      color: var(--muted);
    }
  `,
})
export class GettingStartedComponent implements OnInit, OnDestroy {
  readonly initialView = input.required<View>();
  readonly examples = input.required<readonly ExampleWorkbook[]>();
  /** Attached to a `reaktiv-workbook` session: examples open in a new tab, not this file. */
  readonly session = input(false);
  protected readonly levels = EXAMPLE_LEVELS;
  protected hasLevel(level: ExampleLevel): boolean {
    return this.examples().some(example => example.level === level);
  }
  readonly viewRequested = output<View>();
  readonly closed = output<View>();
  readonly exampleSelected = output<string>();
  readonly createRequested = output<void>();
  readonly tour = signal<Tour | null>(null);
  readonly index = signal(0);
  readonly steps = computed(() => (this.tour() ? tours[this.tour()!] : []));
  readonly step = computed(() => this.steps()[this.index()]);
  readonly highlight = signal<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  readonly position = signal({ left: 12, top: 12 });
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private originalView: View = 'notes';
  private previousFocus: HTMLElement | null = null;
  private frame = 0;
  private observer?: ResizeObserver;
  private readonly schedule = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  };
  constructor() {
    effect(() => {
      const step = this.step();
      if (step?.view) this.viewRequested.emit(step.view);
      this.schedule();
    });
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      this.observer = new ResizeObserver(this.schedule);
      this.observer.observe(this.card().nativeElement);
      window.addEventListener('resize', this.schedule);
      window.addEventListener('scroll', this.schedule, true);
      this.measure();
    });
  }
  ngOnInit() {
    this.originalView = this.initialView();
    this.previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  start(tour: Tour) {
    this.index.set(0);
    this.tour.set(tour);
  }
  choose() {
    this.tour.set(null);
    this.index.set(0);
    this.viewRequested.emit(this.originalView);
  }
  next() {
    if (this.index() < this.steps().length - 1) this.index.update((index) => index + 1);
    else this.choose();
  }
  finish() {
    this.closed.emit(this.originalView);
  }
  onKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finish();
    }
    if (this.tour() && event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    }
    if (this.tour() && event.key === 'ArrowLeft' && this.index() > 0) {
      event.preventDefault();
      this.index.update((index) => index - 1);
    }
  }
  private measure() {
    const selector = this.step()?.target;
    const target = selector ? document.querySelector<HTMLElement>(selector) : null;
    const box = target?.getBoundingClientRect();
    const visible =
      box &&
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.top < innerHeight &&
      box.right > 0 &&
      box.left < innerWidth;
    this.highlight.set(
      visible
        ? {
            left: Math.max(2, box.left - 4),
            top: Math.max(2, box.top - 4),
            width: Math.min(box.width + 8, innerWidth - Math.max(2, box.left - 4) - 2),
            height: box.height + 8,
          }
        : null,
    );
    this.position.set(
      tourPosition(
        innerWidth,
        innerHeight,
        this.card().nativeElement.offsetHeight,
        visible ? box : undefined,
      ),
    );
  }
  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener('resize', this.schedule);
    window.removeEventListener('scroll', this.schedule, true);
    this.dialog().nativeElement.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
