import { WORKBOOK_SUFFIX, isExampleFile, isWorkbookFileName } from './workbook-paths';

describe('workbook file names', () => {
  it('saves new workbooks as .workbook.py and still recognizes .sheet.py files', () => {
    expect(WORKBOOK_SUFFIX).toBe('.workbook.py');
    expect(isWorkbookFileName('budget.workbook.py')).toBe(true);
    expect(isWorkbookFileName('Budget.SHEET.PY')).toBe(true);
    expect(isWorkbookFileName('budget.py')).toBe(false);
    expect(isWorkbookFileName('budget.workbook.py.snapshot.json')).toBe(false);
  });

  it('treats bundled examples with either suffix as templates', () => {
    expect(isExampleFile('/repo/examples/education/motion.workbook.py')).toBe(true);
    expect(isExampleFile('/repo/examples/financial-model.sheet.py')).toBe(true);
    expect(isExampleFile('/Users/me/budget.workbook.py')).toBe(false);
  });
});
