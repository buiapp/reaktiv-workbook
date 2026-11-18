import { Injectable } from '@angular/core';

/** Browser file output: workbooks and exports are downloads (CLI sessions save in Python). */
@Injectable({ providedIn: 'root' })
export class WorkbookFileService {
  /** Save an exported text file as a download; returns its file name. */
  async exportText(
    content: string,
    filename: string,
    filter: { name: string; extensions: string[]; mimeType: string },
  ): Promise<string | null> {
    this.downloadBrowser(content, filename, filter.mimeType);
    return filename;
  }

  downloadBrowser(source: string | Blob, filename: string, mimeType = 'text/x-python'): void {
    const blob = source instanceof Blob ? source : new Blob([source], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
