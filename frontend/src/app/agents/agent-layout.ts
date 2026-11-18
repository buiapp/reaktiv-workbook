import type { CellDefinition, CellResult } from '../sheet.types';
import { cellPosition, columnLabel } from '../cell-selection';
import { splitCellId } from '../sheet-file';
import { assertCellPlacements } from '../cell-placement';
import { widgetFor } from '../dashboard';

interface Size { width: number; height: number; }
export interface AgentWorksheetLayout {
  name?: string;
  columns: number; rows: number;
  columnWidths: Record<string, number>; rowHeights: Record<string, number>;
}
export interface AgentLayoutMeasurement {
  pane: number;
  view: string;
  zoom: number;
  status: 'measured' | 'unmeasured' | 'render-pending' | 'opaque';
  reason?: string;
  visible: boolean;
  viewportClipped?: boolean;
  outerPx?: Size;
  usablePx?: Size;
  contentPx?: Size;
  overflow?: {horizontal: boolean; vertical: boolean};
  clipped?: boolean | null;
  scrollable?: boolean;
}
export interface AgentCellLayout {
  cellId: string; worksheet: string; worksheetPrefix: string; contentKind: string; renderedInGrid: boolean;
  units: 'unzoomed-css-pixels'; sampledAt: string;
  storedSpan: readonly number[]; displayedSpan: number[];
  gridSizePx: Size; displayedGridSizePx: Size;
  fit: {status: 'too-small' | 'measured-fit' | 'estimated-fit' | 'unknown'; resizeNeeded: boolean | null; reason: string};
  status: AgentLayoutMeasurement['status']; panes: AgentLayoutMeasurement[];
  recommendation: {
    basis: 'estimated-minimum'; appliesTo: 'worksheet-grid'; minimumContentPx: Size; minimumOuterPx: Size;
    suggestedSpan: number[]; meetsMinimum: boolean; placementValid: boolean; placementError: string | null;
    requiredGrid: {columns: number; rows: number}; requiresGridExpansion: boolean;
    trackSizing: {rowHeights: Record<string, number>; columnWidths: Record<string, number>;
      meetsMinimum: boolean; affectsSharedTracks: true};
    explanation: string;
  };
}

const keys = new WeakMap<CellDefinition, string>();
let keySequence = 0;
/** DOM acknowledgement of the immutable definition, without copying widget payloads into attributes. */
export function agentCellLayoutKey(cell: CellDefinition | undefined): string {
  if (!cell) return '';
  let key = keys.get(cell);
  if (key === undefined) { key = String(++keySequence); keys.set(cell, key); }
  return key;
}

function contentInfo(cell: CellDefinition, result: CellResult | undefined): {kind: string; minimum: Size} {
  if (result?.error) return {kind: 'value-preview', minimum: {width: 96, height: 28}};
  const mime = result?.richOutput?.mimeType;
  if (mime === 'application/vnd.plotly.v1+json') return {kind: 'plotly', minimum: {width: 480, height: 300}};
  if (mime === 'application/vnd.anywidget+json') return {kind: 'anywidget', minimum: {width: 320, height: 240}};
  if (mime === 'text/html') return {kind: 'html', minimum: {width: 240, height: 120}};
  if (mime?.startsWith('image/')) return {kind: 'image', minimum: {width: 320, height: 240}};
  if (result?.table) return {kind: 'table', minimum: {width: 360, height: 180}};
  if (cell.kind === 'markdown') return {kind: 'markdown', minimum: {width: 96, height: 32}};
  if (cell.kind === 'input' || cell.kind === 'linked') {
    const type = (result?.widget ?? widgetFor(result?.value, cell.view?.widget)).type;
    const minimum: Record<string, Size> = {
      checkbox: {width: 56, height: 30}, number: {width: 112, height: 34}, range: {width: 180, height: 36},
      textarea: {width: 220, height: 120}, list: {width: 220, height: 160}, multiselect: {width: 220, height: 160},
      radio: {width: 200, height: 100}, button: {width: 128, height: 40},
    };
    return {kind: 'widget:' + type, minimum: minimum[type] ?? {width: 160, height: 36}};
  }
  return {kind: 'rendered-value', minimum: {width: 96, height: 32}};
}

function gridSize(column: number, row: number, width: number, height: number, layout: AgentWorksheetLayout): Size {
  let w = 0, h = 0;
  for (let offset = 0; offset < width; offset++) w += layout.columnWidths[columnLabel(column + offset)] ?? 112;
  for (let offset = 0; offset < height; offset++) h += layout.rowHeights[String(row + offset)] ?? 45;
  return {width: w, height: h};
}

function visibleBox(element: HTMLElement): {visible: boolean; clipped: boolean} {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    // Single-pane workspace wrappers use display:contents: they have no clipping box.
    if (style.display === 'contents') continue;
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);}
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);}
  }
  const style = getComputedStyle(element);
  return {visible: right > left && bottom > top && style.visibility !== 'hidden' && style.display !== 'none',
    clipped: left > rect.left + 1 || top > rect.top + 1 || right < rect.right - 1 || bottom < rect.bottom - 1};
}

