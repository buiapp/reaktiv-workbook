import { describe, expect, it, vi } from 'vitest';
import { WorkbookFileService } from './workbook-file.service';

describe('WorkbookFileService', () => {
  it('exports text as a download with the given file name and type', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const service = new WorkbookFileService();
    await expect(service.exportText('{}', 'theme.json', { name: 'Theme', extensions: ['json'], mimeType: 'application/json' }))
      .resolves.toBe('theme.json');
    expect(clicked).toEqual(['theme.json']);
    expect((created.mock.calls[0][0] as Blob).type).toBe('application/json');
    vi.restoreAllMocks();
  });
});
