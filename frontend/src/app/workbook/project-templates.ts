import type { CellDefinition } from '../sheet.types';
export type NewProjectTemplate = 'note' | 'model' | 'empty';

export function newProjectCells(name: string, template: NewProjectTemplate): CellDefinition[] {
  if (template === 'empty') return [];
  if (template === 'model') {
    return [
      {
        id: 'A1',
        name: 'amount',
        kind: 'input',
        source: '100',
        enabled: true,
        trigger: 'auto',
      },
      {
        id: 'A2',
        name: 'doubled',
        kind: 'formula',
        source: 'amount * 2',
        enabled: true,
        trigger: 'auto',
      },
      {
        id: 'B1',
        name: 'overview',
        kind: 'markdown',
        source: `# ${name}\n\nThe current amount is **{{ amount }}** and the calculated value is **{{ doubled }}**.`,
        enabled: true,
        trigger: 'auto',
      },
    ];
  }
  return [
    {
      id: 'A1',
      kind: 'markdown',
      source: `# ${name}\n\nStart writing. Type \`/\` to insert a block or add reactive cells in the Cells view.`,
      enabled: true,
      trigger: 'auto',
    },
  ];
}
