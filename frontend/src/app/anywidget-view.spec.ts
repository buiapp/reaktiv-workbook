import { describe, expect, it } from 'vitest';
import { splitWidgetChange } from './anywidget-view';
import { pythonLiteral } from './input-widgets';

describe('bound widgets', () => {
  it('writes bound traits to their input cells and keeps the rest in the widget', () => {
    expect(splitWidgetChange({ x: 3.5, y: -1, playing: true }, { x: 'A2', y: 'Sheet2!A3' }, pythonLiteral)).toEqual({
      inputs: [
        { cellId: 'A2', source: '3.5' },
        { cellId: 'Sheet2!A3', source: '-1' },
      ],
      own: { playing: true },
      errors: [],
    });
    expect(splitWidgetChange({ value: 1 }, undefined, pythonLiteral).own).toEqual({ value: 1 });
  });

  it('reports values that have no Python literal instead of writing them', () => {
    const change = splitWidgetChange({ data: { $binary: 'AA==' }, at: Number.NaN }, { at: 'A1' }, pythonLiteral);
    expect(change.inputs).toEqual([]);
    expect(change.own).toEqual({ data: { $binary: 'AA==' } });
    expect(change.errors[0]).toContain("The widget's at cannot be written to input cell A1");
  });

  it('turns widget values into Python literals', () => {
    expect(pythonLiteral(true)).toBe('True');
    expect(pythonLiteral(null)).toBe('None');
    expect(pythonLiteral('say "hi"')).toBe('"say \\"hi\\""');
    expect(pythonLiteral([1, 'a', [false]])).toBe('[1, "a", [False]]');
    expect(pythonLiteral({ low: 0, tags: ['x'] })).toBe('{"low": 0, "tags": ["x"]}');
    expect(pythonLiteral(Number.POSITIVE_INFINITY)).toBeNull();
    expect(pythonLiteral(new Date())).toBeNull();
  });
});
