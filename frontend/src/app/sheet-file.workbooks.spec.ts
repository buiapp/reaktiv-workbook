import { serializeSheetDocument } from '../../../tests/python-writer';
import fixtures from '../../../tests/fixtures/workbooks/cases.json';
import { createSheetDocument } from './sheet-file';
import type { CellDefinition, SheetDocument } from './sheet.types';

/**
 * Canonical Python-generated files used by the app for tests/fixtures/workbooks/cases.json. They are stored next to
 * the cases, and tests/python/test_workbook_files.py loads them: together the two tests check
 * that a workbook saved by the app opens with every cell as it was typed.
 * After an intended writer change (or a new case): delete the changed `*.app.sheet.py`, run
 * `npx ng test --watch=false` (it writes them again), review the diff, run the Python tests.
 */
interface WorkbookCase {
  name: string;
  imports?: string[];
  code?: string;
  sheetName?: string;
  actions?: SheetDocument['actions'];
  sheets?: SheetDocument['sheets'];
  layout?: SheetDocument['layout'];
  cells: Array<Partial<CellDefinition> & Pick<CellDefinition, 'id' | 'kind' | 'source'>>;
}

describe('workbook files written by the app (tests/fixtures/workbooks)', () => {
  for (const workbook of (fixtures as { cases: WorkbookCase[] }).cases) {
    it(`writes ${workbook.name}`, async () => {
      const cells: CellDefinition[] = workbook.cells.map((cell) => ({ enabled: true, trigger: 'auto', ...cell }));
      const document = createSheetDocument(
        workbook.name,
        10,
        16,
        cells,
        [],
        workbook.layout,
        {},
        workbook.imports ?? [],
        undefined,
        { sheetName: workbook.sheetName, sheets: workbook.sheets, code: workbook.code, actions:workbook.actions },
      );
      await expect(serializeSheetDocument(document)).toMatchFileSnapshot(
        `../../../tests/fixtures/workbooks/${workbook.name}.app.sheet.py`,
      );
    });
  }
});
