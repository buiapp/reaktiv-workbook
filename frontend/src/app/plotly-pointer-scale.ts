/** Plotly 4 accounts for CSS transforms, but omits native CSS zoom in its inverse
 * pointer matrix. Keep this compatibility patch local to our chart element. */
interface PointerLayout {
  _calcInverseTransform(root: HTMLElement): void;
  _invTransform: number[][];
  _invScaleX: number;
  _invScaleY: number;
}
interface Correction {
  layout: PointerLayout;
  original: PointerLayout['_calcInverseTransform'];
  wrapped: PointerLayout['_calcInverseTransform'];
  base: number[][];
  scaleX: number;
  scaleY: number;
  adjusted?: number[][];
  zoom?: number;
}
const corrections = new WeakMap<HTMLElement, Correction>();

function cssZoom(root: HTMLElement): number {
  // Engines exposing cumulative CSS zoom avoid a style walk on pointer moves.
  const native = (root as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom;
  if (typeof native === 'number' && Number.isFinite(native) && native > 0) return native;
  let zoom = 1;
  for (let element: Element | null = root; element;) {
    const raw = getComputedStyle(element).getPropertyValue('zoom');
    const factor = parseFloat(raw) / (raw.endsWith('%') ? 100 : 1);
    if (Number.isFinite(factor) && factor > 0) zoom *= factor;
    const tree = element.getRootNode();
    element = element.parentElement ?? (tree instanceof ShadowRoot ? tree.host : null);
  }
  return zoom;
}

function restore(layout: PointerLayout, state: Correction): void {
  if (layout._invTransform !== state.adjusted) return;
  layout._invTransform = state.base;
  layout._invScaleX = state.scaleX;
  layout._invScaleY = state.scaleY;
}

/** Called after drawing and before Plotly consumes pointer/wheel/touch events.
 * Relayout/react can replace the callback or layout; never stack our wrappers. */
export function correctPlotlyPointerScale(root: HTMLElement): void {
  const layout = (root as HTMLElement & {_fullLayout?: PointerLayout})._fullLayout;
  if (!layout || typeof layout._calcInverseTransform !== 'function') return;
  const previous = corrections.get(root);
  if (previous?.layout === layout && layout._calcInverseTransform === previous.wrapped) {
    previous.wrapped(root);
    return;
  }
  if (previous) restore(layout, previous);
  const original = layout._calcInverseTransform === previous?.wrapped ? previous.original : layout._calcInverseTransform;
  const state: Correction = {
    layout, original, base: layout._invTransform, scaleX: layout._invScaleX, scaleY: layout._invScaleY,
    wrapped: chart => {
      original.call(layout, chart);
      const changed = layout._invTransform !== state.adjusted;
      if (changed) {
        state.base = layout._invTransform;
        state.scaleX = layout._invScaleX;
        state.scaleY = layout._invScaleY;
      }
      const zoom = cssZoom(chart);
      if (!changed && zoom === state.zoom) return;
      state.zoom = zoom;
      // Transform incoming screen-space x/y; leave z and translation intact.
      state.adjusted = zoom === 1 ? state.base : state.base.map(row => row.map((value, i) => i < 2 ? value / zoom : value));
      layout._invTransform = state.adjusted;
      layout._invScaleX = state.scaleX / zoom;
      layout._invScaleY = state.scaleY / zoom;
    },
  };
  corrections.set(root, state);
  state.wrapped(root);
}

export function clearPlotlyPointerScale(root: HTMLElement): void {
  const state = corrections.get(root);
  if (!state) return;
  if (state.layout._calcInverseTransform === state.wrapped) state.layout._calcInverseTransform = state.original;
  restore(state.layout, state);
  corrections.delete(root);
}
