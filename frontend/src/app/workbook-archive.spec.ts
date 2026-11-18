import { strToU8, unzipSync, zipSync } from 'fflate';
import { AssetStore } from './asset-store';
import { contentName, dataUrlToBlob } from './image-assets';
import { createWorkbookArchive, readWorkbookArchive } from './workbook-archive';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('browser workbook archives', () => {
  it('round-trips Python, snapshot, and deduplicated image files without embedding image bytes in source', async () => {
    const store = new AssetStore();
    const reference = await store.add(dataUrlToBlob(PNG));
    const cells = [{ id: 'A1', kind: 'markdown' as const, source: `![x](${reference})\n![again](${reference})`, enabled: true, trigger: 'auto' as const }];
    const assets = await store.filesForDownload(cells);
    const source = `# Example\n${cells[0].source}`;
    const outputs = JSON.stringify({ cells: [{ display: cells[0].source }] });
    const zip = await createWorkbookArchive('example.sheet.py', source, outputs, assets);
    expect(zip.type).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([reference, 'example.sheet.py', 'example.sheet.py.snapshot.json'].sort());
    const opened = await readWorkbookArchive(zip);
    expect(opened.source).toBe(source);
    expect(opened.source).not.toContain('data:image');
    expect(opened.outputs).toBe(outputs);
    const restored = new AssetStore();
    await restored.importFiles(opened.assets);
    expect(await restored.inline(cells[0].source)).toContain(PNG);
    expect(await contentName(opened.assets.get(reference)!)).toBe(reference.slice(7));
  });

  it('opens archives with a .workbook.py workbook and with a legacy .sheet.py one', async () => {
    for (const name of ['budget.workbook.py', 'budget.sheet.py']) {
      const zip = await createWorkbookArchive(name, '# Budget', undefined, new Map());
      const opened = await readWorkbookArchive(zip);
      expect(opened.filename).toBe(name);
      expect(opened.source).toBe('# Budget');
    }
  });

  it('refuses to download a workbook with missing image files', async () => {
    const store = new AssetStore();
    await expect(store.filesForDownload([
      { id: 'A1', kind: 'markdown', source: '![lost](assets/ffffffffffffffff.png)', enabled: true, trigger: 'auto' },
    ])).rejects.toThrow('assets/ffffffffffffffff.png is missing');
  });

  it('only includes referenced images and makes snapshots optional', async () => {
    const store = new AssetStore();
    await store.add(dataUrlToBlob(PNG));
    expect((await store.filesForDownload([])).size).toBe(0);
    const archive = await createWorkbookArchive('empty.sheet.py', '# workbook', undefined, new Map());
    expect((await readWorkbookArchive(archive)).outputs).toBeNull();
  });

  it('rejects ambiguous archives, skips arbitrary paths, and checks image content hashes', async () => {
    const archive = (files: Record<string, string>) => new Blob([zipSync(Object.fromEntries(
      Object.entries(files).map(([name, source]) => [name, strToU8(source)]),
    ))]);
    await expect(readWorkbookArchive(archive({ 'a.sheet.py': '', 'b.sheet.py': '' }))).rejects.toThrow('exactly one');
    const opened = await readWorkbookArchive(archive({ 'a.sheet.py': '', '../assets/ffffffffffffffff.png': 'bad', 'extra.py': 'code' }));
    expect(opened.assets.size).toBe(0);
    await expect(new AssetStore().importFiles(new Map([
      ['assets/ffffffffffffffff.png', dataUrlToBlob(PNG)],
    ]))).rejects.toThrow('Invalid workbook image');
  });

  it('refuses oversized decompressed entries before extracting them', async () => {
    const bytes = zipSync({ 'a.sheet.py': new Uint8Array(1) });
    // ZIP central-directory uncompressed size, without allocating a large test fixture.
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 65 * 1024 * 1024, true);
    }
    await expect(readWorkbookArchive(new Blob([bytes]))).rejects.toThrow('too much data');
  });
});
