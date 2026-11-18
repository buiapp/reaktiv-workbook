import { browsePath, type FolderListing, type ListFolder } from './path-browser';

const folders: Record<string, FolderListing> = {
  '/work': { path: '/work', parent: '/', home: '/home/me', truncated: false, entries: [
    { name: 'data', kind: 'folder', path: '/work/data' },
    { name: 'notes.txt', kind: 'file', path: '/work/notes.txt' },
  ] },
  '/work/data': { path: '/work/data', parent: '/work', home: '/home/me', truncated: false, entries: [
    { name: 'sales.csv', kind: 'file', path: '/work/data/sales.csv' },
    { name: 'stock.csv', kind: 'file', path: '/work/data/stock.csv' },
  ] },
};

function fakeList(calls: (string | undefined)[] = []): ListFolder {
  return async ({ path }) => {
    calls.push(path);
    // Like the server, a file path lists the folder that contains it.
    const file = Object.values(folders).flatMap(folder => folder.entries).find(entry => entry.path === path && entry.kind === 'file');
    const listing = folders[file ? file.path.slice(0, file.path.lastIndexOf('/')) : path ?? '/work'];
    if (!listing) throw new Error(`Not a folder: ${path}`);
    return listing;
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const dialog = () => document.querySelector('dialog.path-browser') as HTMLDialogElement;
const items = () => [...dialog().querySelectorAll('li')];
const click = (text: string) =>
  [...dialog().querySelectorAll('button')].find(button => button.textContent === text)!.click();

describe('browsePath', () => {
  afterEach(() => document.querySelectorAll('dialog.path-browser').forEach(element => element.remove()));

  it('navigates folders and chooses a file', async () => {
    const result = browsePath({ kind: 'file', current: '', label: 'Data file' }, fakeList());
    await flush();
    expect(items().map(item => item.textContent)).toEqual(['data/', 'notes.txt']);
    items()[0].click();
    await flush();
    expect(dialog().querySelector('code')!.title).toBe('/work/data');
    items()[1].click();
    click('Choose');
    await expect(result).resolves.toBe('/work/data/stock.csv');
    expect(dialog()).toBeNull();
  });

  it('chooses the current folder in folder mode and hides files', async () => {
    const result = browsePath({ kind: 'folder', current: '', label: '' }, fakeList());
    await flush();
    expect(items().map(item => item.textContent)).toEqual(['data/']);
    items()[0].click();
    await flush();
    click('Choose this folder');
    await expect(result).resolves.toBe('/work/data');
  });

  it('filters entries, goes up, and cancels with null', async () => {
    const result = browsePath({ kind: 'file', current: '/work/data/sales.csv', label: '' }, fakeList());
    await flush();
    const filter = dialog().querySelector('input')!;
    filter.value = 'sto'; filter.dispatchEvent(new Event('input'));
    expect(items().map(item => item.textContent)).toEqual(['stock.csv']);
    click('Up');
    await flush();
    expect(dialog().querySelector('code')!.title).toBe('/work');
    click('Cancel');
    await expect(result).resolves.toBeNull();
  });

  it('opens the default folder when the current value is no longer a folder', async () => {
    const calls: (string | undefined)[] = [];
    const result = browsePath({ kind: 'file', current: '/gone/file.csv', label: '' }, fakeList(calls));
    await flush(); await flush();
    expect(calls).toEqual(['/gone/file.csv', undefined]);
    expect(dialog().querySelector('code')!.title).toBe('/work');
    click('Cancel');
    await expect(result).resolves.toBeNull();
  });
});
