import { canonicalActionSource, refactorCellLabel } from './sheet-file';
import { serializeSheetDocument, copiedCellsSource } from '../../../tests/python-writer';
import {
  createSheetDocument,
  duplicateSheet,
  isCopiedCells,
  relabelCells,
  uniqueLabels,
  labelSuffix,
  renameCell,
} from './sheet-file';
import type { CellDefinition } from './sheet.types';

describe('Reaktiv Workbook Python file format', () => {
  it('round-trips workbook metadata and all cell primitives', () => {
    const document = createSheetDocument(
      'Forecast',
      12,
      30,
      [
        { id: 'A1', kind: 'input', source: '125000', enabled: true },
        { id: 'A2', kind: 'formula', source: 'A1 * .2', enabled: true },
        {
          id: 'A3',
          kind: 'formula',
          source: "subtotal = A2 * 2\nprint('calculated')\nreturn subtotal + 1",
          enabled: true,
        },
        {
          id: 'B1',
          kind: 'resource',
          source: "await asyncio.sleep(0)\nreturn {'value': A2}",
          enabled: true,
        },
        {
          id: 'C1',
          kind: 'markdown',
          source: '# Result\n\n{{ B1 }}',
          enabled: true,
        },
        {
          id: 'C2',
          name: 'assumptions',
          kind: 'markdown',
          source: '# Assumptions\n\nRevenue: {{ A1 }}',
          enabled: true,
        },
        {
          id: 'D1',
          kind: 'effect',
          source: 'print(f"value:{A2}", "A2")  # A2',
          enabled: true,
        },
        {
          id: 'E1',
          name: 'report_file',
          kind: 'formula',
          source: "artifact(b'report', 'report.txt', 'text/plain')",
          enabled: true,
        },
      ],
      ['httpx>=0.28'],
      { columnWidths: { A: 180 }, rowHeights: { '1': 72 }, zoom: 1.2 },
      { REGION: 'eu', EMPTY: '' },
      ['import pandas as pd', 'from datetime import date'],
    );

    const source = serializeSheetDocument(document);

    expect(source).toContain('class ForecastWorkbook(Workbook):');
    // Format 2 imports only what the file uses.
    expect(source).toMatch(/from reaktiv_workbook import \(?[^)]*?\bWorkbook\b/);
    expect(source).not.toMatch(/^\s+sheet,$|import [^\n(]*\bsheet\b/m); // the format-1 decorator
    expect(source).toContain('import pandas as pd\nfrom datetime import date');
    expect(source).not.toContain('"imports"');
    expect(source).toContain('@cell("B1", resource_mode="simple")\n    @resource');
    expect(source).toContain('@b1.loader');
    expect(source).toContain('async def _b1_loader(self, resource_params):');
    expect(source).toContain('subtotal = self.a2() * 2');
    expect(source).toContain('{{ self.b1.value() }}');
    expect(source).toContain('def assumptions(self):');
    expect(source).toContain('@cell("C2", label="assumptions")');
    expect(source).toContain('Revenue: {{ self.a1() }}');
    expect(source).toContain("return artifact(b'report', 'report.txt', 'text/plain')");
    expect(source).toContain('print(f"value:{self.a2()}", "A2")  # A2');
  });

  it('rejects duplicate cells before serialization', () => {
    const document = createSheetDocument('Duplicate', 10, 16, [
      { id: 'A1', kind: 'input', source: '1', enabled: true },
      { id: 'A1', kind: 'input', source: '2', enabled: true },
    ]);
    expect(() => serializeSheetDocument(document)).toThrow(/Duplicate cell id/);
  });

  it('serializes stable labels while respecting local Python bindings', () => {
    const document = createSheetDocument('Labels', 5, 5, [
      {
        id: 'A1',
        name: 'deadline',
        kind: 'input',
        source: '10',
        enabled: true,
      },
      {
        id: 'B1',
        name: 'doubled',
        kind: 'formula',
        source: 'deadline * 2',
        enabled: true,
      },
      {
        id: 'C1',
        name: 'local_binding',
        kind: 'formula',
        source: 'deadline = A1 + 1\nreturn deadline * 3',
        enabled: true,
      },
    ]);

    const source = serializeSheetDocument(document);

    expect(source).toContain('return self.deadline() * 2');
    expect(source).toContain('deadline = self.deadline() + 1');
    expect(source).toContain('return deadline * 3');
    expect(source).toContain('deadline = cell("A1", field(10), label="deadline")');
  });

  it('keeps coordinate-addressable cells unlabeled', () => {
    const document = createSheetDocument('Coordinates', 5, 5, [
      { id: 'A1', kind: 'input', source: '10', enabled: true },
      { id: 'B1', kind: 'formula', source: 'A1 * 2', enabled: true },
    ]);

    expect(document.cells.map((cell) => cell.name)).toEqual([undefined, undefined]);
    const source = serializeSheetDocument(document);
    expect(source).toContain('a1 = cell("A1", field(10))');
    expect(source).toContain('return self.a1() * 2');
    expect(source).not.toContain('label=');
  });

  it('rewrites a removed label back to its coordinate', () => {
    const renamed = renameCell(
      [
        { id: 'A1', name: 'revenue', kind: 'input', source: '10', enabled: true },
        { id: 'B1', kind: 'formula', source: 'revenue * 2', enabled: true },
      ],
      'A1',
      '',
    );

    expect(renamed.find((cell) => cell.id === 'A1')?.name).toBeUndefined();
    expect(renamed.find((cell) => cell.id === 'B1')?.source).toBe('A1 * 2');
  });

  it('rewrites dependent references when a cell label changes', () => {
    const renamed = renameCell(
      [
        {
          id: 'A1',
          name: 'revenue',
          kind: 'input',
          source: '10',
          enabled: true,
        },
        {
          id: 'B1',
          name: 'total',
          kind: 'formula',
          source: 'revenue * 2',
          enabled: true,
        },
        {
          id: 'C1',
          name: 'report',
          kind: 'markdown',
          source: '[Revenue: {{ revenue }}](#sheet-input:revenue?type=number)',
          enabled: true,
        },
        {
          id: 'D1',
          name: 'local_binding',
          kind: 'formula',
          source: 'revenue = 4\nreturn revenue * 3',
          enabled: true,
        },
      ],
      'A1',
      'sales',
    );

    expect(renamed.find((cell) => cell.id === 'A1')?.name).toBe('sales');
    expect(renamed.find((cell) => cell.id === 'B1')?.source).toBe('sales * 2');
    expect(renamed.find((cell) => cell.id === 'C1')?.source).toBe(
      '[Revenue: {{ sales }}](#sheet-input:sales?type=number)',
    );
    expect(renamed.find((cell) => cell.id === 'D1')?.source).toContain('return revenue * 3');
  });

  it('serializes final-expression formulas plus cell and note presentation', () => {
    const document = createSheetDocument(
      'Presentation',
      2,
      2,
      [
        {
          id: 'A1',
          name: 'total',
          kind: 'formula',
          source: 'subtotal = 20\nsubtotal * 2',
          enabled: true,
          color: '#cde7ae',
        },
      ],
      [],
      { columnWidths: {}, rowHeights: {}, zoom: 1, noteZoom: 1.3 },
    );

    const source = serializeSheetDocument(document);

    expect(source).toContain('@cell("A1", color="#cde7ae", label="total")');
    expect(source).toContain('return subtotal * 2');
    expect(source).toContain('"noteZoom": 1.3');
  });
});

describe('worksheet kernel settings', () => {
  it('stores a local kernel and Python version in the @sheet environment', () => {
    const document = createSheetDocument('Local', 2, 2, [], ['polars'], undefined, {}, [], undefined, {
      kernel: 'local',
      python: '3.13',
    });
    const source = serializeSheetDocument(document);
    expect(source).toContain('"environment": {"kernel": "local", "python": "3.13"}');
  });

  it('keeps the default kernel out of files', () => {
    const source = serializeSheetDocument(createSheetDocument('Plain', 2, 2, []));
    expect(source).not.toContain('"kernel"');
    expect(source).not.toContain('"python"');
  });
});

describe('PEP 723 script metadata', () => {
  it('starts every file with the worksheet dependencies', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Deps', 2, 2, [], ['polars>=1'], undefined, {}, [], undefined, { python: '3.13' }),
    );
    expect(source.startsWith(
      '# /// script\n# requires-python = "==3.13.*"\n# dependencies = [\n#   "reaktiv>=0.25.0",\n#   "reaktiv-workbook>=0.1.0",\n#   "polars>=1",\n# ]\n# ///\n',
    )).toBe(true);
  });

  it('keeps comments of input cells above the member so the value stays a literal', () => {
    const document = createSheetDocument('Comments', 3, 3, [
      { id: 'A1', kind: 'input', source: '# monthly rent\n1200', enabled: true },
      { id: 'A2', kind: 'input', source: '"# Heading\\nplain text"', enabled: true },
      {
        id: 'A3',
        kind: 'input',
        source: '"note"',
        enabled: true,
        view: { markdown: false },
      },
    ]);
    const source = serializeSheetDocument(document);
    expect(source).toContain('    # monthly rent\n    a1 = cell("A1", field(1200))');
    expect(source).toContain('a2 = cell("A2", field("# Heading\\nplain text"))');
    expect(source).toContain('view={"markdown": False}');
  });

  it('writes comments after an input value above the member, never inside field(…)', () => {
    const input = (id: string, source: string) => ({ id, kind: 'input' as const, source, enabled: true });
    const source = serializeSheetDocument(
      createSheetDocument('Trailing', 3, 6, [
        input('A1', '999\n# minus the parking space'),
        input('A2', '1200  # monthly, in EUR'),
        input('A3', "['a', 'b']\n# options"),
        input('A4', '"#1 priority"'),
        input('A5', '[1,\n 2]  # two'),
      ]),
    );
    expect(source).toContain('    # minus the parking space\n    a1 = cell("A1", field(999))');
    expect(source).toContain('    # monthly, in EUR\n    a2 = cell("A2", field(1200))');
    expect(source).toContain('    # options\n    a3 = cell("A3", field([\'a\', \'b\']))');
    expect(source).toContain('a4 = cell("A4", field("#1 priority"))');
    expect(source).toContain('@input_cell\ndef a5(self):'.replaceAll('\n', '\n    '));
    expect(source).toContain('return [1,\n         2]  # two');
  });

  it('keeps explicit cell handles attached through label renames and file generation', () => {
    const cells: CellDefinition[] = [{id: 'A1', name: 'count', kind: 'input', source: '0', enabled: true},
      {id: 'B1', kind: 'effect', source: 'cells.count.update(lambda count: count + 1)\ncells.Sheet1.count.set(3)', enabled: true}];
    const renamed = renameCell(cells, 'A1', 'counter');
    expect(renamed[1].source).toBe('cells.counter.update(lambda count: count + 1)\ncells.Sheet1.counter.set(3)');
    const file = serializeSheetDocument(createSheetDocument('Writes', 4, 4, cells));
    expect(file).toContain('cells = cell_refs(self, "Sheet1")');
    expect(file).toContain('lambda count: count + 1');
  });

  it('writes shared code as module-level Python and function cells with a return', () => {
    const document = createSheetDocument(
      'Shared',
      3,
      3,
      [
        { id: 'A1', kind: 'input', source: '100', enabled: true },
        { id: 'A2', kind: 'formula', source: 'gross(A1)', enabled: true },
        {
          id: 'A3',
          name: 'tax',
          kind: 'formula',
          source: 'def tax(amount):\n    return amount * A1',
          enabled: true,
        },
      ],
      [],
      undefined,
      {},
      [],
      undefined,
      { code: '\nVAT = 0.19\n\ndef gross(net):\n    return net * (1 + VAT)\n\n' },
    );
    expect(document.environment.code).toBe('VAT = 0.19\n\ndef gross(net):\n    return net * (1 + VAT)');
    const source = serializeSheetDocument(document);
    expect(source).toContain(
      '\n\n# Shared code: functions, classes, and constants available to every cell.\nVAT = 0.19\n',
    );
    expect(source).not.toContain('env = {}'); // only written when the workbook has variables or uses env
    expect(source).toContain('return gross(self.a1())');
    expect(source).toContain('        def tax(amount):\n            return amount * self.a1()\n\n        return tax');
  });

  it('writes multi-line string inputs on one line, so class indentation cannot change them', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Strings', 5, 5, [
        { id: 'A1', name: 'css', kind: 'input', source: '# cards\n"""\n.card { color: red; }"""', enabled: true },
      ]),
    );
    expect(source).toContain(`css = cell("A1", field('\\n.card { color: red; }'), label="css")`);
  });

  it('keeps keyword argument names that are also cell labels', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Keywords', 5, 5, [
        { id: 'A1', name: 'today', kind: 'input', source: '"2026-10-06"', enabled: true },
        { id: 'A2', name: 'columns', kind: 'input', source: '3', enabled: true },
        {
          id: 'B1',
          name: 'board',
          kind: 'formula',
          source: 'dict(columns=columns, today=today, flag=(columns == 3))',
          enabled: true,
        },
      ]),
    );
    expect(source).toContain('return dict(columns=self.columns(), today=self.today(), flag=(self.columns() == 3))');
  });

  it('returns a final expression that continues over several lines', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Multiline', 5, 5, [
        { id: 'A1', name: 'task_text', kind: 'input', source: '"x"', enabled: true },
        {
          id: 'B1',
          name: 'board',
          kind: 'formula',
          source: '# the board\nbind(dict(cards=1,\n          wip=2), text=task_text)',
          enabled: true,
        },
        {
          id: 'B2',
          name: 'total',
          kind: 'formula',
          source: 'values = [1, 2]\nreturn sum(\n    values)',
          enabled: true,
        },
      ]),
    );
    expect(source).toContain('# the board\n        return bind(dict(cards=1,\n                  wip=2), text=self.task_text())');
    expect(source).toContain('return sum(\n            values)');
  });

  it('keeps local names that are also cell labels (tuple, loop, with, walrus)', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Locals', 5, 5, [
        { id: 'A1', name: 'steps', kind: 'input', source: '3', enabled: true },
        { id: 'A2', name: 'pair', kind: 'input', source: '1', enabled: true },
        {
          id: 'B1',
          name: 'search',
          kind: 'formula',
          source: 'low, high, steps = 0, 9, []\nfor index, pair in enumerate(steps):\n    pass\nsteps',
          enabled: true,
        },
      ]),
    );
    expect(source).toContain('low, high, steps = 0, 9, []');
    expect(source).toContain('for index, pair in enumerate(steps):');
    expect(source).toContain('return steps');
  });
});


