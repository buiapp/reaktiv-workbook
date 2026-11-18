/** Pure helpers shared by widget authoring, serialization, and resolved controls. */
import type { WidgetType } from './input-widgets';
import type { CellWidget, ResolvedCellWidget, WidgetExpression } from './sheet.types';

export const WIDGET_SETTINGS = ['min', 'max', 'step', 'options', 'label', 'placeholder', 'disabled', 'visible', 'loading', 'pressed'] as const;
export type WidgetSetting = typeof WIDGET_SETTINGS[number];
export const WIDGET_STATES = ['disabled', 'visible', 'loading', 'pressed'] as const;

export function isWidgetExpression(value: unknown): value is WidgetExpression {
  return value !== null && typeof value === 'object' && 'expr' in value && typeof (value as WidgetExpression).expr === 'string';
}

export function widgetExpression(key: WidgetSetting, value: unknown): string | null {
  if (isWidgetExpression(value)) return value.expr;
  return ['min', 'max', 'step', 'options'].includes(key) && typeof value === 'string' ? value : null;
}

/** The widgets whose cell can update while they are being edited (see `debounce`). */
export const DEBOUNCED_WIDGETS: readonly WidgetType[] = ['range', 'text', 'number'];
/** Whole milliseconds from 0 to 10 s, as the Python side validates it. */
export function isWidgetDebounce(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

/**
 * Update timing while a widget is edited, or null when it updates only when the edit is
 * committed. Sliders follow the drag (150 ms after it pauses, at least every 400 ms) unless
 * `debounce` says otherwise; text and number fields update while typing only with `debounce`.
 */
export function liveUpdateTiming(type: WidgetType, debounce: number | undefined): { wait: number; maxWait: number } | null {
  if (!DEBOUNCED_WIDGETS.includes(type)) return null;
  if (debounce === undefined) return type === 'range' ? { wait: 150, maxWait: 400 } : null;
  return { wait: debounce, maxWait: Math.max(debounce, 400) };
}

/** Configuration disables interaction; underlying inputs remain writable by Python. */
export function widgetBlocked(widget: Pick<ResolvedCellWidget, 'disabled' | 'visible' | 'loading'>): boolean {
  return widget.disabled === true || widget.visible === false || widget.loading === true;
}

export function widgetSettingText(widget: CellWidget | undefined, key: WidgetSetting): string {
  const value = widget?.[key];
  if (isWidgetExpression(value)) return '=' + value.expr;
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return typeof value === 'string' ? value : '';
}
