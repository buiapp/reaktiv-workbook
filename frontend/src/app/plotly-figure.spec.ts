import { afterEach, beforeEach, vi } from 'vitest';
import { registerPlotlyFigure, withoutWebGL } from './plotly-figure';

describe('Plotly charts without WebGL', () => {
  it('draws WebGL traces with their SVG equivalents and keeps everything else', () => {
    const line = { type: 'scattergl', mode: 'lines', x: [1, 2], y: [3, 4] };
    const { data, changed } = withoutWebGL([line, { type: 'bar', x: [1] }, { type: 'heatmapgl', z: [[1]] }, { type: 'scatterpolargl' }]);
    expect(changed).toBe(true);
    expect(data).toEqual([
      { type: 'scatter', mode: 'lines', x: [1, 2], y: [3, 4] },
      { type: 'bar', x: [1] },
      { type: 'heatmap', z: [[1]] },
      { type: 'scatterpolar' },
    ]);
    expect(line.type).toBe('scattergl'); // the spec itself is not changed
    expect(withoutWebGL([{ type: 'scatter' }]).changed).toBe(false);
  });
});

describe('resampled charts', () => {
  it('says how much of the signal is shown', async () => {
    const { resampleNote } = await import('./plotly-figure');
    expect(resampleNote(4000, 2_000_000)).toBe('4,000 of 2,000,000 points in view · zoom for detail');
    expect(resampleNote(403, 2_000_000, 401)).toBe('all 401 points in view · 2,000,000 in total');
    expect(resampleNote(1000, 1000)).toBe('all 1,000 points');
  });
});

const plotting = vi.hoisted(() => ({
  newPlot: vi.fn(), react: vi.fn(), relayout: vi.fn(), purge: vi.fn(), Plots: { resize: vi.fn() },
}));
vi.mock('plotly.js-dist-min', () => ({ default: plotting }));