describe('return in cells', () => {
  const formula = (id: string, source: string) =>
    ({ id, kind: 'formula', source, enabled: true }) as CellDefinition;
  const written = (source: string) =>
    serializeSheetDocument(createSheetDocument('Returns', 4, 4, [formula('A1', source)]));

  it('keeps return statements and returns the last expression', () => {
    expect(written('if not x:\n    return None\ntotal = x * 2\nreturn total')).toContain(
      '        if not x:\n            return None\n        total = x * 2\n        return total\n',
    );
    expect(written('total = 2\ntotal + 1')).toContain('        total = 2\n        return total + 1\n');
    expect(written('return 7')).toContain('        return 7\n');
    expect(written('return 7')).not.toContain('return return');
    // A final assignment has no value: nothing is returned (and nothing is broken).
    expect(written('x = 5')).toContain('        x = 5\n');
    expect(written('x = 5')).not.toContain('return x = 5');
  });
});

describe('duplicateSheet', () => {
  const cell = (id: string, kind: string, source: string, name?: string) =>
    ({ id, kind, source, name, enabled: true }) as CellDefinition;

  it('makes the label suffix from the sheet name', () => {
    expect(labelSuffix('ScenarioB')).toBe('scenario_b');
    expect(labelSuffix('Budget_2027')).toBe('budget_2027');
    expect(labelSuffix('___')).toBe('copy');
  });

  it('copies cells with sheet-local labels that refer to each other, and keeps outside references', () => {
    const cells = [
      cell('A1', 'input', '5000', 'income'),
      cell('A2', 'input', '0.3', 'tax_rate'),
      cell('A3', 'formula', 'income * (1 - tax_rate) + A1 - Data.A1 + Model.B1', 'net'),
      cell('B1', 'formula', 'bind(Slider(), value=tax_rate)'),
      cell('C1', 'markdown', 'Net {{ net }} [Tax: {{ tax_rate }}](#sheet-input:tax_rate?type=range) see [x](#note-net)'),
      cell('Data!A1', 'input', '100', 'base'),
      // Already taken: the copy of `income` must not reuse it.
      cell('Data!A2', 'input', '1', 'income_scenario_b'),
    ];
    const { copies, labels } = duplicateSheet(
      cells,
      { prefix: '', name: 'Model' },
      { prefix: 'ScenarioB', name: 'ScenarioB' },
      ['Model', 'Data'],
    );
    expect(labels.size).toBe(0);
    expect(copies[0].name).toBe('income');
    expect(copies.map((copy) => copy.id)).toEqual(['ScenarioB!A1', 'ScenarioB!A2', 'ScenarioB!A3', 'ScenarioB!B1', 'ScenarioB!C1']);
    expect(copies[2].source).toBe(
      'income * (1 - tax_rate) + A1 - Data.A1 + ScenarioB.B1',
    );
    expect(copies[2].name).toBe('net');
    expect(copies[3].source).toBe('bind(Slider(), value=tax_rate)');
    expect(copies[4].source).toBe(
      'Net {{ net }} [Tax: {{ tax_rate }}](#sheet-input:tax_rate?type=range) see [x](#note-net)',
    );
    // The originals are untouched.
    expect(cells[2].source).toBe('income * (1 - tax_rate) + A1 - Data.A1 + Model.B1');
  });

  it('copies a qualified sheet and its qualified note links', () => {
    const cells = [cell('Plan!A1', 'markdown', '[Go](#cell-Plan!B2) {{ Plan.B2 }}'), cell('Plan!B2', 'formula', '1')];
    const { copies } = duplicateSheet(cells, { prefix: 'Plan', name: 'Plan' }, { prefix: 'Plan_copy', name: 'Plan_copy' }, ['Main', 'Plan']);
    expect(copies[0]).toMatchObject({ id: 'Plan_copy!A1', source: '[Go](#cell-Plan_copy!B2) {{ Plan_copy.B2 }}' });
  });
});

