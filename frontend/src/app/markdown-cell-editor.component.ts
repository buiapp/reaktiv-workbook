import type { ResolvedCellWidget } from './sheet.types';
import { actionWidgetState, type WidgetActionRequest, type WidgetActionFeedback } from './widget-action';
import { isWidgetDebounce, widgetBlocked } from './widget-config';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { marked } from 'marked';
import './markdown-math';
import './markdown-mermaid';
import {
  ProseKitBlockEditorComponent,
} from './prosekit-block-editor.component';
import { isNoteTable, renderTableHtml } from './data-table';
import type { ArtifactResult, RichOutputResult, TableResult } from './sheet.types';
import { PythonEditorComponent, type PythonCompletion } from './python-editor.component';
import { UiIconComponent } from './ui-icon.component';
import { ZoomControlComponent } from './zoom-control.component';
import type { NoteNodeRenderer, NoteWidgetModel } from './note-live-views';
import { PLOTLY_MIME_TYPE } from './plotly-figure';
import { ANYWIDGET_MIME_TYPE } from './anywidget-view';
import { HTML_MIME_TYPE } from './html-output';
import { parseOutputQuery } from './note-layout';
import { inferWidgetType, isWidgetType, stringList, widgetSource } from './input-widgets';
import { activeHeading, buildOutline, headingElements, referencedNames, type OutlineItem } from './note-outline';
import type { NoteLinkTarget } from './note-links';

export interface MarkdownInterpolationValue {
  reference: string;
  cellId: string;
  display: string;
  error: string | null;
  value?: unknown;
  editable?: boolean;
  artifact?: ArtifactResult;
  richOutput?: RichOutputResult;
  table?: TableResult;
  /** The cell has not been computed yet (workbook not run, or added since). */
  pending?: boolean;
  /** Cell kind; a referenced note ('markdown') is embedded as a rendered block. */
  kind?: string;
  linkedOverride?: string | null;
  widget?: ResolvedCellWidget;
  widgetError?: string;
}

const TOC_KEY = 'reaktiv-workbook:note-toc:v1';

/** The table of contents is on unless the reader turned it off. */
function storedTocPreference(): boolean {
  try {
    return localStorage.getItem(TOC_KEY) !== 'false';
  } catch {
    return true;
  }
}

export interface MarkdownWidgetChange {
  cellId: string;
  source: string;
}

