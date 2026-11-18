/**
 * `<reaktiv-anywidget data-cell="A1" data-spec="<base64 JSON>">` shows an anywidget
 * (https://anywidget.dev) returned by a cell. The widget's ES module runs in a sandboxed
 * iframe (frontend/public/anywidget/host.html, opaque origin: no access to the app); state flows through postMessage:
 *
 * - app → widget: `render` (module, CSS, state), then `state` when Python's state changes;
 * - widget → app: `save` from `model.save_changes()`, re-dispatched as a bubbling
 *   `anywidget-change` event ({ cellId, state, modelId }) that the app sends to Python;
 *   `msg` from `model.send()` as `anywidget-message`; Python's `widget.send()` comes back
 *   through `deliver()`;
 * - `height` keeps the iframe as tall as the widget.
 *
 */

export const ANYWIDGET_MIME_TYPE = 'application/vnd.anywidget+json';

export interface AnywidgetChange {
  cellId: string;
  state: Record<string, unknown>;
  /** The widget model that changed; a nested widget's id, or absent for the cell's own. */
  modelId?: string;
  /** Bound traits of the cell's own widget: trait -> input cell id (bind()). */
  bindings?: Record<string, string>;
}

/** A custom message (`model.send` from the view, `widget.send` from Python). */
export interface AnywidgetMessage {
  cellId: string;
  modelId?: string;
  content: unknown;
  /** Binary buffers as {"$binary": base64}. */
  buffers: unknown[];
}

interface WidgetSpec {
  esm: string;
  css: string;
  state: Record<string, unknown>;
  modelId?: string;
  /** Widgets this one refers to (for `widget_manager.get_model`). */
  models?: Record<string, { esm: string; css: string; state: Record<string, unknown> }>;
  bindings?: Record<string, string>;
}

/**
 * A view's saved state, split by bind(): bound traits become the new source of
 * their input cells (Python literals), the rest is the widget's own state.
 */
export function splitWidgetChange(
  state: Record<string, unknown>,
  bindings: Record<string, string> | undefined,
  literal: (value: unknown) => string | null,
): { inputs: { cellId: string; source: string }[]; own: Record<string, unknown>; errors: string[] } {
  const inputs: { cellId: string; source: string }[] = [];
  const own: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [trait, value] of Object.entries(state)) {
    const target = bindings?.[trait];
    if (target === undefined) {
      own[trait] = value;
      continue;
    }
    const source = literal(value);
    if (source === null) {
      errors.push(`The widget's ${trait} cannot be written to input cell ${target}: use numbers, text, True/False, lists, or dicts.`);
    } else {
      inputs.push({ cellId: target, source });
    }
  }
  return { inputs, own, errors };
}

export function isAnywidgetOutput(output: { mimeType: string } | undefined): boolean {
  return output?.mimeType === ANYWIDGET_MIME_TYPE;
}

function decodeSpec(dataBase64: string): WidgetSpec {
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as WidgetSpec;
}

class AnywidgetElement extends HTMLElement {
  static observedAttributes = ['data-spec'];
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private esm: string | null = null;
  private startTimer: number | null = null;
  private notice: HTMLElement | null = null;

  private readonly themeObserver = new MutationObserver(() => this.applyScheme());
  private readonly systemScheme = matchMedia('(prefers-color-scheme: dark)');

  connectedCallback(): void {
    this.style.display = 'block';
    window.addEventListener('message', this.handleMessage);
    // Follow theme changes (toolbar toggle or system), keeping frame and page in step.
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.systemScheme.addEventListener('change', this.applyScheme);
    this.load();
  }

  disconnectedCallback(): void {
    window.removeEventListener('message', this.handleMessage);
    this.themeObserver.disconnect();
    this.systemScheme.removeEventListener('change', this.applyScheme);
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    this.esm = null;
  }

  attributeChangedCallback(): void {
    if (!this.isConnected || this.frame === null) return;
    const spec = this.spec();
    if (spec === null) return;
    // Same module: only the state changed, so the view keeps running. A recomputed cell
    // has a new widget (new model id): the view's model takes that id, so saves reach the
    // current widget. A different module needs a fresh frame.
    if (this.ready && spec.esm === this.esm) {
      this.post({ type: 'state', state: spec.state, models: spec.models, modelId: spec.modelId });
    } else this.load();
  }