describe('copying cells', () => {
  const cell = (id: string, kind: string, source: string, name?: string) =>
    ({ id, kind, source, name, enabled: true }) as CellDefinition;

  it('puts cells on the clipboard as a small .sheet.py, recognisable when pasted', () => {
    const text = copiedCellsSource([cell('Budget!C3', 'input', '12', 'price'), cell('Budget!D4', 'formula', 'price * 2', 'twice')]);
    expect(isCopiedCells(text)).toBe(true);
    expect(text).toContain('price = cell("C3", field(12), label="price")');
    expect(text).toContain('@cell("D4", label="twice")');
    expect(isCopiedCells('price * 2')).toBe(false);
    expect(isCopiedCells('# just a comment')).toBe(false);
  });

  it('renames only labels that are taken, and the copies follow', () => {
    const labels = uniqueLabels(['price', 'tax'], new Set(['price', 'price_2', 'Sheet1']), (name, attempt) => `${name}_${attempt + 1}`);
    expect([...labels]).toEqual([['price', 'price_3'], ['tax', 'tax_2']]);
    const [input, formula, note] = relabelCells(
      [
        cell('A1', 'input', '12', 'price'),
        cell('A2', 'formula', 'price * 2 + other', 'twice'),
        cell('A3', 'markdown', '{{ price }} [Price](#sheet-input:price?type=number)'),
      ],
      new Map([['price', 'price_3']]),
    );
    expect(input.name).toBe('price_3');
    expect(formula.source).toBe('price_3 * 2 + other');
    expect(note.source).toBe('{{ price_3 }} [Price](#sheet-input:price_3?type=number)');
  });
});