@Component({
  selector: 'app-markdown-cell-editor',
  imports: [CommonModule, ProseKitBlockEditorComponent, PythonEditorComponent, UiIconComponent, ZoomControlComponent],
  template: `
    <section class="note-editor" aria-label="Markdown note editor">
      <header class="note-toolbar view-header">
        <div class="note-heading">
          <strong>{{ title }}</strong>
          <span class="eyebrow">{{ cellId }}</span>
        </div>
        <div class="toolbar-actions">
          <div class="mode-switch" aria-label="Note source view">
            <button
              type="button"
              title="Edit the note as a page (values show live)"
              [class.active]="sourceView() === 'rendered'"
              (click)="sourceView.set('rendered')"
            >
              <app-ui-icon name="edit" />
              Rendered
            </button>
            <button
              type="button"
              title="Edit the note as raw Markdown"
              [class.active]="sourceView() === 'raw'"
              (click)="showRawSource()"
            >
              <app-ui-icon name="code" />
              Raw
            </button>
          </div>
          @if (!interactive) {
            <span class="read-only-pill" title="Start the workbook to edit">Read-only</span>
          }
          @if (sourceView() === 'rendered' && !readOnly) {
            <div class="insert-menu-anchor" (click)="$event.stopPropagation()">
              <button
                type="button"
                class="insert-toggle"
                title="Insert a block, image, link, live cell value, or input widget"
                [class.active]="insertMenuOpen()"
                (click)="toggleInsertMenu($event)"
              >
                <app-ui-icon name="plus" />
                Insert
              </button>
              @if (insertMenuOpen()) {
                <div
                  class="insert-menu"
                  role="menu"
                  [style.top.px]="insertMenuPosition().top"
                  [style.left.px]="insertMenuPosition().left"
                  (click)="closeInsertIfAction($event)"
                >
                  <button type="button" role="menuitem" (click)="appendParagraph()">
                    <app-ui-icon name="plus" /> Block <small>type / for all block types</small>
                  </button>
                  <button type="button" role="menuitem" (click)="openImagePicker()">
                    <app-ui-icon name="image" /> Image
                  </button>
                  <button type="button" role="menuitem" (click)="openLinkDialog()">
                    <app-ui-icon name="link" /> Link
                  </button>
                  <button type="button" role="menuitem" (click)="openCellPicker()">
                    <app-ui-icon name="link" /> Live cell value
                  </button>
                  <div class="insert-widget-row">
                    <button type="button" role="menuitem" (click)="openWidgetPicker()">
                      <app-ui-icon name="widget" /> Input widget
                    </button>
                  </div>
                </div>
              }
            </div>
          }
          @if (sourceView() === 'rendered') {
            <button
              type="button"
              class="toc-toggle"
              [class.active]="tocEnabled()"
              [attr.aria-pressed]="tocEnabled()"
              [title]="
                outline().length < 2
                  ? 'Contents: appears when the note has two or more headings'
                  : tocEnabled()
                    ? 'Hide the table of contents'
                    : 'Show the table of contents'
              "
              (click)="toggleToc()"
            >
              <app-ui-icon name="logs" />
              Contents
            </button>
          }
          @if (showInspectorAction) {
            <button
              class="icon-only"
              type="button"
              title="Inspect note cell"
              aria-label="Inspect note cell"
              (click)="inspectRequested.emit()"
            >
              <app-ui-icon name="inspect" />
            </button>
          }
          <button
            class="icon-only"
            type="button"
            title="Copy rendered Markdown"
            aria-label="Copy rendered Markdown"
            (click)="copyRenderedMarkdown()"
          >
            <app-ui-icon name="copy" />
            @if (copied()) {
              <span class="copy-confirmation">Copied</span>
            }
          </button>
          @if (imageError(); as message) {
            <span class="toolbar-error" role="alert">{{ message }}</span>
          }
        </div>
      </header>

      @if (sourceView() === 'raw') {
        <div class="raw-source" [style.zoom]="zoom">
          <app-python-editor
            class="raw-markdown-editor"
            language="markdown"
            ariaLabel="Raw Markdown source"
            [value]="source"
            [completions]="rawCompletions()"
            [readOnly]="readOnly"
            (valueChange)="updateRawSource($event)"
          />
          <p class="raw-hint">
            Interpolate cells with <code>{{ '{{ name }}' }}</code>. Changes appear in the
            Rendered view; Tab indents (Escape, then Tab, leaves the editor).
          </p>
        </div>
      } @else {
      <div class="note-body" [class.with-toc]="tocShown()">
        <!-- A size container: wide and full-width blocks are sized against it (styles.scss). -->
        <div class="note-column">
        <div class="note-page" #page [style.zoom]="zoom" [style.--note-zoom]="zoom">
          <app-prosekit-block-editor
            class="note-document"
            [source]="source"
            [documentKey]="cellId"
            [values]="values"
            [noteLinks]="noteLinks"
            [evaluatedSource]="evaluatedSource"
            [renderer]="renderer"
            [widgetActivity]="widgetActivity"
            [readOnly]="readOnly"
            [interactive]="interactive"
            (sourceChange)="updateFromEditor($event)"
          />
        </div>
        </div>
        @if (tocShown()) {
          <nav class="note-toc" aria-label="Contents">
            <span class="note-toc-title">Contents</span>
            @for (item of outline(); track item.index) {
              <button
                type="button"
                [class.active]="item.index === activeHeadingIndex()"
                [style.padding-left.px]="8 + item.depth * 12"
                [title]="item.text"
                (click)="scrollToHeading(item)"
              >
                {{ item.text }}
              </button>
            }
          </nav>
        }
      </div>
      }
      <app-zoom-control label="Note zoom" [zoom]="zoom" outLabel="Zoom note out" inLabel="Zoom note in"
        (zoomOut)="changeZoom(-0.1)" (reset)="resetZoom()" (zoomIn)="changeZoom(0.1)" />
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: var(--theme-paper, light-dark(#fdfdfb, #161614));
      container-type: inline-size;
    }
    button,
    select,
    textarea {
      font: inherit;
    }
    .note-editor {
      min-height: 100%;
    }
    .note-toolbar {
      position: sticky;
      z-index: 5;
      top: 0;
      display: flex;
      min-width: 0;
      min-height: 40px;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 6px 20px;
      border-bottom: 1px solid var(--theme-line, light-dark(#d9ddd5, #2d2f2b));
      /* Opaque, no backdrop-filter: a filter would become the containing block of the
         fixed-position Insert menu and offset it. */
      background: var(--theme-paper, light-dark(#fdfdfb, #161614));
      border-bottom-color: var(--theme-line, light-dark(#e9e8e3, #292926));
    }
    .note-toolbar > div:first-child {
      display: flex;
      min-width: 0;
      flex: 0 1 auto;
      align-items: baseline;
      gap: 8px;
    }
    .note-toolbar > div:first-child strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* The shared floating zoom (app-zoom-control): sticky at the bottom of the scrolled page. */
    .note-editor > app-zoom-control {
      position: sticky;
      bottom: 14px;
      width: max-content;
      margin: -40px 14px 14px auto;
    }
    .eyebrow {
      color: var(--theme-muted, light-dark(#70756d, #898d87));
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }
    .toolbar-actions {
      display: flex;
      min-width: 0;
      max-width: 100%;
      flex: 0 1 auto;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      padding-bottom: 2px;
      scrollbar-width: thin;
    }
    .toolbar-actions > * {
      flex: 0 0 auto;
    }
    .insert-actions,
    .widget-actions {
      display: inline-flex;
      align-items: center;
    }
    .mode-switch {
      display: inline-flex;
      padding: 2px;
      border: 1px solid light-dark(#c2c8be, #3f433d);
      border-radius: 7px;
      background: light-dark(#eef1eb, #1a1b19);
    }
    .note-zoom {
      display: inline-flex;
    }
    .toolbar-actions .note-zoom button {
      min-width: 27px;
      padding: 0 6px;
      border-radius: 0;
    }
    .toolbar-actions .note-zoom button:first-child {
      border-radius: 6px 0 0 6px;
    }
    .toolbar-actions .note-zoom button + button {
      border-left: 0;
    }
    .toolbar-actions .note-zoom button:last-child {
      border-radius: 0 6px 6px 0;
    }
    .toolbar-actions .mode-switch button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 24px;
      border: 0;
      background: transparent;
    }
    .toolbar-actions .mode-switch button.active {
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      background: var(--theme-paper, light-dark(#fdfdfb, #161614));
      box-shadow: 0 0 0 1px var(--theme-line, light-dark(#e3e2dc, #33332f)),
          0 1px 2px rgb(0 0 0 / 6%);
    }
    .toolbar-actions button,
    .toolbar-actions select {
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid light-dark(#c2c8be, #3f433d);
      border-radius: 6px;
      color: light-dark(#3f453d, #b6bcb4);
      background: var(--theme-paper, light-dark(white, #0c0c0c));
      font-size: 10px;
      font-weight: 750;
    }
    .toolbar-actions button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      white-space: nowrap;
    }
    .insert-actions button,
    .widget-actions > * {
      border-radius: 0;
    }
    .insert-actions button:first-child,
    .widget-actions > *:first-child {
      border-radius: 6px 0 0 6px;
    }
    .insert-actions button:last-child,
    .widget-actions > *:last-child {
      border-radius: 0 6px 6px 0;
    }
    .insert-actions button + button,
    .widget-actions > * + * {
      border-left: 0;
    }
    .toolbar-actions .icon-only {
      position: relative;
      width: 30px;
      padding: 0;
    }
    .copy-confirmation {
      position: absolute;
      top: 38px;
      padding: 4px 7px;
      border-radius: 5px;
      color: var(--theme-paper, light-dark(white, #0c0c0c));
      background: light-dark(#30352d, #c6ccc3);
      font-size: 9px;
    }
    .toolbar-error {
      max-width: 220px;
      color: var(--theme-danger, light-dark(#a13f3f, #dc7975));
      font-size: 10px;
    }
    .read-only-pill {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--muted, #7a7a73);
      background: var(--panel, #f6f5f1);
      font-size: 11px;
    }
    .raw-source {
      width: min(900px, calc(100% - 48px));
      margin: 22px auto 60px;
    }
    .raw-markdown-editor {
      height: calc(100vh - 260px);
      min-height: 240px;
    }
    .raw-markdown-editor ::ng-deep .cm-editor {
      font-size: 12.5px;
    }
    .raw-hint {
      margin: 8px 2px 0;
      color: light-dark(#7a8075, #7f847b);
      font-size: 11px;
    }
    .note-page,
    .raw-source,
    .note-toc {
      box-sizing: border-box;
    }
    .note-column {
      min-width: 0;
      container-type: inline-size;
    }
    .note-page {
      width: min(760px, calc(100% - 48px));
      min-height: calc(100vh - 230px);
      margin: 0 auto;
      padding: 56px 40px 160px;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }
    .note-body.with-toc {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 232px;
      align-items: start;
    }
    .note-toc {
      position: sticky;
      top: 66px;
      display: grid;
      max-height: calc(100vh - 220px);
      gap: 1px;
      overflow: auto;
      margin: 62px 20px 0 0;
      padding: 2px 0 2px 12px;
      border-left: 1px solid var(--theme-line, light-dark(#e9e8e3, #292926));
    }
    .note-toc-title {
      padding: 0 8px 6px;
      color: var(--theme-muted, light-dark(#8a8a83, #7f7f78));
      font-size: 10.5px;
      font-weight: 650;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .note-toc button {
      overflow: hidden;
      min-height: 26px;
      padding: 3px 8px;
      border: 0;
      border-radius: 6px;
      color: light-dark(#6f6f69, #9a9a93);
      background: transparent;
      font-size: 12.5px;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .note-toc button:hover {
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      background: light-dark(#f3f2ee, #1f1f1d);
    }
    .note-toc button.active {
      color: light-dark(#4b36a8, #b7adff);
      font-weight: 650;
    }
    .toolbar-actions .toc-toggle.active {
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      background: light-dark(#e9e8e2, #2a2a27);
    }
    /* Narrow note (split view, small window): the contents sit above the page. */
    @container (max-width: 900px) {
      .note-body.with-toc {
        display: flex;
        flex-direction: column-reverse;
        /* Inline-size containment removes intrinsic width; fill the flex cross axis. */
        align-items: stretch;
      }
      .note-toc {
        position: static;
        width: min(760px, calc(100% - 48px));
        max-height: 168px;
        margin: 18px auto 0;
      }
      .note-body.with-toc .note-page {
        padding-top: 28px;
      }
    }
    @container (max-width: 620px) {
      .note-toolbar {
        align-items: flex-start;
        flex-direction: column;
        gap: 8px;
        padding: 10px 14px;
      }
      .toolbar-actions {
        width: 100%;
        overflow-x: auto;
        padding-bottom: 3px;
      }
      .toolbar-actions > * {
        flex: 0 0 auto;
      }
      .note-page {
        width: calc(100% - 24px);
        margin: 14px auto 48px;
        padding: 36px 28px 72px;
      }
    }
    .insert-menu-anchor {
      position: relative;
    }
    .insert-toggle.active {
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      background: light-dark(#e9e8e2, #2a2a27);
    }
    .insert-menu {
      position: fixed;
      z-index: 60;
      display: grid;
      width: 250px;
      gap: 1px;
      padding: 6px;
      border: 1px solid var(--theme-line, light-dark(#e9e8e3, #292926));
      border-radius: 10px;
      background: var(--theme-paper, light-dark(#fdfdfb, #161614));
      box-shadow:
        0 12px 32px rgb(0 0 0 / 12%),
        0 2px 6px rgb(0 0 0 / 6%);
    }
    .insert-menu button {
      display: flex;
      width: 100%;
      align-items: center;
      justify-content: flex-start;
      gap: 9px;
      min-height: 30px;
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      text-align: left;
    }
    .insert-menu button small {
      margin-left: auto;
      color: var(--theme-muted, light-dark(#8a8a83, #7f7f78));
      font-size: 11px;
    }
    .insert-widget-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .insert-widget-row button {
      flex: 1;
    }
    .insert-widget-row select {
      width: 92px;
    }
    .note-toolbar > div:first-child .eyebrow,
    .note-toolbar > div:first-child span {
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .note-toolbar strong {
      font-size: 13.5px;
      font-weight: 650;
    }
    
    .toolbar-actions .mode-switch,
    .toolbar-actions .note-zoom,
    .insert-actions,
    .widget-actions {
      gap: 1px;
      padding: 2px;
      border: 0;
      border-radius: 8px;
      background: light-dark(#f3f2ee, #1f1f1d);
    }
    .toolbar-actions button,
    .toolbar-actions select,
    .toolbar-actions .note-zoom button,
    .insert-actions button,
    .widget-actions > * {
      min-height: 26px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      color: light-dark(#6f6f69, #9a9a93);
      background: transparent;
      font-size: 12px;
      font-weight: 500;
    }
    .toolbar-actions button:hover,
    .toolbar-actions select:hover {
      color: var(--theme-ink, light-dark(#1d1d1b, #e7e7e2));
      background: light-dark(#e9e8e2, #2a2a27);
    }
    
    .toolbar-actions > .icon-only {
      border: 0;
      background: transparent;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownCellEditorComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) source = '';
  @Input() evaluatedSource = '';
  @Input({ required: true }) title = '';
  @Input({ required: true }) cellId = '';
  @Input() values: MarkdownInterpolationValue[] = [];
  @Input() runningAction:string|null=null;
  @Input() runningActions: readonly string[] = [];
  @Input() cancellingActions: readonly string[] = [];
  @Input() actionBusy=false;
  @Input() actionFeedback:WidgetActionFeedback|null=null;
  @Output() actionInvoked=new EventEmitter<WidgetActionRequest>();
  /** Notes this note can link to (`#note-…`), for the link dialog. */
  @Input() noteLinks: NoteLinkTarget[] = [];
  @Input() zoom = 1;
  @Input() showInspectorAction = false;
  /** Readable but not editable (the kernel is not running). */
  @Input() readOnly = false;
  /** Widgets work (the workbook runs); true in the worksheet's reading mode too. */
  @Input() interactive = true;
  @Output() readonly sourceChange = new EventEmitter<string>();
  @Output() readonly cellSelected = new EventEmitter<string>();
  @Output() readonly linkedReset = new EventEmitter<string>();
  @Output() readonly widgetChange = new EventEmitter<MarkdownWidgetChange>();
  @Output() readonly inspectRequested = new EventEmitter<void>();
  @Output() readonly zoomChange = new EventEmitter<number>();
  @ViewChild(ProseKitBlockEditorComponent)
  private prosekitEditor?: ProseKitBlockEditorComponent;

  protected readonly copied = signal(false);
  protected readonly sourceView = signal<'rendered' | 'raw'>('rendered');
  protected readonly imageError = signal<string | null>(null);
  protected readonly insertMenuOpen = signal(false);
  protected readonly insertMenuPosition = signal({ top: 0, left: 0 });

  // ── Table of contents (note-outline.ts) ─────────────────────────────
  /** The reader's choice; the panel shows only when the note has 2+ headings. */
  protected readonly tocEnabled = signal(storedTocPreference());
  protected readonly outline = signal<OutlineItem[]>([]);
  protected readonly activeHeadingIndex = signal(-1);
  protected readonly tocShown = computed(() => this.tocEnabled() && this.outline().length >= 2);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private pageElement: HTMLElement | null = null;
  private outlineTimer: ReturnType<typeof setTimeout> | null = null;
  /** Headings appear, change, and disappear while typing: the outline follows the page. */
  private readonly pageObserver =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => this.scheduleOutline());

  @ViewChild('page')
  protected set page(reference: ElementRef<HTMLElement> | undefined) {
    this.pageObserver?.disconnect();
    this.pageElement = reference?.nativeElement ?? null;
    if (this.pageElement === null) {
      this.outline.set([]);
      return;
    }
    this.pageObserver?.observe(this.pageElement, { childList: true, subtree: true, characterData: true });
    this.scheduleOutline();
  }

  private scheduleOutline(): void {
    if (this.outlineTimer !== null) return;
    this.outlineTimer = setTimeout(() => {
      this.outlineTimer = null;
      this.refreshOutline();
    }, 120);
  }

  private refreshOutline(): void {
    if (this.pageElement === null) return;
    const next = buildOutline(headingElements(this.pageElement));
    if (JSON.stringify(next) !== JSON.stringify(this.outline())) this.outline.set(next);
    this.updateActiveHeading();
  }

  @HostListener('scroll')
  protected updateActiveHeading(): void {
    if (this.pageElement === null || !this.tocShown()) return;
    const line = this.host.getBoundingClientRect().top + 96;
    // Above the first heading, the first entry is the current one.
    const active = activeHeading(headingElements(this.pageElement), line);
    this.activeHeadingIndex.set(active === -1 ? (this.outline()[0]?.index ?? -1) : active);
  }

  protected scrollToHeading(item: OutlineItem): void {
    if (this.pageElement === null) return;
    headingElements(this.pageElement)[item.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.activeHeadingIndex.set(item.index);
  }

  protected toggleToc(): void {
    this.tocEnabled.update((enabled) => !enabled);
    try {
      localStorage.setItem(TOC_KEY, String(this.tocEnabled()));
    } catch {
      // The choice still applies for this session.
    }
    this.updateActiveHeading();
  }

  ngOnDestroy(): void {
    this.pageObserver?.disconnect();
    if (this.outlineTimer !== null) clearTimeout(this.outlineTimer);
  }

  private completions: PythonCompletion[] = [];
  private completionsFor: MarkdownInterpolationValue[] | null = null;
  private resolvedCache: {
    source: string;
    evaluatedSource: string;
    resolved: ReadonlyMap<string, string>;
  } | null = null;

  /** What the editor's live values and widgets show (see note-nodes.ts). */
  protected readonly renderer: NoteNodeRenderer = {
    valueHtml: (expression, width, height) =>
      interpolateHtml(
        width !== null && height !== null
          ? `[{{ ${expression} }}](#sheet-output?width=${width}&height=${height})`
          : `{{ ${expression} }}`,
        this.values,
        this.resolvedExpressions(),
      ),
    widget: (label, reference, query) => {
      const widget = parseInputWidget(
        label.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (match, expression: string) => expression.trim() === reference ? '' : this.renderer.interpolate(match)),
        this.resolveWidgetQuery(query),
        this.values.find((value) => value.reference === reference),
      );
      return widget ? actionWidgetState(widget,widget.cellId,this.runningActions.length ? this.runningActions : this.runningAction,this.actionBusy,this.actionFeedback,this.cancellingActions) : null;
    },
    invokeAction: widget => {
      if(this.interactive && widget.action && !widgetBlocked(widget) && !widget.error) this.actionInvoked.emit({cellId:widget.cellId,name:widget.action,arguments:widget.actionArguments ?? {}});
    },
    resetLinked: (id) => { if (this.interactive) this.linkedReset.emit(id); },
    changeWidget: (widget, value) => {
      if (!this.interactive || widgetBlocked(widget) || widget.error) return;
      const source = widgetSource(value, widget.type, widget.buttonMode);
      if (source !== null) this.widgetChange.emit({ cellId: widget.cellId, source });
    },
    selectCell: (cellId) => this.cellSelected.emit(cellId),
    references: (expression) => {
      const byReference = new Map<string, MarkdownInterpolationValue>();
      const labels = new Map<string, string>();
      for (const value of this.values) {
        if (!byReference.has(value.reference)) byReference.set(value.reference, value);
        // The first reference of a cell is its label, when it has one.
        if (!labels.has(value.cellId)) {
          labels.set(value.cellId, /^(?:\w+[.!])?[A-Z]+[1-9][0-9]*$/.test(value.reference) ? '' : value.reference);
        }
      }
      const seen = new Set<string>();
      return referencedNames(expression, (name) => byReference.has(name)).flatMap((name) => {
        const value = byReference.get(name)!;
        if (seen.has(value.cellId)) return [];
        seen.add(value.cellId);
        const display = value.error ? '#ERROR' : value.pending ? '' : value.display;
        return [{
          cellId: value.cellId,
          label: labels.get(value.cellId) ?? '',
          display: display.length > 40 ? `${display.slice(0, 39)}…` : display,
          kind: value.kind,
        }];
      });
    },
    editable: () => !this.readOnly,
    interactive: () => this.interactive,
    interpolate: (text) => {
      const resolved = this.resolvedExpressions();
      return text.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (match, expression: string) => {
        const key = expression.trim();
        const evaluated = resolved.get(key);
        if (evaluated !== undefined) return evaluated;
        const value = this.values.find((candidate) => candidate.reference === key);
        return value === undefined || value.error ? '?' : value.display;
      });
    },
  };

  protected get widgetActivity():string {return JSON.stringify([this.runningAction,this.runningActions,this.cancellingActions,this.actionBusy,this.actionFeedback]);}

  ngOnChanges(): void {
    // Content changes flow into the editor through its inputs.
  }

  protected updateFromEditor(source: string): void {
    if (this.readOnly) return;
    this.sourceChange.emit(source);
  }

  protected showRawSource(): void {
    this.sourceView.set('raw');
  }

  /** Raw edits replace the whole note; the page editor reloads from them. */
  protected updateRawSource(source: string): void {
    if (this.readOnly) return;
    this.sourceChange.emit(source);
  }

  /** Cell names offered while typing raw Markdown, recomputed only when values change. */
  protected rawCompletions(): PythonCompletion[] {
    if (this.completionsFor !== this.values) {
      const byReference = new Map(this.values.map((value) => [value.reference, value.cellId]));
      this.completions = [...byReference].map(([label, cellId]) => ({
        label,
        detail: cellId,
        type: 'variable',
      }));
      this.completionsFor = this.values;
    }
    return this.completions;
  }

  private resolveWidgetQuery(query: string | undefined): string {
    const params = new URLSearchParams((query?.slice(1) ?? '').replace(/\{\{[\s\S]*?\}\}/g, expression => encodeURIComponent(expression)));
    for (const key of ['min', 'max', 'step', 'options', 'label', 'placeholder', 'disabled', 'visible', 'loading', 'pressed']) {
      const raw = params.get(key);
      if (raw === null || !raw.includes('{{')) continue;
      const expression = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(raw)?.[1]?.trim();
      const value = this.values.find(item => item.reference === expression);
      if (key === 'options' && Array.isArray(value?.value)) {
        params.set(key, JSON.stringify(value.value));
      } else {
        params.set(key, this.renderer.interpolate(raw));
      }
    }
    return '?' + params.toString();
  }

  private resolvedExpressions(): ReadonlyMap<string, string> {
    const cached = this.resolvedCache;
    if (
      cached !== null &&
      cached.source === this.source &&
      cached.evaluatedSource === this.evaluatedSource
    ) {
      return cached.resolved;
    }
    const resolved = resolveEvaluatedExpressions(this.source, this.evaluatedSource);
    this.resolvedCache = {
      source: this.source,
      evaluatedSource: this.evaluatedSource,
      resolved,
    };
    return resolved;
  }

  protected appendParagraph(): void {
    this.prosekitEditor?.appendParagraph();
  }

  protected openCellPicker(): void {
    this.prosekitEditor?.openCellPicker();
  }

  protected openWidgetPicker(): void {
    this.prosekitEditor?.openWidgetPicker();
  }

  protected openImagePicker(): void {
    this.imageError.set(null);
    this.prosekitEditor?.openImagePicker();
  }

  protected openLinkDialog(): void {
    this.prosekitEditor?.openLinkDialog();
  }



  protected changeZoom(delta: number): void {
    this.zoomChange.emit(Math.min(1.6, Math.max(0.7, Math.round((this.zoom + delta) * 10) / 10)));
  }

  protected resetZoom(): void {
    this.zoomChange.emit(1);
  }

  /** The toolbar scrolls horizontally (and clips), so the menu is fixed to the window. */
  protected toggleInsertMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.insertMenuPosition.set({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 262)),
    });
    this.insertMenuOpen.update((open) => !open);
  }

  @HostListener('document:click')
  protected closeInsertMenu(): void {
    this.insertMenuOpen.set(false);
  }

  protected closeInsertIfAction(event: Event): void {
    if ((event.target as HTMLElement).closest('button')) this.insertMenuOpen.set(false);
  }

  protected async copyRenderedMarkdown(): Promise<void> {
    await navigator.clipboard.writeText(interpolateText(this.source, this.values));
    this.copied.set(true);
    window.setTimeout(() => this.copied.set(false), 1500);
  }
}

