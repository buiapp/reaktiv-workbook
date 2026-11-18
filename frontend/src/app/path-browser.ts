import type { PathRequest } from './widget-host';

/** A folder listing from the CLI session (`/v1/files`); names and kinds only. */
export interface FolderListing {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string; kind: 'file' | 'folder'; path: string }[];
  truncated: boolean;
}

export type ListFolder = (payload: { path?: string; hidden?: boolean }) => Promise<FolderListing>;

/**
 * Browse the machine running the CLI and choose a file or folder (like marimo's file
 * browser). Resolves with the chosen path, or null when cancelled. Plain DOM, like the
 * path widget that opens it, so it works in notes and grid tiles alike.
 */
export function browsePath(request: PathRequest, list: ListFolder): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'path-browser';
    dialog.setAttribute('aria-label', request.label || (request.kind === 'folder' ? 'Choose folder' : 'Choose file'));

    const title = document.createElement('h2');
    title.textContent = request.label || (request.kind === 'folder' ? 'Choose folder' : 'Choose file');
    const location = document.createElement('div'); location.className = 'path-browser-location';
    const up = button('Up', 'Parent folder'); const home = button('Home', 'Home folder');
    const current = document.createElement('code'); current.className = 'path-browser-current';
    location.append(up, home, current);
    const filter = document.createElement('input');
    filter.type = 'search'; filter.placeholder = 'Filter'; filter.setAttribute('aria-label', 'Filter entries');
    const list_ = document.createElement('ul'); list_.className = 'path-browser-list'; list_.setAttribute('role', 'listbox');
    const status = document.createElement('p'); status.className = 'path-browser-status'; status.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'path-browser-actions';
    const cancel = button('Cancel', 'Cancel');
    const choose = button(request.kind === 'folder' ? 'Choose this folder' : 'Choose', 'Choose');
    choose.classList.add('primary');
    actions.append(cancel, choose);
    dialog.append(title, location, filter, list_, status, actions);

    let listing: FolderListing | null = null;
    let selected: string | null = null;
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true; dialog.close(); dialog.remove(); resolve(value);
    };

    const render = () => {
      list_.replaceChildren();
      if (listing === null) return;
      const query = filter.value.trim().toLowerCase();
      const visible = listing.entries.filter(entry =>
        (request.kind === 'file' || entry.kind === 'folder') && entry.name.toLowerCase().includes(query));
      for (const entry of visible) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option'); item.tabIndex = 0;
        item.dataset['kind'] = entry.kind;
        item.textContent = entry.kind === 'folder' ? `${entry.name}/` : entry.name;
        item.setAttribute('aria-selected', String(entry.path === selected));
        const open = () => entry.kind === 'folder' ? void load(entry.path) : finish(entry.path);
        item.addEventListener('click', () => {
          if (entry.kind === 'folder') { void load(entry.path); return; }
          selected = entry.path; choose.disabled = false; render();
        });
        item.addEventListener('dblclick', open);
        item.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); open(); } });
        list_.append(item);
      }
      status.textContent = listing.truncated
        ? 'Showing the first entries only; filter or type a path in the field instead.'
        : visible.length === 0 ? 'No matching entries.' : '';
    };

    const load = async (path?: string) => {
      status.textContent = 'Loading…';
      try {
        listing = await list(path === undefined ? {} : { path });
        selected = null; filter.value = '';
        // Left-to-right marks keep slashes in place while long paths truncate at the start.
        current.textContent = `\u200e${listing.path}\u200e`; current.title = listing.path;
        up.disabled = listing.parent === null;
        choose.disabled = request.kind === 'file';
        render();
      } catch (reason) {
        // A stale current value (moved or deleted folder) opens the workbook's folder instead.
        if (path !== undefined && listing === null) return load();
        status.textContent = reason instanceof Error ? reason.message : String(reason);
      }
    };

    up.addEventListener('click', () => { if (listing?.parent) void load(listing.parent); });
    home.addEventListener('click', () => { if (listing) void load(listing.home); });
    filter.addEventListener('input', render);
    cancel.addEventListener('click', () => finish(null));
    choose.addEventListener('click', () => {
      if (request.kind === 'folder') finish(listing?.path ?? null);
      else if (selected !== null) finish(selected);
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });

    document.body.append(dialog);
    dialog.showModal();
    void load(request.current || undefined);
    filter.focus();
  });
}

function button(text: string, label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.setAttribute('aria-label', label);
  return element;
}