describe('type hints', () => {
  it('writes a formula hint as the return annotation; other kinds have none', () => {
    const source = serializeSheetDocument(
      createSheetDocument('Typed', 4, 4, [
        { id: 'A1', kind: 'input', source: '2', name: 'n', enabled: true, annotation: 'int' },
        { id: 'A2', kind: 'formula', source: 'n * 1.5', name: 'half', enabled: true, annotation: '  float ' },
        { id: 'A3', kind: 'effect', source: 'print(n)', enabled: true, annotation: 'None' },
      ]),
    );
    expect(source).toContain('def half(self) -> float:');
    expect(source).toContain('def a3(self):');
    expect(source).not.toContain('-> int');
  });
});


describe('sheet-local label renaming', () => {
  it('rewrites only references to the renamed cell, including explicitly qualified references', () => {
    const cell = (id: string, source: string, name?: string): CellDefinition => ({ id, kind: 'formula', source, name, enabled: true });
    const renamed = renameCell([
      cell('A1', '10', 'amount'),
      cell('Budget!A1', '20', 'amount'),
      cell('B1', 'amount + Budget.amount + Main.amount'),
      cell('Budget!B1', 'amount + Main.amount + Budget.amount'),
    ], 'Budget!A1', 'cost', 'Main');
    expect(renamed[0].name).toBe('amount');
    expect(renamed[2].source).toBe('amount + Budget.cost + Main.amount');
    expect(renamed[3].source).toBe('cost + Main.amount + Budget.cost');
  });
});