function interpolateHtml(
  source: string,
  values: MarkdownInterpolationValue[],
  evaluatedExpressions: ReadonlyMap<string, string> = new Map(),
): string {
  const byReference = new Map(values.map((value) => [value.reference, value]));
  const replacements = new Map<string, string>();
  let replacementIndex = 0;
  // Sized or wide outputs ([{{ x }}](#sheet-output?…)); the layout is the node view's business.
  const normalizedSource = source.replace(
    /\[\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\}\}\]\(#sheet-output\?([^)\s]*)\)/g,
    (_match, reference: string, query: string) => {
      const { width, height } = parseOutputQuery(query);
      return `{{ ${reference} }}${width && height ? `<!--reaktiv-output-size:${width}x${height}-->` : ''}`;
    },
  );
  const interpolated = normalizedSource.replace(
    /\{\{\s*([\s\S]*?)\s*\}\}(?:<!--reaktiv-output-size:(\d+)x(\d+)-->)?/g,
    (match, expression, width: string | undefined, height: string | undefined) => {
      const placeholder = `REAKTIVLIVEVALUE${replacementIndex++}TOKEN`;
      const normalizedExpression = String(expression).trim();
      // Resolve known qualified labels before treating dots as Python attribute access.
      const leading = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/u.exec(normalizedExpression)?.[0];
      const reference = leading === undefined ? undefined : referencedNames(leading, name => byReference.has(name))[0];
      const value = reference === undefined ? undefined : byReference.get(reference);
      const evaluated = evaluatedExpressions.get(normalizedExpression);
      if (value?.pending && evaluated === undefined) {
        replacements.set(
          placeholder,
          `<span class="pending-value" title="${escapeHtml(normalizedExpression)} — not computed yet; start the workbook to compute it">…</span>`,
        );
        return placeholder;
      }
      if ((value === undefined || value.error !== null) && evaluated === undefined) {
        const label = value?.error ? `Error: ${value.error}` : match;
        replacements.set(placeholder, `<span class="missing-value">${escapeHtml(label)}</span>`);
        return placeholder;
      }
      const sizeAttributes =
        width !== undefined && height !== undefined ? ` width="${width}" height="${height}"` : '';
      if (
        value !== undefined &&
        value.artifact !== undefined &&
        isPreviewableImage(value.artifact)
      ) {
        const imageSource = `data:${value.artifact.mimeType};base64,${value.artifact.dataBase64}`;
        replacements.set(
          placeholder,
          `<a class="artifact-value" href="#cell-${escapeHtml(value.cellId)}" title="${escapeHtml(normalizedExpression)}"><img src="${imageSource}" alt="${escapeHtml(value.artifact.filename)}"${sizeAttributes}></a>`,
        );
        return placeholder;
      }
      // A plain `{{ frame }}` renders the value's table natively; an expression such as
      // `{{ frame.head() }}` uses the Markdown table Python rendered for that expression.
      if (normalizedExpression === reference && isNoteTable(value?.table)) {
        replacements.set(
          placeholder,
          `<div class="table-value" title="${escapeHtml(normalizedExpression)}">${renderTableHtml(value.table)}</div>`,
        );
        return placeholder;
      }
      // `{{ other_note }}` embeds that note (transclusion), rendered as Markdown.
      if (normalizedExpression === reference && value?.kind === 'markdown' && !value.error) {
        const body = (evaluated ?? value.display ?? '').replace(/!\[[^\]]*\]\(#cell-[^)]*\)/g, '');
        replacements.set(
          placeholder,
          `<blockquote class="note-embed" title="Embedded note ${escapeHtml(value.cellId)}">${
            marked.parse(body, { async: false, gfm: true, breaks: true }) as string
          }</blockquote>`,
        );
        return placeholder;
      }
      if (evaluated !== undefined && isMarkdownTable(evaluated)) {
        replacements.set(
          placeholder,
          `<div class="table-value" title="${escapeHtml(normalizedExpression)}">${
            marked.parse(evaluated, { async: false, gfm: true }) as string
          }</div>`,
        );
        return placeholder;
      }
      // Rich outputs (widgets, charts, plots, images) stand for the cell itself, so only
      // a bare reference shows them: `{{ counter.value }}` shows the value.
      const whole = normalizedExpression === reference;
      if (whole && value?.richOutput?.mimeType === ANYWIDGET_MIME_TYPE) {
        replacements.set(
          placeholder,
          `<div class="anywidget-value" title="${escapeHtml(normalizedExpression)}"><reaktiv-anywidget data-cell="${escapeHtml(value.cellId)}" data-spec="${value.richOutput.dataBase64}"></reaktiv-anywidget></div>`,
        );
        return placeholder;
      }
      if (whole && value?.richOutput?.mimeType === HTML_MIME_TYPE) {
        replacements.set(
          placeholder,
          `<div class="html-value" title="${escapeHtml(normalizedExpression)}"><reaktiv-html data-spec="${value.richOutput.dataBase64}"></reaktiv-html></div>`,
        );
        return placeholder;
      }
      if (whole && value?.richOutput?.mimeType === PLOTLY_MIME_TYPE) {
        replacements.set(
          placeholder,
          `<div class="plotly-value" title="${escapeHtml(normalizedExpression)}"><reaktiv-plotly data-spec="${value.richOutput.dataBase64}"></reaktiv-plotly></div>`,
        );
        return placeholder;
      }
      if (whole && value?.richOutput !== undefined) {
        const imageSource = `data:${value.richOutput.mimeType};base64,${value.richOutput.dataBase64}`;
        replacements.set(
          placeholder,
          `<a class="artifact-value" href="#cell-${escapeHtml(value.cellId)}" title="${escapeHtml(normalizedExpression)}"><img src="${imageSource}" alt="Plot"${sizeAttributes}></a>`,
        );
        return placeholder;
      }
      replacements.set(
        placeholder,
        value === undefined
          ? `<span class="live-value" title="${escapeHtml(normalizedExpression)}">${escapeHtml(evaluated || 'None')}</span>`
          : `<a class="live-value" href="#cell-${escapeHtml(value.cellId)}" title="${escapeHtml(normalizedExpression)}">${escapeHtml(evaluated ?? value.display ?? 'None')}</a>`,
      );
      return placeholder;
    },
  );
  let rendered = marked.parse(interpolated, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
  rendered = applyMarkdownImageSizes(rendered);
  for (const [placeholder, replacement] of replacements) {
    // Block values (tables) must not stay wrapped in the paragraph Markdown gave them.
    rendered = rendered
      .replaceAll(`<p>${placeholder}</p>`, replacement)
      .replaceAll(placeholder, replacement);
  }
  return rendered;
}

function isMarkdownTable(text: string): boolean {
  const lines = text.trim().split('\n');
  return lines.length >= 2 && lines[0].startsWith('|') && /^\|\s*:?-{2,}/.test(lines[1]);
}

export function applyMarkdownImageSizes(html: string): string {
  return html.replace(/<img\b[^>]*\btitle="(reaktiv-[^"]*)"[^>]*>/giu, (tag, title: string) => {
    const size = /reaktiv-size:(\d+)x(\d+)/u.exec(title);
    const layout = /reaktiv-layout:(wide|full)/u.exec(title)?.[1];
    const attributes = [
      ...(size === null ? [] : [`width="${size[1]}" height="${size[2]}"`]),
      ...(layout === undefined ? [] : [`data-layout="${layout}"`]),
    ];
    return tag.replace(/\s+title="reaktiv-[^"]*"/iu, '').replace(/\s*\/?>$/u, ` ${attributes.join(' ')}>`);
  });
}

