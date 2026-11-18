import { clearPlotlyPointerScale, correctPlotlyPointerScale } from './plotly-pointer-scale';

function figure(zoom = 0.5, inverse = 1) {
  const root = document.createElement('div');
  Object.defineProperty(root, 'currentCSSZoom', {get: () => zoom, configurable: true});
  const matrix = () => [[inverse, 0, 0, 7], [0, inverse, 0, 9], [0, 0, 1, 0], [0, 0, 0, 1]];
  const layout = {_invTransform: matrix(), _invScaleX: inverse, _invScaleY: inverse,
    _calcInverseTransform: vi.fn((_root: HTMLElement) => {})};
  Object.assign(root, {_fullLayout: layout});
  return {root, layout, zoom: (value: number) => { zoom = value; }};
}

it('compensates CSS zoom alongside existing transform scaling without compounding or changing translations', () => {
  const {root, layout, zoom} = figure(0.5, 2);
  const original = layout._calcInverseTransform;
  const base = layout._invTransform;
  correctPlotlyPointerScale(root);
  expect(layout._invScaleX).toBe(4);
  expect(layout._invTransform[0]).toEqual([4, 0, 0, 7]);
  expect(layout._invTransform[1]).toEqual([0, 4, 0, 9]);
  const patched = layout._calcInverseTransform;
  correctPlotlyPointerScale(root);
  expect(layout._invScaleX).toBe(4);
  expect(layout._calcInverseTransform).toBe(patched);
  zoom(1.25); correctPlotlyPointerScale(root);
  expect(layout._invScaleX).toBeCloseTo(1.6);
  zoom(1); correctPlotlyPointerScale(root);
  expect(layout._invTransform).toBe(base);
  expect(layout._invScaleX).toBe(2);
  clearPlotlyPointerScale(root);
  expect(layout._calcInverseTransform).toBe(original);
  expect(layout._invScaleY).toBe(2);
});

it('tracks original matrix recalculation and survives a Plotly relayout resetting its callback', () => {
  const {root, layout} = figure();
  correctPlotlyPointerScale(root);
  layout._invTransform = [[3, 0, 0, 0], [0, 3, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  layout._invScaleX = layout._invScaleY = 3;
  correctPlotlyPointerScale(root);
  expect(layout._invScaleX).toBe(6);
  // Plotly can reinstall its original callback without replacing the last matrix.
  const original = vi.fn((_root: HTMLElement) => {});
  layout._calcInverseTransform = original;
  correctPlotlyPointerScale(root);
  expect(layout._invScaleX).toBe(6);
  clearPlotlyPointerScale(root);
  expect(layout._calcInverseTransform).toBe(original);
  expect(layout._invScaleX).toBe(3);
});

it('includes nested zoom and shadow hosts in browsers without currentCSSZoom', () => {
  const host = document.createElement('div'); host.style.setProperty('zoom', '0.5');
  const shadow = host.attachShadow({mode: 'open'});
  const {root, layout} = figure();
  Reflect.deleteProperty(root, 'currentCSSZoom');
  root.style.setProperty('zoom', '1.25');
  shadow.append(root); document.body.append(host);
  try {
    correctPlotlyPointerScale(root);
    expect(layout._invScaleX).toBeCloseTo(1.6);
    clearPlotlyPointerScale(root);
  } finally {host.remove();}
});

it('ignores undrawn charts', () => {
  const root = document.createElement('div');
  expect(() => correctPlotlyPointerScale(root)).not.toThrow();
  expect(() => clearPlotlyPointerScale(root)).not.toThrow();
});