describe('chart render scheduling', () => {
  let chart: HTMLElement;
  let notifyResize: () => void;
  const spec = (x: number) => btoa(JSON.stringify({ data: [{ type: 'scatter', x: [x] }] }));
  beforeEach(() => {
    vi.clearAllMocks();
    plotting.newPlot.mockResolvedValue(undefined);
    plotting.react.mockResolvedValue(undefined);
    plotting.relayout.mockResolvedValue(undefined);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    });
    registerPlotlyFigure();
    chart = document.createElement('reaktiv-plotly');
  });
  afterEach(async () => {
    chart.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
  });

  it('draws once when connection and attribute callbacks overlap', async () => {
    let finish!: () => void;
    plotting.newPlot.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    chart.setAttribute('data-spec', spec(1));
    document.body.append(chart);
    chart.setAttribute('data-spec', spec(1));
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledTimes(1));
    chart.setAttribute('data-spec', spec(2));
    chart.setAttribute('data-spec', spec(3));
    expect(plotting.react).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(plotting.react).toHaveBeenCalledTimes(1));
    expect(plotting.react.mock.calls[0][1]).toEqual([{ type: 'scatter', x: [3] }]);
    expect(plotting.newPlot).toHaveBeenCalledTimes(1);
  });

  it('cleans up a pending render after removal and draws again on reconnection', async () => {
    let finish!: () => void;
    plotting.newPlot.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    chart.setAttribute('data-spec', spec(1));
    document.body.append(chart);
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledTimes(1));
    chart.remove();
    document.body.append(chart);
    finish();
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledTimes(2));
    expect(plotting.purge).toHaveBeenCalledWith(chart);
    expect(plotting.react).not.toHaveBeenCalled();
  });

  it('keeps live data updates inside the tile even when each figure supplies fixed dimensions', async () => {
    chart.classList.add('tile-chart');
    let width = 640, height = 320;
    Object.defineProperties(chart, {
      clientWidth: {get: () => width},
      clientHeight: {get: () => height},
    });
    chart.setAttribute('data-spec', spec(1));
    document.body.append(chart);
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledOnce());
    const update = (point: number) => btoa(JSON.stringify({
      data: [{type: 'scatter', x: [1, point]}],
      layout: {width: 1600, height: 1000, autosize: false, title: {text: 'Live sweep'}},
    }));
    const encoded = update(2);
    chart.setAttribute('data-spec', encoded);
    await vi.waitFor(() => expect(plotting.react).toHaveBeenCalledOnce());
    expect(plotting.react.mock.calls[0][2]).toMatchObject({width: 640, height: 320, autosize: true, title: {text: 'Live sweep'}});
    // Layout pixels remain independent of CSS zoom or transforms.
    width = 480; height = 240;
    chart.setAttribute('data-spec', update(3));
    await vi.waitFor(() => expect(plotting.react).toHaveBeenCalledTimes(2));
    expect(plotting.react.mock.calls[1][2]).toMatchObject({width: 480, height: 240});
    expect(JSON.parse(atob(encoded)).layout).toMatchObject({width: 1600, height: 1000, autosize: false});
  });

  it('preserves authored dimensions outside a fitted grid or graph tile', async () => {
    chart.setAttribute('data-spec', btoa(JSON.stringify({data: [], layout: {height: 600, autosize: false}})));
    document.body.append(chart);
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledOnce());
    expect(plotting.newPlot.mock.calls[0][2]).toMatchObject({height: 600, autosize: false});
  });

  it('fits tile-only resizes without changing data and coalesces resizes during drawing', async () => {
    chart.classList.add('tile-chart');
    let width = 640, height = 320;
    Object.defineProperties(chart, {
      clientWidth: {get: () => width}, clientHeight: {get: () => height},
    });
    let finish!: () => void;
    plotting.newPlot.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
    const encoded = spec(1);
    chart.setAttribute('data-spec', encoded);
    document.body.append(chart);
    await vi.waitFor(() => expect(plotting.newPlot).toHaveBeenCalledOnce());
    width = 480; height = 240; notifyResize();
    width = 400; height = 200; notifyResize();
    expect(plotting.relayout).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(plotting.relayout).toHaveBeenCalledOnce());
    expect(plotting.relayout).toHaveBeenLastCalledWith(chart, {width: 400, height: 200, autosize: true});
    width = 800; height = 400; notifyResize();
    await vi.waitFor(() => expect(plotting.relayout).toHaveBeenCalledTimes(2));
    expect(plotting.relayout).toHaveBeenLastCalledWith(chart, {width: 800, height: 400, autosize: true});
    expect(chart.getAttribute('data-spec')).toBe(encoded);
    expect(plotting.react).not.toHaveBeenCalled();
    expect(plotting.Plots.resize).not.toHaveBeenCalled();
    chart.remove(); notifyResize();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(plotting.relayout).toHaveBeenCalledTimes(2);
  });
});

it('defers offscreen chart drawing, coalesces hidden updates, and releases observation on removal', async () => {
  let notify!: (entries: {isIntersecting:boolean}[]) => void;
  const disconnect=vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof notify){notify=callback;}
    observe(){} disconnect=disconnect;
  });
  vi.stubGlobal('ResizeObserver', class {observe(){}disconnect(){}});
  vi.clearAllMocks();plotting.newPlot.mockResolvedValue(undefined);
  registerPlotlyFigure();const chart=document.createElement('reaktiv-plotly');
  const spec=(x:number)=>btoa(JSON.stringify({data:[{type:'scatter',x:[x]}]}));
  try {
    chart.setAttribute('data-spec',spec(1));document.body.append(chart);
    await new Promise(resolve=>setTimeout(resolve,50));expect(plotting.newPlot).not.toHaveBeenCalled();
    chart.setAttribute('data-spec',spec(2));chart.setAttribute('data-spec',spec(3));
    notify([{isIntersecting:true}]);
    await vi.waitFor(()=>expect(plotting.newPlot).toHaveBeenCalledTimes(1));
    expect(plotting.newPlot.mock.calls[0][1]).toEqual([{type:'scatter',x:[3]}]);
    notify([{isIntersecting:false}]);chart.setAttribute('data-spec',spec(4));
    await new Promise(resolve=>setTimeout(resolve,50));expect(plotting.react).not.toHaveBeenCalled();
    notify([{isIntersecting:true}]);await vi.waitFor(()=>expect(plotting.react).toHaveBeenCalledTimes(1));
    expect(plotting.react.mock.calls[0][1]).toEqual([{type:'scatter',x:[4]}]);
    chart.remove();expect(disconnect).toHaveBeenCalled();
  } finally {chart.remove();vi.unstubAllGlobals();}
});
