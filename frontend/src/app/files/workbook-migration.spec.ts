import { migratedFilename, migrationDownloadName } from './workbook-migration';

it('suggests a separate format-2 workbook and rejects the original name', () => {
  expect(migratedFilename('Sweep.sheet.py')).toBe('Sweep.workbook.py');
  expect(migratedFilename('Sweep.sheet.py.zip')).toBe('Sweep.workbook.py');
  expect(migratedFilename('Sweep.workbook.py')).toBe('Sweep-v2.workbook.py');
  expect(migrationDownloadName('new.workbook.py', 'Sweep.sheet.py')).toBe('new.workbook.py');
  expect(migrationDownloadName('new.sheet.py', 'Sweep.sheet.py')).toBe('new.sheet.py');
  for (const name of ['Sweep.sheet.py', 'SWEEP.SHEET.PY', '../copy.workbook.py', 'C:\\copy.workbook.py', 'copy.py', ''])
    expect(() => migrationDownloadName(name, 'Sweep.sheet.py')).toThrow();
});