it('rewrites widget setting expressions on label rename and copy', () => {
  const cell = (id: string, kind: CellDefinition['kind'], source: string, name: string): CellDefinition => ({ id, kind, source, name, enabled: true });
  const inputs = [cell('A1', 'input', '10', 'limit'), { ...cell('A2', 'input', '2', 'amount'), view: { widget: { type: 'range' as const, max: 'limit * 2' } } }];
  expect(renameCell(inputs, 'A1', 'upper')[1].view?.widget?.max).toBe('upper * 2');
  expect(relabelCells(inputs, new Map([['limit', 'limit_copy']]))[1].view?.widget?.max).toBe('limit_copy * 2');
});

it('writes reactive dropdown and multiselect options as Python callbacks', () => {
  const cell = (id: string, kind: CellDefinition['kind'], source: string, name: string): CellDefinition => ({ id, kind, source, name, enabled: true });
  const cells: CellDefinition[] = [
    { ...cell('A1', 'input', '["one", "two"]', 'choices') },
    { ...cell('A2', 'input', '"one"', 'single'), view: { widget: { type: 'select', options: 'choices + ["other"]' } } },
    { ...cell('A3', 'input', '["one"]', 'multiple'), view: { widget: { type: 'multiselect', options: 'choices' } } },
  ];
  const source = serializeSheetDocument(createSheetDocument('Choices', 3, 4, cells));
  expect(source).toContain('"options": lambda self: self.choices() + ["other"]');
  expect(source).toContain('"options": lambda self: self.choices()');
});


