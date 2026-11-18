import { describe, expect, it } from 'vitest';
import { setPathPicker, widgetHost } from './widget-host';

describe('widget path capability', () => {
  it('has no picker until a CLI session installs one, and removes it again', async () => {
    expect(widgetHost.pickPath).toBeUndefined();
    setPathPicker(async request => `/picked/${request.kind}`);
    await expect(widgetHost.pickPath!({ kind: 'folder', current: '', label: '' })).resolves.toBe('/picked/folder');
    setPathPicker(undefined);
    expect(widgetHost.pickPath).toBeUndefined();
  });
});
