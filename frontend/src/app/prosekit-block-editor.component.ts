import { CommonModule } from '@angular/common';
import { KeepInViewDirective } from './keep-in-view';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  effect,
  inject,
  OnChanges,
  SimpleChanges,
  signal,
  untracked,
} from '@angular/core';
import type { BasicExtension } from 'prosekit/basic';
import type { Editor } from 'prosekit/core';
import type { Transaction } from 'prosekit/pm/state';
import { firstSupportedImage, hasSupportedImage } from './embedded-image';
import { isEmbeddedImage, referencedAssets } from './image-assets';
import { AssetStore } from './asset-store';
import type { MarkdownInterpolationValue } from './markdown-cell-editor.component';
import { LiveNodeViews, type NoteNodeRenderer, type NoteWidgetModel } from './note-live-views';
import { isNoteLink, type NoteLinkTarget } from './note-links';
import { mathRevision } from './markdown-math';
import { mermaidRevision } from './markdown-mermaid';
import { codeRevision } from './code-highlight';

/** Drag payload of a grid cell (app.ts); dropping it inserts a live value. */
const CELL_DRAG_TYPE = 'application/x-reaktiv-workbook-cell';

export interface ProseKitBlockCommand {
  id:
    | 'text'
    | 'heading-1'
    | 'heading-2'
    | 'heading-3'
    | 'bulleted-list'
    | 'numbered-list'
    | 'checklist'
    | 'divider'
    | 'quote'
    | 'table'
    | 'image'
    | 'link'
    | 'code'
    | 'math'
    | 'diagram'
    | 'cell'
    | 'widget';
  label: string;
  hint: string;
  keywords: string;
  icon: string;
}

/**
 * `image` resizes an embedded image, `plot` a live plot (a sized `cellValue` node), `value`
 * any other block value (table, widget, HTML, chart). All three can be wider than the text
 * column (`layout`: null, 'wide', or 'full').
 */
type EditorContextMenu =
  | { kind: 'table'; x: number; y: number }
  | {
      kind: 'image' | 'plot';
      x: number;
      y: number;
      pos: number;
      width: number;
      aspectRatio: number;
      layout: string | null;
    }
  | { kind: 'value'; x: number; y: number; pos: number; layout: string | null };

export const PROSEKIT_BLOCK_COMMANDS: readonly ProseKitBlockCommand[] = [
  { id: 'text', label: 'Text', hint: 'Plain paragraph', keywords: 'basic paragraph', icon: 'T' },
  {
    id: 'heading-1',
    label: 'Heading 1',
    hint: 'Large section title',
    keywords: 'title h1',
    icon: 'H1',
  },
  {
    id: 'heading-2',
    label: 'Heading 2',
    hint: 'Medium section title',
    keywords: 'subtitle h2',
    icon: 'H2',
  },
  {
    id: 'heading-3',
    label: 'Heading 3',
    hint: 'Small section title',
    keywords: 'subtitle h3',
    icon: 'H3',
  },
  {
    id: 'bulleted-list',
    label: 'Bulleted list',
    hint: 'Unordered list',
    keywords: 'bullet unordered',
    icon: '•',
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    hint: 'Ordered list',
    keywords: 'number ordered',
    icon: '1.',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    hint: 'Task with a checkbox',
    keywords: 'todo task checkbox',
    icon: '☐',
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Horizontal separator',
    keywords: 'rule separator',
    icon: '—',
  },
  { id: 'quote', label: 'Quote', hint: 'Quoted text', keywords: 'blockquote', icon: '❝' },
  {
    id: 'table',
    label: 'Table',
    hint: 'Table with a custom size',
    keywords: 'grid rows columns',
    icon: '▦',
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Upload and embed an image',
    keywords: 'media picture upload paste',
    icon: '▧',
  },
  {
    id: 'link',
    label: 'Link',
    hint: 'Link to a web page or another note',
    keywords: 'url website hyperlink note page chapter',
    icon: '↗',
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Formatted source code',
    keywords: 'python source formatted',
    icon: '</>',
  },
  {
    id: 'math',
    label: 'Math formula',
    hint: 'LaTeX, e.g. V = Z \\cdot I',
    keywords: 'latex equation katex formula',
    icon: '∑',
  },
  {
    id: 'diagram',
    label: 'Diagram (Mermaid)',
    hint: 'Flowchart, sequence, state, class, gantt…',
    keywords: 'mermaid chart flowchart sequence graph uml',
    icon: '⬡',
  },
  {
    id: 'cell',
    label: 'Cell value',
    hint: 'Live spreadsheet value',
    keywords: 'reference formula autocomplete',
    icon: 'ƒ',
  },
  {
    id: 'widget',
    label: 'Input widget',
    hint: 'Control a spreadsheet input',
    keywords: 'interactive control slider checkbox select',
    icon: '◫',
  },
];