  private spec(): WidgetSpec | null {
    try {
      return decodeSpec(this.getAttribute('data-spec') ?? '');
    } catch {
      return null;
    }
  }

  private load(): void {
    this.frame?.remove();
    this.ready = false;
    this.esm = null;
    this.showNotice(null);
    const scheme = effectiveColorScheme();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Widget');
    frame.src = `${new URL('anywidget/host.html', document.baseURI).href}#scheme=${scheme}`;
    // The frame and its document use the same colour scheme, so it stays transparent.
    frame.style.cssText = `display:block;width:100%;height:40px;border:0;background:transparent;color-scheme:${scheme}`;
    this.frame = frame;
    this.append(frame);
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.startTimer = window.setTimeout(() => {
      if (!this.ready) this.showNotice('This widget could not start (its frame did not load).');
    }, 6000);
  }

  private readonly applyScheme = (): void => {
    if (this.frame === null) return;
    const scheme = effectiveColorScheme();
    this.frame.style.colorScheme = scheme;
    this.post({ type: 'scheme', scheme });
  };

  /** A message under the frame (start failure, widget error); null removes it. */
  private showNotice(text: string | null): void {
    this.notice?.remove();
    this.notice = null;
    if (text === null) return;
    const notice = document.createElement('div');
    notice.className = 'anywidget-notice';
    notice.textContent = text;
    this.notice = notice;
    this.append(notice);
  }

  /** A custom message from Python (`widget.send`) for this widget's view. */
  deliver(message: Pick<AnywidgetMessage, 'modelId' | 'content' | 'buffers'>): void {
    if (this.ready) this.post({ type: 'msg', ...message });
  }

  private post(message: Record<string, unknown>): void {
    this.frame?.contentWindow?.postMessage({ source: 'reaktiv-host', ...message }, '*');
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    if (this.frame === null || event.source !== this.frame.contentWindow) return;
    const message = event.data as {
      source?: string;
      type?: string;
      height?: number;
      state?: Record<string, unknown>;
      modelId?: string;
      content?: unknown;
      buffers?: unknown[];
    };
    if (message?.source !== 'reaktiv-anywidget') return;
    if (message.type === 'ready') {
      const spec = this.spec();
      if (spec === null) return;
      this.ready = true;
      this.esm = spec.esm;
      this.showNotice(null);
      this.post({ type: 'render', ...spec });
    } else if (message.type === 'height' && typeof message.height === 'number') {
      this.frame.style.height = `${Math.max(24, Math.ceil(message.height))}px`;
    } else if (message.type === 'error') {
      this.showNotice(`Widget error: ${(message as { message?: string }).message ?? 'unknown'}`);
    } else if (message.type === 'save' && message.state !== undefined) {
      const spec = this.spec();
      this.dispatchEvent(
        new CustomEvent<AnywidgetChange>('anywidget-change', {
          bubbles: true,
          composed: true,
          detail: {
            cellId: this.getAttribute('data-cell') ?? '',
            state: message.state,
            // The cell's own widget needs no id; a nested one does.
            modelId: message.modelId && message.modelId !== spec?.modelId ? message.modelId : undefined,
            bindings: !message.modelId || message.modelId === spec?.modelId ? spec?.bindings : undefined,
          },
        }),
      );
    } else if (message.type === 'msg') {
      this.dispatchEvent(
        new CustomEvent<AnywidgetMessage>('anywidget-message', {
          bubbles: true,
          composed: true,
          detail: {
            cellId: this.getAttribute('data-cell') ?? '',
            modelId: message.modelId,
            content: message.content ?? null,
            buffers: message.buffers ?? [],
          },
        }),
      );
    }
  };
}

/** The app's resolved colour scheme: the toggle (data-theme) or the system setting. */
function effectiveColorScheme(): 'light' | 'dark' {
  const theme = document.documentElement.dataset['theme'];
  if (theme === 'light' || theme === 'dark') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function registerAnywidgetView(): void {
  if (typeof customElements !== 'undefined' && customElements.get('reaktiv-anywidget') === undefined) {
    customElements.define('reaktiv-anywidget', AnywidgetElement);
  }
}
