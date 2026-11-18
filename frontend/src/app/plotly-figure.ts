/**
 * `<reaktiv-plotly data-spec="<base64 JSON>">` draws a Plotly figure (the rich output of
 * a cell returning a plotly Figure, see rich_output.py). A custom element so it works in
 * Angular templates and in HTML the note editor renders. plotly.js (~4.8 MB) is loaded
 * the first time a chart appears, never at startup.
 */

import { clearPlotlyPointerScale, correctPlotlyPointerScale } from './plotly-pointer-scale';
import { scheduleChartDraw } from './chart-draw-queue';

export const PLOTLY_MIME_TYPE = 'application/vnd.plotly.v1+json';

interface PlotlyModule {
  toImage(figure: unknown, options: { format: 'png'; width: number; height: number }): Promise<string>;
  newPlot(root: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>;
  react(root: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>;
  relayout(root: HTMLElement, layout: unknown): Promise<unknown>;
  purge(root: HTMLElement): void;
  restyle(root: HTMLElement, update: Record<string, unknown[]>, traces: number[]): Promise<unknown>;
  Plots: { resize(root: HTMLElement): void };
}

let plotly: Promise<PlotlyModule> | null = null;

function loadPlotly(): Promise<PlotlyModule> {
  plotly ??= import('plotly.js-dist-min').then(
    (module) => ((module as { default?: PlotlyModule }).default ?? module) as PlotlyModule,
  );
  return plotly;
}

export function isPlotlyOutput(output: { mimeType: string } | undefined): boolean {
  return output?.mimeType === PLOTLY_MIME_TYPE;
}

/** The chart's title, for compact previews ("Monthly revenue" or "Chart"). */
const titleCache = new Map<string, string>();
let titleCacheCharacters = 0;
export function plotlyTitle(dataBase64: string): string {
  const cached = titleCache.get(dataBase64);
  if (cached !== undefined) return cached;
  try {
    const layout = (decodeSpec(dataBase64) as { layout?: { title?: string | { text?: string } } }).layout;
    const title = typeof layout?.title === 'string' ? layout.title : layout?.title?.text;
    const result = title?.replace(/<[^>]*>/g, '').trim() || 'Chart';
    if (dataBase64.length <= 8 * 1024 * 1024) {
      while (titleCache.size >= 16 || titleCacheCharacters + dataBase64.length > 8 * 1024 * 1024) {
        const key = titleCache.keys().next().value!;
        titleCache.delete(key); titleCacheCharacters -= key.length;
      }
      titleCache.set(dataBase64, result); titleCacheCharacters += dataBase64.length;
    }
    return result;
  } catch {
    return 'Chart';
  }
}

/** WebGL trace types and their SVG equivalents (Plotly Express picks WebGL by itself above
 * 1000 points). */
const SVG_TRACE_TYPES: Record<string, string> = {
  scattergl: 'scatter',
  scatterpolargl: 'scatterpolar',
  heatmapgl: 'heatmap',
};

let webglAvailable: boolean | null = null;

/** Whether this web view can create the WebGL context Plotly's WebGL traces need. */
export function canUseWebGL(): boolean {
  if (webglAvailable === null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      webglAvailable = gl !== null && gl.getExtension('OES_element_index_uint') !== null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext(); // give the probe context back
    } catch {
      webglAvailable = false;
    }
  }
  return webglAvailable;
}

/** Traces drawn with SVG instead of WebGL (slower for very large data, but always drawn). */
export function withoutWebGL(data: unknown[]): { data: unknown[]; changed: boolean } {
  let changed = false;
  const converted = data.map((trace) => {
    const type = (trace as { type?: string } | null)?.type;
    if (type === undefined || !(type in SVG_TRACE_TYPES)) return trace;
    changed = true;
    return { ...(trace as object), type: SVG_TRACE_TYPES[type] };
  });
  return { data: converted, changed };
}

/** A chart Python resamples (resample.py): its token and the x axes it covers. */
export interface ResampleMeta {
  token: string;
  axes: string[];
  shown: number;
  total: number;
}

/** Asks the app for the points of the visible ranges; `apply` puts them in the chart. */
export interface ResampleRequest {
  token: string;
  ranges: Record<string, [unknown, unknown] | null>;
  apply(view: { traces: Array<{ index: number; shown: number; inRange?: number; total: number; data: Record<string, unknown[]> }> }): void;
}

export const RESAMPLE_EVENT = 'plotly-resample';

function resampleMeta(layout: Record<string, unknown> | undefined): ResampleMeta | null {
  const meta = (layout?.['meta'] as { reaktivResample?: ResampleMeta } | undefined)?.reaktivResample;
  return meta && typeof meta.token === 'string' ? meta : null;
}

/** "4,000 of 5,000,000 points · zoom for detail", or "all 403 points in view · …" for the
 * chart's corner. */
export function resampleNote(shown: number, total: number, inRange = total): string {
  const format = (value: number) => value.toLocaleString('en-US');
  if (shown >= inRange) {
    return inRange >= total ? `all ${format(total)} points` : `all ${format(inRange)} points in view · ${format(total)} in total`;
  }
  return `${format(shown)} of ${format(inRange)} points in view · zoom for detail`;
}

function decodeSpec(dataBase64: string): { data?: unknown[]; layout?: Record<string, unknown> } {
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Give a chart's WebGL contexts back now, not when the garbage collector gets to them:
 * WebKit keeps about 16 alive and drops the oldest beyond that. */
function releaseWebGL(root: HTMLElement): void {
  for (const canvas of root.querySelectorAll('canvas')) {
    try {
      const gl = canvas.getContext('webgl') ?? canvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // A 2D canvas, or already gone.
    }
  }
}

class PlotlyFigureElement extends HTMLElement {
  static observedAttributes = ['data-spec'];
  /** Passive layout inspection must not report a chart as fitted before its draw completes. */
  get renderStatus(): 'ready' | 'pending' | 'error' {
    if (/^Could not (draw|read) this chart\./.test(this.textContent ?? '')) return 'error';
    return !this.rendering && this.rendered !== '' && this.rendered === this.getAttribute('data-spec') && !this.needsFit() ? 'ready' : 'pending';
  }
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private visible = true;
  private readonly visibilityChanged = () => { if (document.visibilityState !== 'hidden') void this.render(); };
  private drawable(): boolean { return this.isConnected && this.visible && document.visibilityState !== 'hidden'; }
  private rendered = '';
  private rendering = false;
  private fittedWidth = 0;
  private fittedHeight = 0;
  private generation = 0;
  private releasing = false;
  private resample: ResampleMeta | null = null;
  private resampleTimer = 0;
  private listening = false;
  private note: HTMLElement | null = null;

  /** Zoom, pan, or reset: ask for the points of the visible ranges (debounced). */
  private readonly handleRelayout = (): void => {
    if (this.resample === null) return;
    window.clearTimeout(this.resampleTimer);
    this.resampleTimer = window.setTimeout(() => this.requestResample(), 120);
  };

  private requestResample(): void {
    const meta = this.resample;
    if (meta === null) return;
    const layout = (this as unknown as { layout?: Record<string, { autorange?: unknown; range?: unknown[] }> }).layout ?? {};
    const ranges = Object.fromEntries(
      meta.axes.map((axis) => {
        const settings = layout[axis === 'x' ? 'xaxis' : `xaxis${axis.slice(1)}`];
        const range = settings?.range;
        return [axis, settings?.autorange === true || !Array.isArray(range) ? null : ([range[0], range[1]] as [unknown, unknown])];
      }),
    );
    const token = meta.token;
    const request: ResampleRequest = {
      token,
      ranges,
      apply: (view) => {
        if (this.resample?.token !== token) return; // the chart changed meanwhile
        void scheduleChartDraw(async () => {
          if (!this.drawable() || this.resample?.token !== token) return;
          const module = await loadPlotly();
          for (const trace of view.traces) {
            const update = Object.fromEntries(Object.entries(trace.data).map(([key, values]) => [key, [values]]));
            await module.restyle(this, update, [trace.index]);
          }
          this.showNote(
            view.traces.reduce((sum, trace) => sum + trace.shown, 0),
            view.traces.reduce((sum, trace) => sum + trace.total, 0),
            view.traces.reduce((sum, trace) => sum + (trace.inRange ?? trace.total), 0),
          );
        });
      },
    };
    this.dispatchEvent(new CustomEvent<ResampleRequest>(RESAMPLE_EVENT, { detail: request, bubbles: true, composed: true }));
  }

  private showNote(shown: number, total: number, inRange = total): void {
    if (this.note === null) {
      this.note = document.createElement('span');
      this.note.className = 'plotly-resample-note';
      this.style.position = 'relative';
    }
    this.note.textContent = resampleNote(shown, total, inRange);
    if (this.note.parentElement !== this) this.append(this.note);
  }

  /** A context of this chart was lost (too many on the page, the GPU reset): Plotly would show
   * "WebGL is not supported" from now on, so draw it — and every later chart — with SVG. */
  private readonly handleContextLost = (): void => {
    if (this.releasing || webglAvailable === false) return;
    webglAvailable = false;
    const encoded = this.rendered;
    this.rendered = '';
    this.listening = false; // purge removes Plotly's listeners
    void loadPlotly().then((module) => {
      module.purge(this);
      if (this.isConnected) {
        this.setAttribute('data-spec', encoded);
        void this.render();
      }
    });
  };

  private readonly correctPointerScale = () => correctPlotlyPointerScale(this);
  private readonly pointerEvents = ['pointerdown', 'mousedown', 'mousemove', 'wheel', 'touchstart', 'touchmove'] as const;

  connectedCallback(): void {
    this.style.display = 'block';
    for (const event of this.pointerEvents) this.addEventListener(event, this.correctPointerScale, {capture: true, passive: true});
    this.addEventListener('webglcontextlost', this.handleContextLost, true);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    if (typeof IntersectionObserver !== 'undefined') {
      this.visible = false;
      this.intersectionObserver = new IntersectionObserver(entries => {
        this.visible = entries.some(entry => entry.isIntersecting);
        if (this.visible) void this.render();
      }, {rootMargin: '160px'});
      this.intersectionObserver.observe(this);
    } else this.visible = true;
    void this.render();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.classList.contains('tile-chart')) {
        void this.render();
      } else if (this.rendered !== '' && this.drawable()) {
        const generation = this.generation;
        void loadPlotly().then(module => {
          if (this.isConnected && generation === this.generation) module.Plots.resize(this);
        });
      }
    });
    this.resizeObserver.observe(this);
  }

  attributeChangedCallback(): void {
    if (this.isConnected) void this.render();
  }

  disconnectedCallback(): void {
    for (const event of this.pointerEvents) this.removeEventListener(event, this.correctPointerScale, true);
    clearPlotlyPointerScale(this);
    this.generation++;
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.clearTimeout(this.resampleTimer);
    this.listening = false; // purge removes Plotly's listeners
    this.removeEventListener('webglcontextlost', this.handleContextLost, true);
    if (this.rendered !== '') {
      this.releasing = true;
      releaseWebGL(this);
      this.releasing = false;
      void loadPlotly().then((module) => module.purge(this));
    }
    this.rendered = '';
    this.fittedWidth = this.fittedHeight = 0;
  }

  private needsFit(): boolean {
    return this.classList.contains('tile-chart') && this.rendered !== '' &&
      this.clientWidth > 0 && this.clientHeight > 0 &&
      (this.clientWidth !== this.fittedWidth || this.clientHeight !== this.fittedHeight);
  }

  private async render(): Promise<void> {
    // Attribute and connection callbacks can arrive before Plotly finishes. Keep one
    // render in flight, and coalesce changes to the latest spec rather than plot twice.
    if (this.rendering || !this.drawable()) return;
    this.rendering = true;
    try {
      let encoded: string;
      let generation: number;
      do {
        encoded = this.getAttribute('data-spec') ?? '';
        generation = this.generation;
        await scheduleChartDraw(async () => {
          if (!this.drawable()) return;
          // Read the newest spec only when this chart gets a drawing slot.
          encoded = this.getAttribute('data-spec') ?? '';
          generation = this.generation;
          await this.renderSpec(encoded, generation);
        });
      } while (this.drawable() &&
        ((this.getAttribute('data-spec') ?? '') !== encoded || generation !== this.generation || this.needsFit()));
    } catch {
      if (this.isConnected) this.textContent = 'Could not draw this chart.';
    } finally {
      this.rendering = false;
    }
  }

  private async renderSpec(encoded: string, generation: number): Promise<void> {
    if (encoded === '') return;
    if (encoded === this.rendered) {
      if (!this.needsFit()) return;
      const module = await loadPlotly();
      if (!this.isConnected || generation !== this.generation) return;
      const width = this.clientWidth, height = this.clientHeight;
      if (width <= 0 || height <= 0) return;
      // Plots.resize intentionally skips layouts with explicit width AND height.
      // Relayout preserves data/zoom and shares the render queue with live updates.
      await module.relayout(this, {width, height, autosize: true});
      if (!this.isConnected || generation !== this.generation) return;
      correctPlotlyPointerScale(this);
      this.fittedWidth = width;
      this.fittedHeight = height;
      return;
    }
    let spec: ReturnType<typeof decodeSpec>;
    try {
      spec = decodeSpec(encoded);
    } catch {
      this.textContent = 'Could not read this chart.';
      return;
    }
    const module = await loadPlotly();
    if (!this.isConnected || generation !== this.generation) return;
    const layout: Record<string, unknown> = {
      autosize: true,
      margin: { l: 48, r: 16, t: 48, b: 40 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      ...spec.layout,
    };
    if (this.classList.contains('tile-chart')) {
      // Cell/graph tiles own their size. Every new Python figure may carry fixed
      // export dimensions; react would restore those without changing the host,
      // so ResizeObserver would never get a chance to fit the chart again.
      // Use layout pixels (not getBoundingClientRect, which includes view zoom).
      layout['autosize'] = true;
      layout['width'] = this.clientWidth || undefined;
      layout['height'] = this.clientHeight || undefined;
    }
    const config = { responsive: true, displaylogo: false };
    // No WebGL in this web view: draw WebGL traces with SVG rather than show Plotly's
    // "WebGL is not supported" notice instead of the chart.
    const data = canUseWebGL() ? (spec.data ?? []) : withoutWebGL(spec.data ?? []).data;
    if (this.rendered === '') await module.newPlot(this, data, layout, config);
    else await module.react(this, data, layout, config);
    if (!this.isConnected || generation !== this.generation) {
      module.purge(this);
      this.rendered = '';
      return;
    }
    // WebGL can also fail after the probe (lost context, too many contexts): redraw with SVG.
    if (/WebGL is not supported/i.test(this.textContent ?? '')) {
      const fallback = withoutWebGL(spec.data ?? []);
      if (fallback.changed) {
        webglAvailable = false;
        module.purge(this);
        await module.newPlot(this, fallback.data, layout, config);
      }
    }
    correctPlotlyPointerScale(this);
    this.rendered = encoded;
    this.fittedWidth = typeof layout['width'] === 'number' ? layout['width'] : 0;
    this.fittedHeight = typeof layout['height'] === 'number' ? layout['height'] : 0;
    // Python resamples this chart: zooming fetches the real points of the visible range.
    this.resample = resampleMeta(spec.layout);
    if (this.resample !== null) {
      if (!this.listening) {
        (this as unknown as { on(event: string, handler: () => void): void }).on('plotly_relayout', this.handleRelayout);
        this.listening = true;
      }
      this.showNote(this.resample.shown, this.resample.total);
    } else {
      this.note?.remove();
    }
  }
}

