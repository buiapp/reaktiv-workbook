import { removeRecoveryDraft } from './recovery-outputs';

/**
 * Identity of this app window. Every window is an independent workbook (own Pyodide
 * worker, own auto-draft), so per-window state in localStorage is keyed by this id.
 *
 * `?window=<id>` on the URL for windows opened with "New window"; a tab opened any
 * other way is `main`, as before multi-window support.
 */
export const MAIN_WINDOW = 'main';

const DRAFT_PREFIX = 'reaktiv-workbook:auto-draft:v1';
const RECOVERY_PREFIX = 'reaktiv-workbook:recovery:v1';
const STALE_BROWSER_DRAFT_MS = 30 * 24 * 60 * 60 * 1000;

export function currentWindowId(): string {
  const requested = new URLSearchParams(location.search).get('window');
  if (requested !== null && /^w-[a-z0-9]+$/.test(requested)) return requested;
  // A link to a bundled example is its own window: the learner's progress in that
  // example is kept separately and never replaces the workbook of the main window.
  const example = linkedExample(location.search);
  return example === null ? MAIN_WINDOW : `w-ex${example.replace(/[^a-z0-9]/g, '')}`;
}

/** `&note=p2_free_fall`: the note page (by cell label) to show first. */
export function linkedNote(search: string): string | null {
  const name = new URLSearchParams(search).get('note');
  return name !== null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}

/**
 * `?example=education/motion.workbook.py`: a bundled example to open (`.workbook.py`
 * or legacy `.sheet.py`; used by
 * links from the website). Only names inside the app's own `examples/` folder are valid.
 */
export function linkedExample(search: string): string | null {
  const name = new URLSearchParams(search).get('example');
  return name !== null && /^(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9-]*\.(?:workbook|sheet)\.py$/.test(name)
    ? name
    : null;
}

/** The main window keeps the original key so drafts saved before multi-window survive. */
export function draftKeyFor(windowId: string): string {
  return windowId === MAIN_WINDOW ? DRAFT_PREFIX : `${DRAFT_PREFIX}:${windowId}`;
}

/** Recovered unsaved work of a window, kept until the user restores or discards it. */
export function recoveryKeyFor(windowId: string): string {
  return `${RECOVERY_PREFIX}:${windowId}`;
}

/** What the auto-draft remembers about the workbook a window had open. */
export interface DraftSummary {
  /** False after "Don't Save": nothing is restored. */
  hasDocument?: boolean;
}

/**
 * How a window starts: `fresh` (nothing to restore) or `draft` (restore the window's
 * auto-draft as it is; browser drafts have no file to reopen).
 */
export type StartupPlan = { kind: 'fresh' } | { kind: 'draft' };

export function startupPlan(draft: DraftSummary | null): StartupPlan {
  return draft === null || draft.hasDocument === false ? { kind: 'fresh' } : { kind: 'draft' };
}

/** Open another independent workbook window (a browser tab). */
export async function openNewWindow(): Promise<void> {
  window.open(browserWindowUrl(newWindowId()), '_blank');
}

/**
 * What a new window opens instead of a new workbook: workbooks open in their own window.
 * The opening window stores it under the new window's id; the new window takes it at startup.
 */
export type WindowOpening =
  | { kind: 'source'; source: string; outputs?: string | null; modifiedAt: string | null; name?: string }
  | { kind: 'example'; name: string }
  | { kind: 'new'; name: string; columns: number; rows: number; template: 'note' | 'model' | 'empty' };

const OPENING_PREFIX = 'reaktiv-workbook:opening:v1';
/** The window is open but its workbook is still being read (a browser file). */
const PENDING = 'pending';
const PENDING_TIMEOUT_MS = 60_000;

export function openingKeyFor(windowId: string): string {
  return `${OPENING_PREFIX}:${windowId}`;
}

/**
 * Open `opening` in a new window. In the browser the tab opens at once (popup blockers allow
 * it only during the click) and waits while a pending opening is read. False when no window
 * could be opened (blocked, or the workbook is too large to hand over): open it here instead.
 */
export async function openInNewWindow(
  opening: WindowOpening | Promise<WindowOpening>,
  storage: Storage = localStorage,
): Promise<boolean> {
  const id = newWindowId();
  const key = openingKeyFor(id);
  const ready = !(opening instanceof Promise);
  try {
    storage.setItem(key, ready ? JSON.stringify(opening) : PENDING);
  } catch {
    return false; // too large for storage
  }
  const opened = window.open(browserWindowUrl(id), '_blank');
  if (opened === null) {
    storage.removeItem(key);
    return false;
  }
  if (ready) return true;
  try {
    storage.setItem(key, JSON.stringify(await opening));
    return true;
  } catch {
    storage.removeItem(key);
    opened.close();
    return false;
  }
}

/** The opening handed to this window, if any (waits while it is pending); taken only once. */
export async function takeWindowOpening(
  windowId: string,
  storage: Storage = localStorage,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<WindowOpening | null> {
  const key = openingKeyFor(windowId);
  window.reaktivStartup?.log('window-opening', 'Checking workbook handoff for ' + windowId);
  for (let waited = 0; storage.getItem(key) === PENDING && waited < PENDING_TIMEOUT_MS; waited += 100) {
    await wait(100);
  }
  const value = storage.getItem(key);
  storage.removeItem(key);
  if (value === null || value === PENDING) {
    window.reaktivStartup?.log('window-opening', value === PENDING ? 'Workbook handoff timed out' : 'No pending workbook handoff');
    return null;
  }
  try {
    const opening = JSON.parse(value) as WindowOpening;
    const valid = ['source', 'example', 'new'].includes(opening?.kind);
    window.reaktivStartup?.log('window-opening', valid ? 'Received workbook handoff: ' + opening.kind : 'Invalid workbook handoff kind');
    return valid ? opening : null;
  } catch {
    window.reaktivStartup?.log('window-opening', 'Could not decode workbook handoff');
    return null;
  }
}

/** Whether a window was opened to open something (checked before restoring a draft). */
export function hasWindowOpening(windowId: string, storage: Storage = localStorage): boolean {
  return storage.getItem(openingKeyFor(windowId)) !== null;
}

function newWindowId(): string {
  return `w-${Math.random().toString(36).slice(2, 10)}`;
}

function browserWindowUrl(id: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('window', id);
  return url.href;
}

export function pruneStaleBrowserDrafts(storage: Storage = localStorage, now = Date.now()): void {
  for (const id of draftWindowIds(storage).filter((candidate) => candidate.startsWith('w-'))) {
    const key = draftKeyFor(id);
    try {
      const savedAt = Date.parse((JSON.parse(storage.getItem(key) ?? '{}') as { savedAt?: string }).savedAt ?? '');
      if (!Number.isFinite(savedAt) || now - savedAt > STALE_BROWSER_DRAFT_MS) removeRecoveryDraft(storage, key);
    } catch {
      removeRecoveryDraft(storage, key);
    }
  }
}

export function draftWindowIds(storage: Storage = localStorage): string[] {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(`${DRAFT_PREFIX}:`)) ids.push(key.slice(DRAFT_PREFIX.length + 1));
  }
  return ids;
}