describe('resource parameter code', () => {
  it('snapshots simple loader reads and preserves explicit parameter bodies', () => {
    const cells: CellDefinition[] = [
      {id:'A1', name:'amount', kind:'input', source:'3', enabled:true},
      {id:'B1', kind:'resource', source:'await asyncio.sleep(0)\nreturn amount * 2', enabled:true},
      {id:'B2', kind:'resource', source:'return params["amount"]', params:'# Request\n{"amount": amount}', enabled:true},
    ];
    const text = serializeSheetDocument(createSheetDocument('Resources', 4, 4, cells));
    expect(text).toContain('resource_mode="simple"');
    expect(text).toContain('resource_params.params["amount"] * 2');
    expect(text).toContain('resource_mode="explicit"');
    expect(text).toContain('params = resource_params.params');
    expect(text).toContain('# Request\n        return {"amount": self.amount()}');
    const renamed = renameCell(cells, 'A1', 'count');
    expect(renamed[2].params).toBe('# Request\n{"amount": count}');
    expect(renamed[2].source).toBe('return params["amount"]');
    const copied = relabelCells(cells, new Map([['amount','amount_2']]));
    expect(copied[2].params).toBe('# Request\n{"amount": amount_2}');
  });
});


describe('reactive widget presentation', () => {
  it('writes Python callbacks and rewrites only expressions in widget labels and state', () => {
    const cells: CellDefinition[]=[{id:'A1',name:'ready',kind:'input',source:'True',enabled:true},
      {id:'B1',kind:'input',source:'0',enabled:true,view:{widget:{type:'button',label:{expr:'"Run" if ready else "Wait"'},disabled:{expr:'not ready'},placeholder:'ready is literal'}}}];
    const text=serializeSheetDocument(createSheetDocument('States',3,3,cells));
    expect(text).toContain('"label": lambda self: "Run" if self.ready() else "Wait"');
    expect(text).toContain('"disabled": lambda self: not self.ready()');
    const renamed=renameCell(cells,'A1','available');
    expect(renamed[1].view?.widget?.disabled).toEqual({expr:'not available'});
    expect(renamed[1].view?.widget?.placeholder).toBe('ready is literal');
    const copied=relabelCells(cells,new Map([['ready','ready_2']]));
    expect(copied[1].view?.widget?.label).toEqual({expr:'"Run" if ready_2 else "Wait"'});
  });
});


