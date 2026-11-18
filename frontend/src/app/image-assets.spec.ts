import { vi } from 'vitest';
import { AssetStore } from './asset-store';
import {
  assetName,
  assetRef,
  blobToDataUrl,
  contentName,
  dataUrlToBlob,
  referencedAssets,
  replaceImageSources,
} from './image-assets';

afterEach(()=>vi.restoreAllMocks());

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('note images as files', () => {
  it('recognises asset references and nothing else', () => {
    expect(assetName('assets/0123456789abcdef.webp')).toBe('0123456789abcdef.webp');
    expect(assetName('assets/../secret.webp')).toBeNull();
    expect(assetName('assets/0123456789abcdef.svg')).toBeNull(); // SVG can carry script
    expect(assetName('https://example.com/a.png')).toBeNull();
    expect(assetRef('0123456789abcdef.png')).toBe('assets/0123456789abcdef.png');
  });

  it('rewrites image sources in Markdown and HTML, keeping titles (sizes) and links', () => {
    const note = [
      '![Plan](assets/0123456789abcdef.webp "reaktiv-size:400x300")',
      '[a link](assets/0123456789abcdef.webp) stays a link',
      '<img src="assets/fedcba9876543210.png" width="20">',
      `![old](${PNG})`,
    ].join('\n');
    const shown = replaceImageSources(note, (source) => (assetName(source) ? `blob:${assetName(source)}` : null));
    expect(shown).toContain('![Plan](blob:0123456789abcdef.webp "reaktiv-size:400x300")');
    expect(shown).toContain('[a link](assets/0123456789abcdef.webp)');
    expect(shown).toContain('<img src="blob:fedcba9876543210.png" width="20">');
    expect(shown).toContain(`![old](${PNG})`);
    expect(referencedAssets(note)).toEqual(['0123456789abcdef.webp', 'fedcba9876543210.png']);
  });

  it('names an image by its content and converts data URLs both ways', async () => {
    const blob = dataUrlToBlob(PNG);
    expect(blob.type).toBe('image/png');
    expect(await blobToDataUrl(blob)).toBe(PNG);
    const name = await contentName(blob);
    expect(name).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(await contentName(dataUrlToBlob(PNG))).toBe(name);
    await expect(contentName(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow();
  });

  it('keeps pasted images out of the note text and inlines only for HTML export or print', async () => {
    const store = new AssetStore();
    const reference = await store.add(dataUrlToBlob(PNG));
    expect(reference).toMatch(/^assets\/[0-9a-f]{16}\.png$/);
    const note = `# Plan\n\n![](${reference})`;
    const shown = store.toDisplay(note);
    expect(shown).toMatch(/!\[\]\(blob:/);
    expect(store.fromDisplay(shown)).toBe(note);
    expect(await store.inline(note)).toBe(`# Plan\n\n![](${PNG})`);
  });

  it('moves images embedded in notes into assets', async () => {
    const store = new AssetStore();
    const [cell] = await store.extractEmbedded([
      { id: 'A1', kind: 'markdown', source: `Before ![x](${PNG}) after`, enabled: true, trigger: 'auto' },
    ]);
    expect(cell.source).toMatch(/^Before !\[x\]\(assets\/[0-9a-f]{16}\.png\) after$/);
    expect(store.replaceEmbedded(`saved output ![x](${PNG})`)).toBe(`saved output ![x](${cell.source.match(/assets\/[^)]+/)![0]})`);
  });
});


describe('durable note image saves',()=>{
  const cell=(source:string)=>({id:'A1',kind:'markdown' as const,source,enabled:true,trigger:'auto' as const});
  it('recovers readable temporary images on save and repairs snapshot references too',async()=>{
    const blob=dataUrlToBlob(PNG), url=URL.createObjectURL(blob), store=new AssetStore();
    // jsdom/undici mix different Blob implementations; provide the browser's response contract.
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,blob:async()=>blob} as Response);
    try {
      const [saved]=await store.extractEmbedded([cell(`Before ![](${url}) after`)]);
      expect(saved.source).toMatch(/!\[\]\(assets\/[0-9a-f]{16}\.png\)/);
      expect(saved.source).not.toContain('blob:');
      expect(store.replaceEmbedded(`![](${url})`)).toBe(saved.source.slice(7,-6));
      const files=await store.filesForDownload([saved]);
      expect(files.size).toBe(1);
      expect(await blobToDataUrl([...files.values()][0])).toBe(PNG);
    } finally {URL.revokeObjectURL(url);}
  });
  it('refuses expired blob URLs rather than silently saving broken references',async()=>{
    vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Expired'));
    const store=new AssetStore();
    await expect(store.extractEmbedded([cell('![](blob:http://localhost/expired)')]))
      .rejects.toThrow('Paste the image again before saving');
  });
});

