// Tests call the production Python writer; this is not a second implementation.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { copiedCellsDocument } from '../frontend/src/app/sheet-file';
import type { CellDefinition, SheetDocument } from '../frontend/src/app/sheet.types';
import type { WorkbookSource } from '../frontend/src/app/workbook-source.service';

export function serializeResult(document: SheetDocument): WorkbookSource {
  const script = `
import sys, types, json
package = types.ModuleType('reaktiv_workbook_files')
package.__path__ = [sys.argv[1]]
sys.modules['reaktiv_workbook_files'] = package
from reaktiv_workbook_files.file_api import serialize_document_json
print(serialize_document_json(sys.stdin.read()))
`;
  return JSON.parse(
    execFileSync('python3', ['-c', script, resolve('python/reaktiv_workbook')], {
      input: JSON.stringify(document),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
}

export function serializeSheetDocument(document: SheetDocument): string {
  const result = serializeResult(document);
  if (result.problems.length) throw new Error(result.problems.join('\n'));
  return result.source;
}

export function copiedCellsSource(cells: readonly CellDefinition[]): string {
  return serializeSheetDocument(copiedCellsDocument(cells));
}