describe('linked previous-state computations', () => {
  it('saves both stages and rewrites cell references without touching callback locals', () => {
    const cells: CellDefinition[] = [
      {id: 'A1', kind: 'input', source: '10', name: 'limit', enabled: true},
      {id: 'A2', kind: 'input', source: '99', name: 'source', enabled: true},
      {id: 'B1', kind: 'linked', source: 'limit', computation: 'min(source, limit, previous.value) if previous is not None else source', enabled: true},
    ];
    const renamed = renameCell(cells, 'A1', 'maximum');
    expect(renamed[2].source).toBe('maximum');
    expect(renamed[2].computation).toContain('min(source, maximum, previous.value)');
    expect(renameCell(cells, 'A2', 'other')[2].computation).toBe(cells[2].computation);
    const copied = relabelCells(cells, new Map([['limit', 'limit_copy'], ['source', 'source_copy']]));
    expect(copied[2].computation).toContain('min(source, limit_copy, previous.value)');
    const document = createSheetDocument('Linked', 3, 3, cells, []);
    const generated = serializeSheetDocument(document);
    expect(generated).toContain('@linked(computation=');
    expect(generated).toContain('def _b1_computation(self, source, previous):');
  });
});

it('keeps linked callback locals when duplicating a sheet with the same name', () => {
  const cells: CellDefinition[] = [{id: 'A1', kind: 'linked', source: '10', computation: 'source.real if previous is None else previous.value', enabled: true}];
  const copied = duplicateSheet(cells, {prefix: '', name: 'source'}, {prefix: 'Copy', name: 'Copy'}, ['source', 'Copy']);
  expect(copied.copies[0].computation).toBe(cells[0].computation);
});


it('renames worksheet handles in actions without rewriting comments or strings', async () => {
  const {rewriteActionWorksheet} = await import('./sheet-file');
  const source = 'def copy(self):\n    # self.cells.Old.value stays text\n    text = "self.cells.Old.value"\n    return self.cells.Old.value() + cells.Old.A1()';
  const rewritten = rewriteActionWorksheet(source,'Old','New');
  expect(rewritten).toContain('return self.cells.New.value() + cells.New.A1()');
  expect(rewritten).toContain('# self.cells.Old.value stays text');
  expect(rewritten).toContain('text = "self.cells.Old.value"');
});


it('counts only used action reference aliases when protecting sheet deletion', async () => {
  const {actionReferencesCells} = await import('./sheet-file');
  const source = 'def set_value(self):\n    # self.unused()\n    self.used.set(2)';
  const references = {used:'A1',unused:'Other!A1'};
  expect(actionReferencesCells(source,references,new Set(['Other!A1']))).toBe(false);
  expect(actionReferencesCells(source,references,new Set(['A1']))).toBe(true);
});


describe('atomic label refactoring', () => {
  const cell = (id: string, source: string, kind: 'input' | 'formula' | 'markdown' = 'formula'): CellDefinition =>
    ({id, source, kind, enabled: true});
  it('assigns and removes labels across code, notes, widget expressions and actions', () => {
    const document = createSheetDocument('Labels', 10, 16, [cell('A1', '10', 'input'),
      cell('B1', 'A1 + cells.A1() + Other.A1'),
      cell('C1', '{{ A1 }} [input](#sheet-input:A1)', 'markdown'),
      {...cell('D1', '0', 'input'), view: {widget: {type: 'number', max: 'A1 * 2'}}},
      cell('Other!A1', '3', 'input'), cell('Other!B1', 'Sheet1.A1 + A1'),
      cell('Other!C1', '[input](#sheet-input:Sheet1.A1)', 'markdown')]);
    document.sheets = [{name: 'Other', grid: {columns: 10, rows: 16}, layout: {columnWidths: {}, rowHeights: {}}}];
    document.actions = [{name: 'update', source: 'def update(self):\n    # self.cells.Sheet1.A1\n    self.a1.set(self.cells.Sheet1.A1())', references: {a1: 'A1'}, exposed: true, label: '', bindings: {}}];
    const renamed = refactorCellLabel(document, 'A1', 'voltage');
    expect(renamed.cells[1].source).toBe('voltage + cells.voltage() + Other.A1');
    expect(renamed.cells[2].source).toBe('{{ voltage }} [input](#sheet-input:voltage)');
    expect(renamed.cells[3].view?.widget?.max).toBe('voltage * 2');
    expect(renamed.cells[5].source).toBe('Sheet1.voltage + A1');
    expect(renamed.cells[6].source).toBe('[input](#sheet-input:Sheet1.voltage)');
    expect(renamed.actions?.[0].source).toContain('self.voltage.set(self.cells.Sheet1.voltage())');
    expect(renamed.actions?.[0].source).toContain('# self.cells.Sheet1.A1');
    const removed = refactorCellLabel(renamed, 'A1', '');
    expect(removed.cells.map(cell => cell.source)).toEqual(document.cells.map(cell => cell.source));
    expect(removed.actions?.[0].source).toBe(document.actions![0].source);
    expect(document.cells[0].name).toBeUndefined();
    expect(serializeSheetDocument(removed)).toContain('self.a1');
  });
  it('refuses destination shadowing and duplicates without changing the document', () => {
    const document = createSheetDocument('Labels', 10, 16, [cell('A1', '10', 'input'), cell('B1', 'voltage = 9\nA1 + voltage')]);
    expect(() => refactorCellLabel(document, 'A1', 'voltage')).toThrow('shadowed');
    expect(document.cells[1].source).toBe('voltage = 9\nA1 + voltage');
    expect(() => refactorCellLabel(document, 'A1', 'cells')).toThrow('reserved');
  });
});