/** A Plotly spec written as a Markdown/HTML image (rich_output.py) — for exports and printing. */
const PLOTLY_DATA_URL = /data:application\/vnd\.plotly\.v1\+json;base64,([A-Za-z0-9+/=]+)/g;

/** Rendered HTML shown outside the note editor: a quiet placeholder instead of a broken image. */
export function withPlotlyPlaceholders(html: string): string {
  return html.replace(
    /<img\b[^>]*src="data:application\/vnd\.plotly\.v1\+json;base64,[^"]*"[^>]*>/g,
    '<span class="plotly-placeholder">Interactive chart — open the note to see it</span>',
  );
}

/** Replace Plotly specs in exported text with PNG images drawn by plotly.js. */
export async function plotlySpecsToPng(text: string): Promise<string> {
  const specs = [...new Set([...text.matchAll(PLOTLY_DATA_URL)].map((match) => match[1]))];
  if (specs.length === 0) return text;
  const module = await loadPlotly();
  let result = text;
  for (const encoded of specs) {
    try {
      const spec = decodeSpec(encoded);
      const data = canUseWebGL() ? (spec.data ?? []) : withoutWebGL(spec.data ?? []).data;
      const png = await module.toImage(
        { data, layout: { ...spec.layout, paper_bgcolor: '#fff' } },
        { format: 'png', width: 960, height: 540 },
      );
      result = result.replaceAll(`data:application/vnd.plotly.v1+json;base64,${encoded}`, png);
    } catch {
      // Leave the spec; the export still contains everything else.
    }
  }
  return result;
}

export function registerPlotlyFigure(): void {
  if (typeof customElements !== 'undefined' && customElements.get('reaktiv-plotly') === undefined) {
    customElements.define('reaktiv-plotly', PlotlyFigureElement);
  }
}