@Component({
  selector: 'app-prosekit-block-editor',
  imports: [CommonModule, KeepInViewDirective],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div
      #mount
      class="prosekit-editor prosekit-basic prosekit-typography"
      aria-label="Note"
    ></div>
    <input
      #imageInput
      class="image-input"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      (change)="handleImageSelection($event)"
    />
    @if (imageError(); as message) {
      <p class="image-error" role="alert">{{ message }}</p>
    }

    @if (editor(); as currentEditor) {
      @if (!readOnly) {
        <prosekit-block-handle-root [editor]="currentEditor">
          <prosekit-block-handle-positioner class="block-handle-positioner">
            <prosekit-block-handle-popup class="block-handle-popup">
              <prosekit-block-handle-add
                class="block-handle-add"
                title="Add a block below"
                [editor]="currentEditor"
              >
                +
              </prosekit-block-handle-add>
              <prosekit-block-handle-draggable
                class="block-handle-draggable"
                [editor]="currentEditor"
                title="Drag to move this block"
              >
                ⋮⋮
              </prosekit-block-handle-draggable>
            </prosekit-block-handle-popup>
          </prosekit-block-handle-positioner>
        </prosekit-block-handle-root>
        <prosekit-drop-indicator class="drop-indicator" [editor]="currentEditor" />
        <prosekit-inline-popover-root [editor]="currentEditor">
          <prosekit-inline-popover-positioner class="inline-popover-positioner">
            <prosekit-inline-popover-popup class="inline-toolbar" (mousedown)="$event.preventDefault()">
              <button type="button" title="Bold (Mod+B)" (click)="toggleMark('bold')"><strong>B</strong></button>
              <button type="button" title="Italic (Mod+I)" (click)="toggleMark('italic')"><em>I</em></button>
              <button type="button" title="Strikethrough" (click)="toggleMark('strike')"><s>S</s></button>
              <button type="button" title="Inline code (Mod+E)" (click)="toggleMark('code')"><code>&lt;/&gt;</code></button>
              <span class="toolbar-divider"></span>
              <button type="button" title="Heading 1" (click)="executeCommand('heading-1')">H1</button>
              <button type="button" title="Heading 2" (click)="executeCommand('heading-2')">H2</button>
              <button type="button" title="Quote" (click)="executeCommand('quote')">❝</button>
              <span class="toolbar-divider"></span>
              <button type="button" title="Link" (click)="openLinkDialog()">↗</button>
            </prosekit-inline-popover-popup>
          </prosekit-inline-popover-positioner>
        </prosekit-inline-popover-root>
      }
      <prosekit-autocomplete-root
        [editor]="currentEditor"
        [regex]="slashRegex"
        (openChange)="handleAutocompleteOpen($event)"
      >
        <prosekit-autocomplete-positioner class="autocomplete-positioner">
          <prosekit-autocomplete-popup class="autocomplete-popup">
            <div class="autocomplete-heading">
              <strong>Insert block</strong>
              <span>Type to filter · ↑↓ to select</span>
            </div>
            @for (command of commands; track command.id) {
              <prosekit-autocomplete-item
                class="autocomplete-item"
                [attr.value]="command.label + ' ' + command.keywords"
                (select)="executeCommand(command.id)"
              >
                <span class="command-icon">{{ command.icon }}</span>
                <span
                  ><strong>{{ command.label }}</strong
                  ><small>{{ command.hint }}</small></span
                >
              </prosekit-autocomplete-item>
            }
            <prosekit-autocomplete-empty class="autocomplete-empty">
              No matching blocks
            </prosekit-autocomplete-empty>
          </prosekit-autocomplete-popup>
        </prosekit-autocomplete-positioner>
      </prosekit-autocomplete-root>

      <prosekit-autocomplete-root
        [editor]="currentEditor"
        [regex]="cellRegex"
        (openChange)="handleAutocompleteOpen($event)"
      >
        <prosekit-autocomplete-positioner class="autocomplete-positioner">
          <prosekit-autocomplete-popup class="autocomplete-popup cell-popup">
            <div class="autocomplete-heading">
              <strong>{{ widgetCellPending() ? 'Choose input cell' : 'Insert cell value' }}</strong>
              <span>Search label, coordinate, or value</span>
            </div>
            @for (value of selectableValues(); track value.reference) {
              <prosekit-autocomplete-item
                class="autocomplete-item cell-item"
                [attr.value]="value.reference + ' ' + value.cellId + ' ' + value.display"
                (select)="insertCell(value.reference)"
              >
                <span class="command-icon">ƒ</span>
                <span
                  ><strong>{{ value.reference }}</strong
                  ><small>{{ value.cellId }} · {{ value.display || 'None' }}</small></span
                >
              </prosekit-autocomplete-item>
            }
            <prosekit-autocomplete-empty class="autocomplete-empty">
              No matching cells
            </prosekit-autocomplete-empty>
          </prosekit-autocomplete-popup>
        </prosekit-autocomplete-positioner>
      </prosekit-autocomplete-root>
    }

    <ng-template #layoutRow let-menu>
      <div class="layout-options" role="group" aria-label="Width in the note">
        <button type="button" [attr.aria-pressed]="!menu.layout" (click)="setLayout(menu, null)">Normal</button>
        <button type="button" [attr.aria-pressed]="menu.layout === 'wide'" (click)="setLayout(menu, 'wide')">Wide</button>
        <button type="button" [attr.aria-pressed]="menu.layout === 'full'" (click)="setLayout(menu, 'full')">Full width</button>
      </div>
    </ng-template>

    @if (contextMenu(); as menu) {
      <div
        class="editor-context-menu"
        role="menu"
        [appKeepInView]="menu"
        (click)="$event.stopPropagation()"
      >
        @if (menu.kind === 'image' || menu.kind === 'plot') {
          <strong>{{ menu.kind === 'plot' ? 'Plot' : 'Image' }} size · {{ menu.width }} px</strong>
          <input
            class="image-size-slider"
            type="range"
            min="80"
            max="1200"
            step="20"
            aria-label="Image width"
            [value]="menu.width"
            (input)="resizeImage(menu, +$any($event.target).value)"
          />
          <div class="image-size-presets">
            <button type="button" (click)="resizeImage(menu, 240)">Small</button>
            <button type="button" (click)="resizeImage(menu, 480)">Medium</button>
            <button type="button" (click)="resizeImage(menu, 720)">Large</button>
          </div>
          <button type="button" role="menuitem" (click)="resetImageSize(menu)">
            Original size
          </button>
          <ng-container *ngTemplateOutlet="layoutRow; context: { $implicit: menu }" />
        } @else if (menu.kind === 'value') {
          <strong>Width</strong>
          <ng-container *ngTemplateOutlet="layoutRow; context: { $implicit: menu }" />
        } @else {
          <strong>Table</strong>
          <button type="button" role="menuitem" (click)="runTableCommand('row-above')">
            Add row above
          </button>
          <button type="button" role="menuitem" (click)="runTableCommand('row-below')">
            Add row below
          </button>
          <button type="button" role="menuitem" (click)="runTableCommand('column-before')">
            Add column before
          </button>
          <button type="button" role="menuitem" (click)="runTableCommand('column-after')">
            Add column after
          </button>
          <button type="button" role="menuitem" (click)="runTableCommand('delete-row')">
            Remove row
          </button>
          <button type="button" role="menuitem" (click)="runTableCommand('delete-column')">
            Remove column
          </button>
          <button
            type="button"
            role="menuitem"
            class="danger"
            (click)="runTableCommand('delete-table')"
          >
            Remove table
          </button>
        }
      </div>
    }

    @if (tableDialogOpen()) {
      <div
        class="editor-dialog-backdrop"
        (mousedown)="closeTableDialog()"
        (keydown.escape)="closeTableDialog()"
      >
        <section
          class="editor-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="table-dialog-title"
          (mousedown)="$event.stopPropagation()"
        >
          <div>
            <span class="dialog-eyebrow">Insert block</span>
            <h3 id="table-dialog-title">Create table</h3>
            <p>
              Choose an initial size. Rows and columns can still be changed from the table menu.
            </p>
          </div>
          <label>
            Rows
            <input
              type="number"
              min="1"
              max="20"
              [value]="tableRows()"
              (input)="setTableRows($event)"
            />
          </label>
          <label>
            Columns
            <input
              type="number"
              min="1"
              max="20"
              [value]="tableColumns()"
              (input)="setTableColumns($event)"
            />
          </label>
          <div class="dialog-actions">
            <button type="button" (click)="closeTableDialog()">Cancel</button>
            <button type="button" class="primary" (click)="confirmTable()">Insert table</button>
          </div>
        </section>
      </div>
    }

    @if (linkDialogOpen()) {
      <div
        class="editor-dialog-backdrop"
        (mousedown)="closeLinkDialog()"
        (keydown.escape)="closeLinkDialog()"
      >
        <section
          class="editor-dialog link-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-dialog-title"
          (mousedown)="$event.stopPropagation()"
        >
          <div>
            <span class="dialog-eyebrow">Insert</span>
            <h3 id="link-dialog-title">Add link</h3>
            <p>Select text before opening this dialog to turn it into a link to a web page or to another note.</p>
          </div>
          <label>
            Text
            <input
              type="text"
              [value]="linkText()"
              (input)="linkText.set($any($event.target).value)"
              autocomplete="off"
            />
          </label>
          @if (noteLinks.length > 0) {
            <label>
              Note
              <select (change)="chooseNoteLink($any($event.target).value)">
                <option value="" [selected]="!isNoteLink(linkUrl())">A web address (below)</option>
                @for (note of noteLinks; track note.href) {
                  <option [value]="note.href" [selected]="linkUrl() === note.href">{{ note.title }}</option>
                }
              </select>
            </label>
          }
          <label>
            URL
            <input
              type="url"
              [value]="linkUrl()"
              (input)="linkUrl.set($any($event.target).value); linkError.set(null)"
              (keydown.enter)="confirmLink()"
              autocomplete="url"
            />
          </label>
          @if (linkError(); as message) {
            <p class="dialog-error" role="alert">{{ message }}</p>
          }
          <div class="dialog-actions">
            <button type="button" (click)="closeLinkDialog()">Cancel</button>
            <button type="button" class="primary" (click)="confirmLink()">Insert link</button>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-width: 0;
    }
    .prosekit-editor {
      min-height: 38px;
      outline: none;
    }
    .image-input {
      display: none;
    }
    .image-error {
      margin: 5px 2px 0;
      color: var(--theme-danger, light-dark(#a13f3f, #dc7975));
      font-size: 10px;
    }
    .editor-context-menu {
      position: fixed;
      z-index: 180;
      display: grid;
      min-width: 184px;
      padding: 6px;
      border: 1px solid light-dark(#cbd1c7, #383b36);
      border-radius: 9px;
      background: var(--theme-paper, light-dark(white, #0c0c0c));
      box-shadow: 0 16px 42px rgb(30 35 28 / 20%);
    }
    .editor-context-menu strong {
      padding: 5px 8px;
      color: light-dark(#777e73, #80867d);
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .editor-context-menu button {
      padding: 7px 8px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      font: inherit;
      font-size: 11px;
      text-align: left;
    }
    .editor-context-menu button:hover {
      background: light-dark(#eef7dc, #161a0f);
    }
    .editor-context-menu .danger {
      color: var(--theme-danger, light-dark(#a13f3f, #dc7975));
    }
    .image-size-slider {
      width: calc(100% - 16px);
      margin: 8px;
      accent-color: var(--theme-purple, light-dark(#7157d9, #8975f2));
    }
    .layout-options {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      margin-top: 4px;
    }
    .layout-options button[aria-pressed='true'] {
      color: light-dark(#fff, #10120f);
      background: light-dark(#4a5145, #d8ddd3);
    }
    .image-size-presets {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3px;
      padding: 0 4px 4px;
    }
    .image-size-presets button {
      padding-inline: 5px;
      text-align: center;
    }
    .editor-dialog-backdrop {
      position: fixed;
      z-index: 220;
      display: grid;
      place-items: center;
      inset: 0;
      padding: 24px;
      background: rgb(25 28 23 / 32%);
      backdrop-filter: blur(2px);
    }
    .editor-dialog {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      width: min(420px, 100%);
      padding: 20px;
      border: 1px solid light-dark(#cbd1c7, #383b36);
      border-radius: 12px;
      background: var(--theme-paper, light-dark(white, #0c0c0c));
      box-shadow: 0 24px 70px rgb(22 27 19 / 26%);
    }
    .editor-dialog > div:first-child,
    .dialog-actions {
      grid-column: 1 / -1;
    }
    /* Text, note, and URL stack: the note list needs the room for titles. */
    .link-dialog label {
      grid-column: 1 / -1;
    }
    .link-dialog .dialog-error {
      grid-column: 1 / -1;
      color: var(--theme-danger, light-dark(#a13f3f, #dc7975));
      font-weight: 700;
    }
    .dialog-eyebrow {
      color: light-dark(#737a6f, #848a81);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .editor-dialog h3 {
      margin: 4px 0 5px;
      color: light-dark(#252a23, #d2d7d0);
      font-size: 18px;
    }
    .editor-dialog p {
      margin: 0;
      color: light-dark(#687064, #8d948a);
      font-size: 11px;
      line-height: 1.45;
    }
    .editor-dialog label {
      display: grid;
      gap: 5px;
      color: light-dark(#4e554b, #a6ada4);
      font-size: 10px;
      font-weight: 750;
    }
    .editor-dialog input,
    .editor-dialog select {
      box-sizing: border-box;
      width: 100%;
      height: 36px;
      padding: 0 10px;
      border: 1px solid light-dark(#bfc6ba, #41463e);
      border-radius: 7px;
      background: light-dark(#fbfcfa, #0c0d0c);
      font: inherit;
      font-size: 13px;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 2px;
    }
    .dialog-actions button {
      min-height: 34px;
      padding: 0 13px;
      border: 1px solid light-dark(#bdc5b8, #42473e);
      border-radius: 7px;
      background: var(--theme-paper, light-dark(white, #0c0c0c));
      font: inherit;
      font-size: 11px;
      font-weight: 750;
    }
    .dialog-actions .primary {
      border-color: light-dark(#8dbf29, #3f6700);
      color: light-dark(#243014, #cad7bc);
      background: var(--theme-lime, light-dark(#c7f36b, #242e11));
    }
    .prosekit-editor ::ng-deep .ProseMirror {
      min-height: 26px;
      outline: none;
    }
    .prosekit-editor ::ng-deep .reference-presentation {
      visibility: hidden;
      margin-left: 6px;
      font: 500 11px/1.4 system-ui, sans-serif;
      cursor: pointer;
    }
    .prosekit-editor ::ng-deep :is(.cell-value-node, .sheet-widget-node):is(:hover, :focus-within) .reference-presentation {
      visibility: visible;
    }
    .prosekit-editor ::ng-deep .reference-presentation:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .prosekit-editor ::ng-deep .ProseMirror img[width] {
      width: attr(width px);
      max-width: 100%;
      height: auto;
      cursor: context-menu;
    }
    .prosekit-editor ::ng-deep .ProseMirror > :first-child {
      margin-top: 0;
    }
    .prosekit-editor ::ng-deep .ProseMirror > :last-child {
      margin-bottom: 0;
    }
    .autocomplete-positioner {
      z-index: 100;
      border: 0;
      outline: 0;
      background: transparent;
    }
    .autocomplete-positioner[data-state='closed'],
    .autocomplete-popup[data-state='closed'] {
      display: none;
    }
    .autocomplete-popup {
      display: block;
      width: min(330px, calc(100vw - 32px));
      max-height: 340px;
      overflow: auto;
      padding: 6px;
      border: 1px solid light-dark(#cbd1c7, #383b36);
      border-radius: 10px;
      outline: 0;
      background: light-dark(rgb(255 255 255 / 98%), rgb(12 12 12 / 98%));
      box-shadow: 0 16px 42px rgb(30 35 28 / 20%);
      animation: palette-in 120ms ease-out;
    }
    .autocomplete-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 8px 9px;
      border-bottom: 1px solid light-dark(#e5e8e1, #232421);
      color: light-dark(#30352e, #c6cbc4);
      font-size: 11px;
    }
    .autocomplete-heading span {
      color: light-dark(#7a8076, #7f847c);
      font-size: 9px;
    }
    .autocomplete-item {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      padding: 7px 8px;
      border-radius: 6px;
      color: light-dark(#30352e, #c6cbc4);
      cursor: pointer;
      outline: 0;
    }
    .autocomplete-item[data-highlighted] {
      background: light-dark(#eef7dc, #161a0f);
    }
    .autocomplete-item strong,
    .autocomplete-item small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .autocomplete-item strong {
      font-size: 11px;
    }
    .autocomplete-item small {
      margin-top: 1px;
      color: light-dark(#787f75, #7f857d);
      font-size: 9px;
    }
    .command-icon {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border: 1px solid var(--theme-line, light-dark(#d9ddd5, #2d2f2b));
      border-radius: 6px;
      color: light-dark(#523ab2, #a094ff);
      background: light-dark(#f8f7fc, #121213);
      font-size: 10px;
      font-weight: 800;
    }
    .autocomplete-empty {
      display: block;
      padding: 12px;
      color: light-dark(#7a8076, #7f847c);
      font-size: 10px;
      text-align: center;
    }
    @keyframes palette-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProseKitBlockEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) source = '';
  @Input() values: MarkdownInterpolationValue[] = [];
  /** Notes the link dialog offers (`#note-…` links). */
  @Input() noteLinks: NoteLinkTarget[] = [];
  @Output() readonly sourceChange = new EventEmitter<string>();
  /** What live values and widgets show (supplied by the note component). */
  @Input() renderer: NoteNodeRenderer | null = null;
  @Input() widgetActivity = '';
  /** Evaluated note text; a change means values changed and live nodes re-render. */
  @Input() evaluatedSource = '';
  /** A different document (another note): its content replaces the editor's. */
  @Input() documentKey = '';
  @Input() readOnly = false;
  /** Widgets work (the workbook runs), also while the text is read-only. */
  @Input() interactive = true;
  @ViewChild('mount', { static: true }) private readonly mountRef!: ElementRef<HTMLElement>;
  @ViewChild('imageInput', { static: true })
  private readonly imageInputRef!: ElementRef<HTMLInputElement>;
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly commands = PROSEKIT_BLOCK_COMMANDS;
  protected readonly editor = signal<Editor<BasicExtension> | null>(null);
  protected readonly slashRegex = /(?<!\S)\/(\S.*)?$/u;
  protected readonly cellRegex = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)?$/u;
  protected readonly widgetCellPending = signal(false);
  protected readonly contextMenu = signal<EditorContextMenu | null>(null);
  protected readonly imageError = signal<string | null>(null);
  protected readonly tableDialogOpen = signal(false);
  protected readonly tableRows = signal(3);
  protected readonly tableColumns = signal(3);
  protected readonly linkDialogOpen = signal(false);
  protected readonly linkText = signal('');
  protected readonly linkUrl = signal('https://');
  protected readonly linkError = signal<string | null>(null);
  private readonly autocompleteOpen = signal(false);

  private instance: Editor<BasicExtension> | null = null;
  private destroyed = false;
  private insertCellTriggerAfterInitialize = false;
  private triggerAutocomplete: ((transaction: Transaction) => Transaction) | null = null;
  private linkSelection = { from: 0, to: 0 };
  private suppressSourceChange = false;
  /** Markdown last emitted (or loaded): an incoming `source` equal to it is our own echo. */
  private lastMarkdown = '';
  private conversion: typeof import('./markdown-conversion') | null = null;
  private selectionModule: typeof import('prosekit/pm/state') | null = null;
  private readonly liveViews = new LiveNodeViews();
  private readonly assets = inject(AssetStore);
  /** An image that was not showable yet (loading from IndexedDB, another folder) now is. */
  private readonly assetsChanged = effect(() => {
    if (this.assets.revision() > 0 && referencedAssets(this.source).length > 0) untracked(() => this.loadSource());
  });
  /** Formulas and values re-render once KaTeX has loaded (lazily). */
  private readonly mathLoaded = effect(() => {
    // Read both (no short-circuit), so the effect tracks both signals.
    const revisions = mathRevision() + mermaidRevision() + codeRevision();
    if (revisions > 0) this.liveViews.refresh();
  });
  /** Stable renderer for node views; delegates to the current `renderer` input. */
  private readonly nodeRenderer: NoteNodeRenderer = {
    valueHtml: (expression, width, height) =>
      this.renderer?.valueHtml(expression, width, height) ?? `{{ ${expression} }}`,
    widget: (label, reference, query) => this.renderer?.widget(label, reference, query) ?? null,
    resetLinked: (cellId) => this.renderer?.resetLinked?.(cellId),
    invokeAction: widget => this.renderer?.invokeAction?.(widget),
    changeWidget: (widget: NoteWidgetModel, value) => this.renderer?.changeWidget(widget, value),
    selectCell: (cellId) => this.renderer?.selectCell(cellId),
    references: (expression) => this.renderer?.references(expression) ?? [],
    editable: () => !this.readOnly,
    interactive: () => this.interactive,
    interpolate: (text) => this.renderer?.interpolate(text) ?? text,
  };

  ngAfterViewInit(): void {
    void this.initialize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    const editor = this.instance;
    if (editor === null || this.conversion === null) return;
    if (changes['readOnly']) editor.view.setProps({ editable: () => !this.readOnly });
    if (
      (changes['source'] && this.source !== this.lastMarkdown) ||
      (changes['documentKey'] && !changes['documentKey'].firstChange)
    ) {
      this.loadSource();
    } else if (changes['widgetActivity'] || changes['values'] || changes['evaluatedSource'] || changes['readOnly'] || changes['interactive']) {
      this.liveViews.refresh();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.mountRef.nativeElement.removeEventListener('contextmenu', this.handleEditorContextMenu);
    this.mountRef.nativeElement.removeEventListener('paste', this.handleEditorPaste, true);
    this.mountRef.nativeElement.removeEventListener('drop', this.handleEditorDrop, true);
    this.mountRef.nativeElement.removeEventListener('dragover', this.handleEditorDragOver, true);
    this.instance?.unmount();
    this.instance = null;
    this.editor.set(null);
  }

  private async initialize(): Promise<void> {
    const [
      basic,
      core,
      autocomplete,
      autocompleteExtension,
      conversion,
      blockHandle,
      dropIndicator,
      inlinePopover,
      dropIndicatorExtension,
      placeholder,
      noteNodes,
      state,
      codeBlock,
      pmView,
      codeHighlight,
    ] = await Promise.all([
      import('prosekit/basic'),
      import('prosekit/core'),
      import('prosekit/web/autocomplete'),
      import('prosekit/extensions/autocomplete'),
      import('./markdown-conversion'),
      import('prosekit/web/block-handle'),
      import('prosekit/web/drop-indicator'),
      import('prosekit/web/inline-popover'),
      import('prosekit/extensions/drop-indicator'),
      import('prosekit/extensions/placeholder'),
      import('./note-nodes'),
      import('prosekit/pm/state'),
      import('prosekit/extensions/code-block'),
      import('prosekit/pm/view'),
      import('./code-highlight'),
    ]);
    if (this.destroyed) return;
    this.conversion = conversion;
    this.selectionModule = state;
    this.triggerAutocomplete = autocompleteExtension.triggerAutocomplete;
    blockHandle.registerBlockHandleRootElement();
    blockHandle.registerBlockHandlePositionerElement();
    blockHandle.registerBlockHandlePopupElement();
    blockHandle.registerBlockHandleAddElement();
    blockHandle.registerBlockHandleDraggableElement();
    dropIndicator.registerDropIndicatorElement();
    inlinePopover.registerInlinePopoverRootElement();
    inlinePopover.registerInlinePopoverPositionerElement();
    inlinePopover.registerInlinePopoverPopupElement();
    autocomplete.registerAutocompleteRootElement();
    autocomplete.registerAutocompletePositionerElement();
    autocomplete.registerAutocompletePopupElement();
    autocomplete.registerAutocompleteItemElement();
    autocomplete.registerAutocompleteEmptyElement();
    const extension = core.union(
      basic.defineBasicExtension(),
      // Images can be wider than the text column, like values (Width in the context menu).
      core.defineNodeAttr({
        type: 'image',
        attr: 'layout',
        default: null,
        toDOM: (value: string | null) => (value ? ['data-layout', value] : null),
        parseDOM: (element: HTMLElement) => element.getAttribute('data-layout') || null,
      }),
      noteNodes.defineNoteNodes(this.nodeRenderer, this.liveViews),
      // Syntax highlighting of ```python, ```sql, … (code-highlight.ts, Shiki, lazy).
      codeBlock.defineCodeBlockHighlight({
        parser: codeHighlight.editorCodeParser(pmView.Decoration),
        nodeTypes: ['codeBlock'],
      }),
      dropIndicatorExtension.defineDropIndicator(),
      placeholder.definePlaceholder({
        placeholder: (state) =>
          state.doc.childCount <= 1 ? 'Start writing — type / for blocks, {{ for cell values' : 'Type / for blocks',
      }),
      core.defineDocChangeHandler(() => {
        if (this.instance === null || this.suppressSourceChange) return;
        // Shown image URLs go back to `assets/<name>` (asset-store.ts).
        const markdown = this.assets.fromDisplay(conversion.htmlToMarkdown(this.instance.getDocHTML()));
        if (markdown === this.lastMarkdown) return;
        this.lastMarkdown = markdown;
        this.sourceChange.emit(markdown);
      }),
    );
    this.instance = core.createEditor({ extension });
    this.instance.mount(this.mountRef.nativeElement);
    this.instance.view.setProps({ editable: () => !this.readOnly });
    this.loadSource();
    this.mountRef.nativeElement.addEventListener('contextmenu', this.handleEditorContextMenu);
    this.mountRef.nativeElement.addEventListener('paste', this.handleEditorPaste, true);
    this.mountRef.nativeElement.addEventListener('drop', this.handleEditorDrop, true);
    this.mountRef.nativeElement.addEventListener('dragover', this.handleEditorDragOver, true);
    this.editor.set(this.instance);
    if (this.insertCellTriggerAfterInitialize) {
      requestAnimationFrame(() => {
        this.insertCellTriggerAfterInitialize = false;
        this.focus();
        this.instance?.commands.insertText({ text: '{{ ' });
        this.triggerCurrentAutocomplete();
      });
    }
  }

  /** Replace the document with `source` (another note, or an edit from the Raw view). */
  private loadSource(): void {
    const editor = this.instance;
    const conversion = this.conversion;
    if (editor === null || conversion === null) return;
    this.suppressSourceChange = true;
    editor.setContent(conversion.markdownToHtml(this.assets.toDisplay(this.source)));
    this.suppressSourceChange = false;
    this.lastMarkdown = this.source;
    this.applyInitialImageSizes(conversion.markdownImageSizes(this.source));
  }

  /** Put the cursor at the end of the note, in an empty paragraph (Insert → Block). */
  appendParagraph(): void {
    const editor = this.instance;
    if (editor === null) return;
    const { state } = editor;
    const end = state.doc.content.size;
    const last = state.doc.lastChild;
    let transaction = state.tr;
    if (last === null || last.type.name !== 'paragraph' || last.content.size > 0) {
      transaction = transaction.insert(end, state.schema.nodes['paragraph'].create());
    }
    const selection = this.selectionAtEnd(transaction.doc);
    editor.view.dispatch(transaction.setSelection(selection).scrollIntoView());
    editor.focus();
  }

  protected toggleMark(mark: 'bold' | 'italic' | 'strike' | 'code'): void {
    const editor = this.instance;
    if (editor === null) return;
    const commands = editor.commands as unknown as Record<string, (() => boolean) | undefined>;
    const name = { bold: 'toggleBold', italic: 'toggleItalic', strike: 'toggleStrike', code: 'toggleCode' }[mark];
    commands[name]?.();
    editor.focus();
  }

  focus(): void {
    this.instance?.focus();
  }

  openCellPicker(): void {
    this.widgetCellPending.set(false);
    if (this.instance === null) {
      this.insertCellTriggerAfterInitialize = true;
      return;
    }
    this.focus();
    this.instance?.commands.insertText({ text: '{{ ' });
    this.triggerCurrentAutocomplete();
  }

  openWidgetPicker(): void {
    this.widgetCellPending.set(true);
    if (this.instance === null) {
      this.insertCellTriggerAfterInitialize = true;
      return;
    }
    this.focus();
    this.instance.commands.insertText({ text: '{{ ' });
    this.triggerCurrentAutocomplete();
  }

  openImagePicker(): void {
    this.imageError.set(null);
    this.imageInputRef.nativeElement.click();
  }

  openLinkDialog(): void {
    const editor = this.instance;
    if (editor === null) return;
    const { from, to } = editor.state.selection;
    this.linkSelection = { from, to };
    this.linkText.set(editor.state.doc.textBetween(from, to, ' '));
    this.linkUrl.set('https://');
    this.linkError.set(null);
    this.linkDialogOpen.set(true);
  }

  protected readonly isNoteLink = isNoteLink;

  /** Link to another note of the workbook; its title becomes the text when none is given. */
  protected chooseNoteLink(href: string): void {
    this.linkError.set(null);
    if (href === '') {
      this.linkUrl.set('https://');
      return;
    }
    this.linkUrl.set(href);
    if (this.linkText().trim() === '') {
      this.linkText.set(this.noteLinks.find((note) => note.href === href)?.title ?? '');
    }
  }

  protected closeLinkDialog(): void {
    this.linkDialogOpen.set(false);
    this.linkError.set(null);
    this.instance?.focus();
  }

  protected confirmLink(): void {
    const editor = this.instance;
    if (editor === null) return;
    const href = normalizeLink(this.linkUrl());
    if (href === null) {
      this.linkError.set('Enter a valid web, email, anchor, or relative link.');
      return;
    }
    const max = editor.state.doc.content.size;
    const from = Math.min(max, this.linkSelection.from);
    let to = Math.min(max, this.linkSelection.to);
    const selected = editor.state.doc.textBetween(from, to, ' ');
    const text = this.linkText().trim() || selected || href;
    let transaction = editor.state.tr;
    if (selected !== text) {
      transaction = transaction.insertText(text, from, to);
      to = from + text.length;
    }
    const mark = editor.schema.marks.link.create({ href });
    editor.view.dispatch(transaction.addMark(from, to, mark));
    this.linkDialogOpen.set(false);
    this.linkError.set(null);
    editor.focus();
  }

  protected selectableValues(): MarkdownInterpolationValue[] {
    const seen = new Set<string>();
    return this.values.filter((value) => {
      if (this.widgetCellPending() && !value.editable) return false;
      if (seen.has(value.reference)) return false;
      seen.add(value.reference);
      return true;
    });
  }

  protected executeCommand(command: ProseKitBlockCommand['id']): void {
    const editor = this.instance;
    if (editor === null) return;
    switch (command) {
      case 'text':
        editor.commands.setParagraph();
        break;
      case 'heading-1':
        editor.commands.setHeading({ level: 1 });
        break;
      case 'heading-2':
        editor.commands.setHeading({ level: 2 });
        break;
      case 'heading-3':
        editor.commands.setHeading({ level: 3 });
        break;
      case 'bulleted-list':
        editor.commands.wrapInList({ kind: 'bullet' });
        break;
      case 'numbered-list':
        editor.commands.wrapInList({ kind: 'ordered' });
        break;
      case 'checklist':
        editor.commands.wrapInList({ kind: 'task' });
        break;
      case 'divider':
        editor.commands.insertHorizontalRule();
        break;
      case 'quote':
        editor.commands.setBlockquote();
        break;
      case 'table':
        this.openTableDialog();
        break;
      case 'image': {
        this.openImagePicker();
        break;
      }
      case 'link':
        this.openLinkDialog();
        break;
      case 'code':
        editor.commands.setCodeBlock({ language: 'python' });
        break;
      case 'math': {
        // `$$…$$` with the cursor inside; it becomes a formula when the cursor leaves.
        editor.commands.insertText({ text: '$$$$' });
        const { state } = editor.view;
        editor.view.dispatch(
          state.tr.setSelection(this.selectionModule!.TextSelection.create(state.doc, state.selection.from - 2)),
        );
        break;
      }
      case 'diagram': {
        // A mermaid code block with an example; it renders when the cursor leaves it.
        editor.commands.setCodeBlock({ language: 'mermaid' });
        editor.commands.insertText({ text: 'flowchart LR\n  A[Input] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A' });
        break;
      }
      case 'cell':
        this.widgetCellPending.set(false);
        editor.commands.insertText({ text: '{{ ' });
        this.triggerCurrentAutocomplete();
        break;
      case 'widget':
        this.widgetCellPending.set(true);
        editor.commands.insertText({ text: '{{ ' });
        this.triggerCurrentAutocomplete();
        break;
    }
    editor.focus();
  }

  /** Insert a live value (or, when choosing a widget cell, an input widget). */
  insertCell(reference: string, position?: number): void {
    const editor = this.instance;
    if (editor === null) return;
    const { schema } = editor.state;
    let node;
    if (this.widgetCellPending()) {
      this.widgetCellPending.set(false);
      const label = reference
        .replaceAll('_', ' ')
        .replace(/^./, (character) => character.toUpperCase());
      node = schema.nodes['sheetWidget'].create({
        reference,
        label: `${label}: {{ ${reference} }}`,
        query: '',
      });
    } else {
      node = schema.nodes['cellValue'].create({ expression: reference });
    }
    const transaction =
      position === undefined
        ? editor.state.tr.replaceSelectionWith(node, false)
        : editor.state.tr.insert(position, node);
    editor.view.dispatch(transaction.scrollIntoView());
    this.focus();
  }

  protected handleAutocompleteOpen(event: Event): void {
    this.autocompleteOpen.set(Boolean((event as CustomEvent<boolean>).detail));
  }

  protected handleImageSelection(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) void this.embedImage(file);
  }

  @HostListener('document:click')
  protected closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  protected runTableCommand(
    command:
      | 'row-above'
      | 'row-below'
      | 'column-before'
      | 'column-after'
      | 'delete-row'
      | 'delete-column'
      | 'delete-table',
  ): void {
    const editor = this.instance;
    if (editor === null) return;
    switch (command) {
      case 'row-above':
        editor.commands.addTableRowAbove();
        break;
      case 'row-below':
        editor.commands.addTableRowBelow();
        break;
      case 'column-before':
        editor.commands.addTableColumnBefore();
        break;
      case 'column-after':
        editor.commands.addTableColumnAfter();
        break;
      case 'delete-row':
        editor.commands.deleteTableRow();
        break;
      case 'delete-column':
        editor.commands.deleteTableColumn();
        break;
      case 'delete-table':
        editor.commands.deleteTable();
        break;
    }
    this.contextMenu.set(null);
    editor.focus();
  }

  protected resizeImage(
    menu: Extract<EditorContextMenu, { kind: 'image' | 'plot' }>,
    requestedWidth: number,
  ): void {
    const editor = this.instance;
    const node = editor?.state.doc.nodeAt(menu.pos);
    const expected = menu.kind === 'plot' ? 'cellValue' : 'image';
    if (editor === null || editor === undefined || node?.type.name !== expected) return;
    const width = Math.min(1200, Math.max(80, Math.round(requestedWidth)));
    const height = Math.max(1, Math.round(width / menu.aspectRatio));
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(menu.pos, undefined, { ...node.attrs, width, height }),
    );
    this.contextMenu.set({ ...menu, width });
  }

  protected resetImageSize(menu: Extract<EditorContextMenu, { kind: 'image' | 'plot' }>): void {
    const editor = this.instance;
    const node = editor?.state.doc.nodeAt(menu.pos);
    const expected = menu.kind === 'plot' ? 'cellValue' : 'image';
    if (editor === null || editor === undefined || node?.type.name !== expected) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(menu.pos, undefined, {
        ...node.attrs,
        width: null,
        height: null,
      }),
    );
    this.contextMenu.set(null);
    editor.focus();
  }

  /** Normal, wide, or full width in the note (images and block values). */
  protected setLayout(menu: Extract<EditorContextMenu, { pos: number }>, layout: 'wide' | 'full' | null): void {
    const editor = this.instance;
    const node = editor?.state.doc.nodeAt(menu.pos);
    const expected = menu.kind === 'image' ? 'image' : 'cellValue';
    if (editor === null || editor === undefined || node?.type.name !== expected) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(menu.pos, undefined, { ...node.attrs, layout }));
    this.contextMenu.set({ ...menu, layout });
  }

  private readonly handleEditorContextMenu = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const value = target.closest<HTMLElement>('.cell-value-node');
    if (value !== null) {
      const located = this.locatePlot(value);
      if (located !== null) {
        event.preventDefault();
        event.stopPropagation();
        this.contextMenu.set({ kind: 'plot', x: event.clientX, y: event.clientY, ...located });
        return;
      }
      const block = this.locateBlockValue(value);
      if (block === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.contextMenu.set({ kind: 'value', x: event.clientX, y: event.clientY, ...block });
      return;
    }
    const image = target.closest<HTMLImageElement>('img');
    if (image !== null) {
      const located = this.locateImage(image);
      if (located === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.contextMenu.set({
        kind: 'image',
        x: event.clientX,
        y: event.clientY,
        ...located,
      });
      return;
    }
    if (target.closest('table') === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.contextMenu.set({ kind: 'table', x: event.clientX, y: event.clientY });
  };

  private readonly handleEditorPaste = (event: ClipboardEvent): void => {
    if (this.readOnly) return;
    const file = firstSupportedImage(event.clipboardData?.files, event.clipboardData?.items);
    if (file !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.embedImage(file);
      return;
    }
    // Rich clipboard HTML can carry a temporary blob URL without any FileList.
    // Persist those bytes before letting the editor publish the pasted markup.
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (!html || !/(?:blob:|data:image\/)/i.test(html)) return;
    const document = new DOMParser().parseFromString(html, 'text/html');
    const images = [...document.querySelectorAll<HTMLImageElement>('img[src]')]
      .filter(image => isEmbeddedImage(image.getAttribute('src')!) || /^blob:/i.test(image.getAttribute('src')!));
    if (!images.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.embedClipboardHtml(document, images, event);
  };

  private readonly handleEditorDrop = (event: DragEvent): void => {
    const cellId = event.dataTransfer?.getData(CELL_DRAG_TYPE) ?? '';
    if (cellId !== '' && this.instance !== null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const reference =
        this.values.find((value) => value.cellId === cellId && value.reference !== cellId)
          ?.reference ?? cellId;
      const position = this.instance.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      this.widgetCellPending.set(false);
      this.insertCell(reference, position);
      return;
    }
    const file = firstSupportedImage(event.dataTransfer?.files, event.dataTransfer?.items);
    if (file === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.embedImage(file);
  };

  private readonly handleEditorDragOver = (event: DragEvent): void => {
    if (!hasSupportedImage(event.dataTransfer) && !event.dataTransfer?.types.includes(CELL_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
  };

  private triggerCurrentAutocomplete(): void {
    if (this.instance === null || this.triggerAutocomplete === null) return;
    this.instance.view.dispatch(this.triggerAutocomplete(this.instance.state.tr));
  }

  /** A block value (table, widget, HTML, chart) of a plain reference: it can be made wider. */
  private locateBlockValue(element: HTMLElement): { pos: number; layout: string | null } | null {
    const editor = this.instance;
    if (editor === null || !element.classList.contains('block-value')) return null;
    const pos = editor.view.posAtDOM(element, 0);
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'cellValue') return null;
    // The layout is stored as [{{ name }}](#sheet-output?layout=…), which needs a plain reference.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.attrs['expression'] as string)) return null;
    return { pos, layout: (node.attrs['layout'] as string | null) ?? null };
  }

  /** A live plot (an image inside a value node of a plain reference) and its size. */
  private locatePlot(element: HTMLElement): { pos: number; width: number; aspectRatio: number; layout: string | null } | null {
    const editor = this.instance;
    const image = element.querySelector('img');
    if (editor === null || image === null) return null;
    const pos = editor.view.posAtDOM(element, 0);
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'cellValue') return null;
    // Sizes are stored as [{{ name }}](#sheet-output?…), which needs a plain reference.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.attrs['expression'] as string)) return null;
    const bounds = image.getBoundingClientRect();
    const width = Math.round(Number(node.attrs['width']) || bounds.width || image.naturalWidth || 480);
    const height = Number(node.attrs['height']) || bounds.height || image.naturalHeight;
    return { pos, width, aspectRatio: height > 0 ? width / height : 16 / 9, layout: (node.attrs['layout'] as string | null) ?? null };
  }

  private selectionAtEnd(doc: import('prosekit/pm/model').Node) {
    return this.selectionModule!.Selection.atEnd(doc);
  }

  private locateImage(
    image: HTMLImageElement,
  ): { pos: number; width: number; aspectRatio: number; layout: string | null } | null {
    const editor = this.instance;
    if (editor === null) return null;
    let pos = editor.view.posAtDOM(image, 0);
    let node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'image' && pos > 0) {
      pos -= 1;
      node = editor.state.doc.nodeAt(pos);
    }
    if (node?.type.name !== 'image') return null;
    const bounds = image.getBoundingClientRect();
    const width = Math.round(
      Number(node.attrs['width']) || bounds.width || image.naturalWidth || 480,
    );
    const height = Number(node.attrs['height']) || bounds.height || image.naturalHeight;
    const aspectRatio = height > 0 ? width / height : 16 / 9;
    return { pos, width, aspectRatio, layout: (node.attrs['layout'] as string | null) ?? null };
  }

  private applyInitialImageSizes(
    sizes: ReadonlyArray<{ width?: number; height?: number; layout?: string } | null>,
  ): void {
    const editor = this.instance;
    if (editor === null || sizes.length === 0) return;
    let index = 0;
    let transaction = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image') return true;
      const size = sizes[index++];
      if (size !== null && size !== undefined) {
        transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, ...size });
      }
      return false;
    });
    if (!transaction.docChanged) return;
    this.suppressSourceChange = true;
    editor.view.dispatch(transaction);
    this.suppressSourceChange = false;
  }

  protected openTableDialog(): void {
    this.tableRows.set(3);
    this.tableColumns.set(3);
    this.tableDialogOpen.set(true);
  }

  protected closeTableDialog(): void {
    this.tableDialogOpen.set(false);
    this.instance?.focus();
  }

  protected setTableRows(event: Event): void {
    this.tableRows.set(clampTableSize(Number((event.target as HTMLInputElement).value)));
  }

  protected setTableColumns(event: Event): void {
    this.tableColumns.set(clampTableSize(Number((event.target as HTMLInputElement).value)));
  }

  protected confirmTable(): void {
    const editor = this.instance;
    if (editor === null) return;
    editor.commands.insertTable({
      row: this.tableRows(),
      col: this.tableColumns(),
      header: true,
    });
    this.tableDialogOpen.set(false);
    editor.focus();
  }

  private async embedClipboardHtml(document: Document, images: HTMLImageElement[], event: ClipboardEvent): Promise<void> {
    const editor = this.instance, source = this.source, documentKey = this.documentKey;
    if (editor === null) return;
    try {
      for (const image of images) image.setAttribute('src', await this.assets.importImageSource(image.getAttribute('src')!));
      if (this.instance !== editor || this.documentKey !== documentKey || this.source !== source || this.readOnly) return;
      editor.view.pasteHTML(this.assets.toDisplay(document.body.innerHTML), event);
      this.imageError.set(null);
    } catch (error) {
      this.imageError.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** A pasted or dropped image is stored next to the workbook (shrunk); the note links it. */
  private async embedImage(file: File): Promise<void> {
    const editor = this.instance, documentKey = this.documentKey;
    if (editor === null || this.readOnly) return;
    try {
      const reference = await this.assets.add(file);
      if (this.instance !== editor || this.documentKey !== documentKey || this.readOnly) return;
      this.focus();
      const name = reference.slice(reference.indexOf('/') + 1);
      this.instance.commands.insertImage({ src: this.assets.displayUrl(name) ?? reference });
      this.imageError.set(null);
    } catch (error) {
      this.imageError.set(error instanceof Error ? error.message : String(error));
    }
  }
}

function clampTableSize(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(20, Math.max(1, value!)) : 3;
}

export function normalizeLink(source: string): string | null {
  const value = source.trim();
  if (value === '') return null;
  if (/^(?:#|\/|\.\.\/|\.\/)/u.test(value)) return value;
  if (/^www\./iu.test(value)) return `https://${value}`;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(value)?.[1]?.toLowerCase();
  if (scheme !== undefined && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return null;
  try {
    const parsed = new URL(scheme === undefined ? `https://${value}` : value);
    return parsed.href;
  } catch {
    return null;
  }
}