function measure(element: HTMLElement, cell: CellDefinition, revision: string | undefined): AgentLayoutMeasurement {
  const viewport = visibleBox(element);
  const base = {pane: Number(element.dataset['agentPane']), view: element.dataset['agentView'] ?? 'sheet',
    zoom: Number(element.dataset['agentZoom'] ?? 1), visible: viewport.visible};
  if (!viewport.visible || !element.clientWidth || !element.clientHeight)
    return {...base, status: 'unmeasured', reason: 'Cell is hidden or outside the visible scroll viewport.'};
  if (element.dataset['agentLayoutKey'] !== agentCellLayoutKey(cell) ||
      (element.dataset['agentLayoutRevision'] ?? '') !== (revision ?? ''))
    return {...base, status: 'render-pending', reason: 'The DOM has not acknowledged the current view/output revision. Inspect again after rendering.'};
  const container = base.view === 'graph' ? element.querySelector<HTMLElement>('.graph-node-output') : element;
  if (!container) return {...base, status: 'unmeasured', reason: 'Graph output is not displayed.'};
  const style = getComputedStyle(container);
  const n = (value: string) => Number.parseFloat(value) || 0;
  const usable = {width: Math.max(0, container.clientWidth - n(style.paddingLeft) - n(style.paddingRight)),
    height: Math.max(0, container.clientHeight - n(style.paddingTop) - n(style.paddingBottom))};
  const measured = {...base, viewportClipped: viewport.clipped, outerPx: {width: element.offsetWidth, height: element.offsetHeight}, usablePx: usable};
  const content = container.querySelector<HTMLElement>(':scope > .tile-widget, :scope > .tile-plot, :scope > .tile-html, :scope > .tile-table, :scope > .tile-note, :scope > .cell-value, :scope > .tile-kpi, :scope > .cell-error');
  if (!content) return {...measured, status: 'render-pending', reason: 'Rendered content is not available yet.'};
  const contentStyle = getComputedStyle(content);
  if (contentStyle.display === 'none' || contentStyle.visibility === 'hidden')
    return {...measured, status: 'unmeasured', reason: 'Rendered content is intentionally hidden.'};
  const plot = content.tagName === 'REAKTIV-PLOTLY' ? content as HTMLElement & {renderStatus?: string} : null;
  if (plot?.renderStatus === 'error')
    return {...measured, status: 'unmeasured', reason: 'Chart renderer failed; inspect the output instead of waiting for fit measurements.'};
  if ((plot && plot.renderStatus !== 'ready') || [...content.querySelectorAll('img')].some(image => !image.complete) ||
      (content instanceof HTMLImageElement && !content.complete))
    return {...measured, status: 'render-pending', reason: 'Chart/image rendering is pending or failed; no fit claim is available.'};
  if (content.tagName === 'REAKTIV-ANYWIDGET')
    return {...measured, status: 'opaque', clipped: null, reason: 'Sandboxed widget internals cannot be measured by the app. Dimensions are a readability estimate.'};
  // Include nested scrolling wrappers (tables, text controls), without inspecting iframe documents.
  const nodes = [content, ...content.querySelectorAll<HTMLElement>('table, input, select, textarea')];
  if (content.shadowRoot) nodes.push(...content.shadowRoot.querySelectorAll<HTMLElement>(':scope > *:not(style)'));
  const contentPx = {width: Math.max(...nodes.map(node => Math.max(node.offsetWidth, node.scrollWidth))),
    height: Math.max(...nodes.map(node => Math.max(node.offsetHeight, node.scrollHeight)))};
  const overflow = {horizontal: contentPx.width > usable.width + 1, vertical: contentPx.height > usable.height + 1};
  const scrollable = [container, ...nodes].some(node => {
    const css = getComputedStyle(node);
    return ((node.scrollWidth > node.clientWidth + 1) && /(auto|scroll)/.test(css.overflowX)) ||
      ((node.scrollHeight > node.clientHeight + 1) && /(auto|scroll)/.test(css.overflowY));
  });
  return {...measured, status: 'measured', contentPx, overflow, clipped: overflow.horizontal || overflow.vertical, scrollable};
}

