import type { RichOutputResult } from '../sheet.types';

/** Transport-owned cache. Advertised entries are pinned until the reply arrives. */
export class RichOutputCache {
  private readonly entries = new Map<string, RichOutputResult>();
  private readonly pins = new Map<string, number>();
  private characters = 0;
  private needsSpace = false;
  private generation = 0;
  supported = false;
  constructor(private readonly maxCharacters = 32 * 1024 * 1024, private readonly maxEntries = 128) {}

  clear(): void { this.generation++; this.entries.clear(); this.pins.clear(); this.characters = 0; this.needsSpace = false; this.supported = false; }

  lease(): { keys: string[]; release(): void } {
    const generation = this.generation;
    const keys = [...this.entries.keys()];
    for (const key of keys) this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    let released = false;
    return { keys, release: () => {
      if (released) return;
      released = true;
      if (generation !== this.generation) return;
      for (const key of keys) {
        const remaining = (this.pins.get(key) ?? 0) - 1;
        if (remaining <= 0) this.pins.delete(key); else this.pins.set(key, remaining);
      }
      // A full cache must be able to learn new outputs after a long request.
      // Release space only after every advertised reference is unpinned.
      if (this.pins.size === 0 && this.needsSpace) {
        this.needsSpace = false;
        const count = Math.max(1, Math.ceil(this.entries.size / 4));
        for (const key of [...this.entries.keys()].slice(0, count)) {
          this.characters -= this.entries.get(key)!.dataBase64.length;
          this.entries.delete(key);
        }
      }
    }};
  }

  decode<T>(value: T): T {
    const visit = (raw: unknown): unknown => {
      if (Array.isArray(raw)) return raw.map(visit);
      if (!raw || typeof raw !== 'object') return raw;
      const record = raw as Record<string, unknown>;
      const result = {...record};
      if (record['outputCacheVersion'] === 1) this.supported = true;
      const rich = record['richOutput'] as Partial<RichOutputResult> & {cacheKey?: string} | undefined;
      if (rich && typeof rich.cacheKey === 'string') {
        let output = this.entries.get(rich.cacheKey);
        if (!output && typeof rich.dataBase64 !== 'string') throw new Error('Python referenced an unavailable rich output. Reconnect the kernel.');
        if (!output && typeof rich.dataBase64 === 'string' && typeof rich.mimeType === 'string') {
          output = {mimeType: rich.mimeType, dataBase64: rich.dataBase64};
          this.retain(rich.cacheKey, output);
        }
        if (!output) throw new Error('Invalid rich output from Python.');
        result['richOutput'] = output;
      }
      for (const key of ['cells', 'actions', 'output', 'graph', 'snapshot'])
        if (key in record) result[key] = visit(record[key]);
      return result;
    };
    return visit(value) as T;
  }

  private retain(key: string, output: RichOutputResult): void {
    const size = output.dataBase64.length;
    if (size > this.maxCharacters) return;
    while (this.characters + size > this.maxCharacters || this.entries.size >= this.maxEntries) {
      const candidate = [...this.entries.keys()].find(item => !this.pins.has(item));
      if (candidate === undefined) { this.needsSpace = true; return; }
      this.characters -= this.entries.get(candidate)!.dataBase64.length;
      this.entries.delete(candidate);
    }
    this.entries.set(key, output);
    this.characters += size;
  }
}