it('refuses action label rewrites with shadowed self receivers', () => {
  const document = createSheetDocument('Labels', 10, 16, [
    {id:'A1',kind:'input',source:'1',enabled:true,name:'count'}]);
  document.actions = [{name:'adjust',source:'def adjust(self):\n    def helper(self):\n        return self.count()\n    return self.count()',
    references:{count:'A1'},bindings:{},label:'',exposed:true}];
  expect(() => refactorCellLabel(document,'A1','total')).toThrow('shadows self');
  expect(document.cells[0].name).toBe('count');
  document.actions[0].source = 'def adjust(self): return self.count()';
  expect(refactorCellLabel(document,'A1','total').actions?.[0].source).toBe('def adjust(self): return self.total()');
});


it('rewrites reactive color references on labels and copied sheets without rewriting fixed colors', () => {
  const cells: CellDefinition[] = [
    {id: 'A1', name: 'status_color', kind: 'input', source: "'#123456'", enabled: true},
    {id: 'B1', kind: 'input', source: '1', enabled: true, color: '#eeeeee', view: {color: {expr: 'status_color'}}},
  ];
  expect(renameCell(cells, 'A1', 'warning_color')[1].view?.color?.expr).toBe('warning_color');
  const copies = duplicateSheet(cells, {prefix: '', name: 'Main'}, {prefix: 'Copy', name: 'Copy'}, ['Main', 'Copy']).copies;
  expect(copies.find(cell => cell.id === 'Copy!B1')?.view?.color?.expr).toBe('status_color');
  expect(copies.find(cell => cell.id === 'Copy!B1')?.color).toBe('#eeeeee');
});


describe('action spelling self.workbook.Sheet.member', () => {
  it('normalises to self.Sheet.member, leaving strings and comments alone, so renames follow', () => {
    const source = 'def copy(self):\n    # self.workbook.PLC.x stays in comments\n    self.workbook.Out.x.set(self.workbook.PLC.x())\n    return "self.workbook.PLC.x"';
    const canonical = canonicalActionSource(source);
    expect(canonical).toContain('self.Out.x.set(self.PLC.x())');
    expect(canonical).toContain('# self.workbook.PLC.x stays in comments');
    expect(canonical).toContain('return "self.workbook.PLC.x"');
    const document = createSheetDocument('Spelling', 3, 3, [
      { id: 'A1', kind: 'input', source: '0', enabled: true },
      { id: 'PLC!A1', kind: 'input', source: '1', name: 'x', enabled: true },
      { id: 'Out!A1', kind: 'input', source: '0', name: 'x', enabled: true },
    ], [], undefined, {}, [], undefined, {
      sheets: [{ name: 'PLC', grid: { columns: 3, rows: 3 }, layout: { columnWidths: {}, rowHeights: {} } },
        { name: 'Out', grid: { columns: 3, rows: 3 }, layout: { columnWidths: {}, rowHeights: {} } }],
      actions: [{ name: 'copy', source: canonical, exposed: true, references: { 'PLC.x': 'PLC!A1', 'Out.x': 'Out!A1' }, label: '', bindings: {} }] });
    const renamed = refactorCellLabel(document, 'PLC!A1', 'reading');
    expect(renamed.actions![0].source).toContain('self.Out.x.set(self.PLC.reading())');
  });
});