/** Passive UI inspection. Never scroll, switch panes, evaluate Python or read graph layouts. */
export function inspectCellLayouts(cells: readonly CellDefinition[], results: readonly CellResult[], ids: readonly string[],
  layoutOf: (sheet: string) => AgentWorksheetLayout, revision: string | undefined, root: ParentNode = document): AgentCellLayout[] {
  const wanted = new Set(ids), resultMap = new Map(results.map(result => [result.id, result]));
  const elements = new Map<string, HTMLElement[]>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-agent-cell-id]')) {
    const id = element.dataset['agentCellId']!;
    if (wanted.has(id)) elements.set(id, [...(elements.get(id) ?? []), element]);
  }
  return cells.filter(cell => wanted.has(cell.id)).map(cell => {
    const [sheet] = splitCellId(cell.id), [column, row] = cellPosition(cell.id), layout = layoutOf(sheet);
    const storedSpan = cell.view?.span ?? [1, 1];
    const displayedSpan = [Math.max(0, Math.min(storedSpan[0], layout.columns - column + 1)), Math.max(0, Math.min(storedSpan[1], layout.rows - row + 1))];
    const info = contentInfo(cell, resultMap.get(cell.id)), panes = (elements.get(cell.id) ?? []).map(element => measure(element, cell, revision));
    const measured = panes.find(pane => pane.view === 'sheet' && pane.status === 'measured');
    const chrome = measured?.outerPx && measured.usablePx ? {
      width: measured.outerPx.width - measured.usablePx.width, height: measured.outerPx.height - measured.usablePx.height} : {width: 16, height: 20};
    const minimum = {width: Math.max(info.minimum.width, measured?.overflow?.horizontal ? measured.contentPx?.width ?? 0 : 0) + chrome.width,
      height: Math.max(info.minimum.height, measured?.overflow?.vertical ? measured.contentPx?.height ?? 0 : 0) + chrome.height};
    let width = 1, height = 1;
    while (width < 50 && gridSize(column, row, width, 1, layout).width < minimum.width) width++;
    while (height < 50 && gridSize(column, row, 1, height, layout).height < minimum.height) height++;
    const trackSizing: AgentCellLayout['recommendation']['trackSizing'] = {rowHeights: {}, columnWidths: {}, meetsMinimum: false, affectsSharedTracks: true};
    let trackWidth = 0, trackHeight = 0;
    for (let offset = 0; offset < displayedSpan[0]; offset++) {
      const key = columnLabel(column + offset), current = layout.columnWidths[key] ?? 112;
      const proposed = Math.min(480, Math.max(current, Math.ceil(minimum.width / displayedSpan[0])));
      if (proposed !== current) trackSizing.columnWidths[key] = proposed;
      trackWidth += proposed;
    }
    for (let offset = 0; offset < displayedSpan[1]; offset++) {
      const key = String(row + offset), current = layout.rowHeights[key] ?? 45;
      const proposed = Math.min(240, Math.max(current, Math.ceil(minimum.height / displayedSpan[1])));
      if (proposed !== current) trackSizing.rowHeights[key] = proposed;
      trackHeight += proposed;
    }
    trackSizing.meetsMinimum = trackWidth >= minimum.width && trackHeight >= minimum.height;
    const size = gridSize(column, row, width, height, layout);
    let placementError: string | null = null;
    try { assertCellPlacements(cells.map(item => item.id === cell.id ? {...item, view: {...item.view, span: [width, height] as [number, number]}} : item), new Set([cell.id])); }
    catch (error) { placementError = error instanceof Error ? error.message : String(error); }
    const requiredGrid = {columns: Math.max(layout.columns, column + width - 1), rows: Math.max(layout.rows, row + height - 1)};
    const status = panes.some(pane => pane.status === 'measured') ? 'measured' : panes.some(pane => pane.status === 'render-pending') ? 'render-pending' : panes.some(pane => pane.status === 'opaque') ? 'opaque' : 'unmeasured';
    const currentSize = gridSize(column, row, displayedSpan[0], displayedSpan[1], layout);
    const tooSmall = cell.view?.display === 'rendered' && (currentSize.width < minimum.width || currentSize.height < minimum.height || panes.some(pane => pane.clipped === true));
    const fit: AgentCellLayout['fit'] = cell.view?.display !== 'rendered' ?
      {status:'unknown', resizeNeeded:null, reason:'Rendered/widget view is not enabled in the grid.'} :
      tooSmall ? {status:'too-small', resizeNeeded:true, reason:'Current span is below the readability minimum or measured content overflows. Use recommendation.trackSizing to enlarge existing tracks, or suggestedSpan when placementValid; inspect again.'} :
      measured ? {status:'measured-fit', resizeNeeded:false, reason:'Current measured content fits and meets the readability estimate.'} :
      {status:'estimated-fit', resizeNeeded:null, reason:'Span meets the size estimate, but content fit is not measured. Hidden/pending/sandboxed content may still need resizing.'};
    return {cellId: cell.id, worksheet: layout.name ?? sheet, worksheetPrefix: sheet, contentKind: info.kind, renderedInGrid: cell.view?.display === 'rendered', units: 'unzoomed-css-pixels', sampledAt: new Date().toISOString(),
      storedSpan, displayedSpan, gridSizePx: gridSize(column, row, storedSpan[0], storedSpan[1], layout),
      displayedGridSizePx: gridSize(column, row, displayedSpan[0], displayedSpan[1], layout), status, panes, fit,
      recommendation: {trackSizing, basis: 'estimated-minimum', appliesTo: 'worksheet-grid', minimumContentPx: info.minimum, minimumOuterPx: minimum,
        suggestedSpan: [width, height], meetsMinimum: size.width >= minimum.width && size.height >= minimum.height,
        placementValid: placementError === null, placementError, requiredGrid,
        requiresGridExpansion: requiredGrid.columns !== layout.columns || requiredGrid.rows !== layout.rows,
        explanation: 'Readability heuristic plus observed overflow at the current wrapping. Not a guaranteed fit; inspect again after resizing. Plotly may fit without overflowing yet be too small to read.'}};
  });
}