export function resolveEvaluatedExpressions(
  source: string,
  evaluatedSource: string,
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  if (evaluatedSource === '' || evaluatedSource === '#ERROR') return resolved;
  const matches = [...source.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)];
  let sourceCursor = 0;
  let evaluatedCursor = 0;
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const matchIndex = match.index;
    const staticPrefix = source.slice(sourceCursor, matchIndex);
    if (!evaluatedSource.startsWith(staticPrefix, evaluatedCursor)) return new Map();
    evaluatedCursor += staticPrefix.length;
    sourceCursor = matchIndex + match[0].length;
    const nextIndex = matches[index + 1]?.index ?? source.length;
    const staticSuffix = source.slice(sourceCursor, nextIndex);
    const last = index === matches.length - 1;
    // The last value runs to the end of the note; adjacent values cannot be told apart.
    const valueEnd =
      staticSuffix === ''
        ? last
          ? evaluatedSource.trimEnd().length
          : evaluatedCursor
        : evaluatedSource.indexOf(staticSuffix, evaluatedCursor);
    if (valueEnd < 0) return new Map();
    const expression = match[1]?.trim();
    if (expression !== undefined && !resolved.has(expression)) {
      resolved.set(expression, evaluatedSource.slice(evaluatedCursor, valueEnd));
    }
    evaluatedCursor = valueEnd;
  }
  return resolved;
}

