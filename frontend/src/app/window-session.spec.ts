import {
  draftKeyFor,
  draftWindowIds,
  hasWindowOpening,
  linkedExample,
  linkedNote,
  MAIN_WINDOW,
  openInNewWindow,
  openingKeyFor,
  pruneStaleBrowserDrafts,
  recoveryKeyFor,
  startupPlan,
  takeWindowOpening,
  type WindowOpening,
} from './window-session';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('linkedExample', () => {
  it('accepts only names inside the examples folder', () => {
    expect(linkedExample('?example=education/motion.workbook.py')).toBe(
      'education/motion.workbook.py',
    );
    expect(linkedExample('?example=financial-model.workbook.py&window=w-1')).toBe('financial-model.workbook.py');
    expect(linkedExample('?example=docs/guide.workbook.py')).toBe('docs/guide.workbook.py');
    expect(linkedExample('?example=../secret.workbook.py')).toBeNull();
    expect(linkedExample('?example=../secret.sheet.py')).toBeNull();
    expect(linkedExample('?example=https://example.com/x.sheet.py')).toBeNull();
    expect(linkedExample('?example=education/notes.txt')).toBeNull();
    expect(linkedExample('')).toBeNull();
    expect(linkedNote('?example=education/motion.workbook.py&note=p2_free_fall')).toBe('p2_free_fall');
    expect(linkedNote('?note=<script>')).toBeNull();
    expect(linkedNote('')).toBeNull();
  });
});

describe('window session', () => {
  it('keeps the original draft key for the main window and scopes other windows', () => {
    expect(draftKeyFor(MAIN_WINDOW)).toBe('reaktiv-workbook:auto-draft:v1');
    expect(draftKeyFor('window-1a')).toBe('reaktiv-workbook:auto-draft:v1:window-1a');
  });

  it('lists windows that have drafts and prunes stale browser-tab drafts only', () => {
    const storage = new MemoryStorage();
    const now = Date.parse('2026-09-26T12:00:00Z');
    const draft = (savedAt: string) => JSON.stringify({ savedAt });
    storage.setItem(draftKeyFor(MAIN_WINDOW), draft('2020-01-01T00:00:00Z'));
    storage.setItem(draftKeyFor('window-desk'), draft('2020-01-01T00:00:00Z'));
    storage.setItem(draftKeyFor('w-fresh'), draft('2026-09-20T00:00:00Z'));
    storage.setItem(draftKeyFor('w-stale'), draft('2026-07-01T00:00:00Z'));
    storage.setItem(draftKeyFor('w-broken'), '{not json');

    expect(draftWindowIds(storage).sort()).toEqual(['w-broken', 'w-fresh', 'w-stale', 'window-desk']);
    pruneStaleBrowserDrafts(storage, now);
    expect(draftWindowIds(storage).sort()).toEqual(['w-fresh', 'window-desk']);
    expect(storage.getItem(draftKeyFor(MAIN_WINDOW))).not.toBeNull();
  });
});

describe('startupPlan', () => {
  it('starts fresh without a draft, or after the user discarded it', () => {
    expect(startupPlan(null)).toEqual({ kind: 'fresh' });
    expect(startupPlan({ hasDocument: false })).toEqual({ kind: 'fresh' });
  });

  it('restores browser drafts as they are', () => {
    expect(startupPlan({})).toEqual({ kind: 'draft' });
  });
});

describe('opening workbooks in new windows', () => {
  afterEach(() => vi.restoreAllMocks());

  const windowIdOf = (open: ReturnType<typeof vi.spyOn>) =>
    new URL(String(open.mock.calls[0][0])).searchParams.get('window')!;

  it('hands a workbook to the new tab, which takes it once', async () => {
    const storage = new MemoryStorage();
    const open = vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as unknown as Window);
    expect(await openInNewWindow({ kind: 'example', name: 'vectors.workbook.py' }, storage)).toBe(true);
    const id = windowIdOf(open);
    expect(id).toMatch(/^w-[a-z0-9]+$/);
    expect(hasWindowOpening(id, storage)).toBe(true);
    expect(await takeWindowOpening(id, storage)).toEqual({ kind: 'example', name: 'vectors.workbook.py' });
    expect(await takeWindowOpening(id, storage)).toBeNull();
  });

  it('opens the tab during the click and waits while a file is still being read', async () => {
    const storage = new MemoryStorage();
    const open = vi.spyOn(window, 'open').mockReturnValue({ close: vi.fn() } as unknown as Window);
    let finishReading!: (opening: WindowOpening) => void;
    const reading = new Promise<WindowOpening>((resolve) => (finishReading = resolve));
    const handing = openInNewWindow(reading, storage);
    expect(open).toHaveBeenCalledOnce(); // before anything was awaited
    const id = windowIdOf(open);
    expect(storage.getItem(openingKeyFor(id))).toBe('pending');
    const taking = takeWindowOpening(id, storage, async () => {
      finishReading({ kind: 'source', source: '# file', modifiedAt: null });
      await handing;
    });
    expect(await taking).toEqual({ kind: 'source', source: '# file', modifiedAt: null });
  });

  it('reports a blocked popup or a workbook too large to hand over', async () => {
    const storage = new MemoryStorage();
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(await openInNewWindow({ kind: 'example', name: 'vectors.workbook.py' }, storage)).toBe(false);
    expect(storage.length).toBe(0);

    const full = new MemoryStorage();
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({ close } as unknown as Window);
    vi.spyOn(full, 'setItem').mockImplementation((_key, value) => {
      if (value !== 'pending') throw new DOMException('full', 'QuotaExceededError');
    });
    const big: WindowOpening = { kind: 'source', source: 'x', modifiedAt: null };
    expect(await openInNewWindow(Promise.resolve(big), full)).toBe(false);
    expect(close).toHaveBeenCalled(); // the waiting tab is closed again
  });
});