function interpolateText(source: string, values: MarkdownInterpolationValue[]): string {
  const byReference = new Map(values.map((value) => [value.reference, value]));
  const interpolated = source.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (match, reference) => {
      const value = byReference.get(reference);
      return value === undefined || value.error !== null ? match : value.display || 'None';
    },
  );
  return interpolated.replace(
    /\[([^\]]*?)\]\(#sheet-input:[A-Za-z_][A-Za-z0-9_]*(?:\?[^)]*)?\)/g,
    '$1',
  );
}

/** `debounce=0` in a note's widget link: whole milliseconds, else ignored. */
function queryDebounce(params: URLSearchParams): number | undefined {
  const value = params.get('debounce');
  const parsed = value === null || value.trim() === '' ? NaN : Number(value);
  return isWidgetDebounce(parsed) ? parsed : undefined;
}

function parseInputWidget(
  rawLabel: string,
  query: string | undefined,
  value: MarkdownInterpolationValue | undefined,
): NoteWidgetModel | null {
  if (value === undefined || !value.editable) {
    return null;
  }
  const params = new URLSearchParams(query?.slice(1) ?? '');
  const configured = value.widget;
  const requestedType = configured?.type ?? inferWidgetType(value.value);
  const action = params.get('action') ?? configured?.action;
  const buttonMode = action ? 'action' : params.get('buttonMode') === 'toggle' ? 'toggle' : params.get('buttonMode') === 'count' ? 'count' : configured?.buttonMode;
  const type = isWidgetType(requestedType) ? requestedType : 'text';
  const label = params.get('label') ?? configured?.label ??
    (rawLabel
      .replace(/\{\{.*?\}\}/g, '')
      .replace(/:\s*$/, '')
      .trim() || value.reference.replaceAll('_', ' '));
  return {
    cellId: value.cellId,
    linked: value.kind === 'linked',
    linkedOverridden: value.kind === 'linked' && value.linkedOverride != null,
    type,
    label,
    disabled: value.error != null || value.widgetError !== undefined || configured?.disabled === true || queryBoolean(params, 'disabled', false),
    visible: configured?.visible !== false && queryBoolean(params, 'visible', true),
    loading: configured?.loading === true || queryBoolean(params, 'loading', false),
    pressed: params.has('pressed') ? queryBoolean(params, 'pressed', false) : configured?.pressed,
    placeholder: params.get('placeholder') ?? configured?.placeholder,
    buttonMode,
    action,
    cancelWhileRunning:configured?.cancelWhileRunning,
    debounce: queryDebounce(params) ?? configured?.debounce,
    actionArguments:configured?.actionArguments,
    error: value.widgetError ?? value.error ?? undefined,
    value:
      type === 'checkbox' || (type === 'button' && buttonMode === 'toggle')
        ? Boolean(value.value)
        : type === 'list' || type === 'multiselect'
          ? stringList(value.value)
          : type === 'number' || type === 'range' || type === 'button'
          ? Number.isFinite(Number(value.value))
            ? Number(value.value)
            : 0
          : String(value.value ?? ''),
    display: value.display,
    min: params.get('min') ?? (configured?.min === undefined ? null : String(configured.min)),
    max: params.get('max') ?? (configured?.max === undefined ? null : String(configured.max)),
    step: params.get('step') ?? (configured?.step === undefined ? null : String(configured.step)),
    options: params.has('options') ? widgetOptions(params.get('options')!) : configured?.options ?? [],
  };
}

function queryBoolean(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const value = params.get(key);
  return value === null ? fallback : ['true', '1'].includes(value.toLowerCase());
}

function widgetOptions(source: string): string[] {
  try {
    const parsed: unknown = JSON.parse(source);
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed;
  } catch { /* Static options are comma-separated. */ }
  return source.split(',').map(option => option.trim()).filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isPreviewableImage(artifact: ArtifactResult): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(artifact.mimeType);
}
