import type { SyntaxNode, Tree } from '@lezer/common';
import type { PythonCompletion } from './python-editor.component';

export interface EditorQuery {
  source: string;
  position: { line: number; character: number };
  action: 'completion' | 'hover' | 'signatureHelp' | 'completionResolve';
  completionKey?: string;
}
export interface EditorReply {
  available: boolean;
  completions?: { label: string; detail?: string; kind?: number; apply?: string; key?: string }[];
  result?: unknown;
}
export type EditorLanguageService = (query: EditorQuery) => Promise<EditorReply | null>;
export interface CellReferenceRange { from: number; to: number; cell: PythonCompletion }

/** Match the engine's conservative cell-local binding rules, including unfinished code. */
export function cellReferenceRanges(tree: Tree, source: string, candidates: readonly PythonCompletion[]): CellReferenceRange[] {
  const references = new Map(candidates.filter(c => c.cellId).map(c => [c.label, c]));
  const bound = new Set<string>();
  const nodes: SyntaxNode[] = [];
  tree.iterate({ enter: cursor => { nodes.push(cursor.node); } });
  const namesIn = (node: SyntaxNode | null): void => {
    if (!node) return;
    if (node.name === 'VariableName') bound.add(source.slice(node.from, node.to));
    for (let child = node.firstChild; child; child = child.nextSibling) namesIn(child);
  };
  for (const node of nodes) {
    if (['AssignStatement', 'UpdateStatement', 'NamedExpression'].includes(node.name)) {
      const children: SyntaxNode[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
      const lastOperator = children.reduce((last, child, index) => child.name === 'AssignOp' || child.name === 'UpdateOp' ? index : last, -1);
      for (const child of children.slice(0, lastOperator)) {
        // Object members and annotation expressions do not introduce locals.
        if (!['MemberExpression', 'SubscriptExpression', 'TypeDef'].includes(child.name)) namesIn(child);
      }
    }
    if (node.name === 'WithStatement') {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.prevSibling?.name === 'as') namesIn(child);
      }
    }
    if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') {
      const name = node.getChild('VariableName');
      if (name) bound.add(source.slice(name.from, name.to));
    }
    if (node.name === 'ParamList') {
      // Defaults and annotations are expressions, not new bindings.
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'VariableName') {
          const previous = child.prevSibling?.name;
          if (!previous || ['(', ',', '*', '**'].includes(previous)) bound.add(source.slice(child.from, child.to));
        }
      }
    }
    if (node.name === 'ImportStatement') {
      const children: SyntaxNode[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
      // Conservative suppression matches engine imports, including aliased imports.
      for (const child of children) namesIn(child);
    }
    if (node.name === 'ForStatement' || node.name.endsWith('ComprehensionExpression') || node.name === 'Comprehension') {
      let target = false;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === 'for') target = true;
        else if (child.name === 'in') target = false;
        else if (target) namesIn(child);
      }
    }
  }
  const ranges: CellReferenceRange[] = [];
  for (const node of nodes) {
    if (node.name !== 'VariableName' && node.name !== 'MemberExpression') continue;
    const text = source.slice(node.from, node.to).replace(/\s/g, '');
    const cell = references.get(text);
    if (!cell || bound.has(text.split('.')[0])) continue;
    if (node.name === 'VariableName' && node.parent?.name === 'MemberExpression') {
      // A qualified sheet read is one reference; an object's member still depends
      // on its base cell (customer.name).
      const qualified = source.slice(node.parent.from, node.parent.to).replace(/\s/g, '');
      if (references.has(qualified)) continue;
    }
    if (node.parent?.name === 'ArgList' && node.nextSibling?.name === 'AssignOp') continue;
    ranges.push({ from: node.from, to: node.to, cell });
  }
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function editorResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const object = result as Record<string, unknown>;
  if (typeof object['value'] === 'string') return object['value'];
  if (typeof object['detail'] === 'string') return [object['detail'], editorResultText(object['documentation'])].filter(Boolean).join('\n');
  if (object['documentation']) return editorResultText(object['documentation']);
  if (object['contents']) return Array.isArray(object['contents']) ? object['contents'].map(editorResultText).join('\n') : editorResultText(object['contents']);
  if (Array.isArray(object['signatures'])) {
    const signatures = object['signatures'] as Record<string, unknown>[];
    const signature = signatures[Number(object['activeSignature'] ?? 0)] ?? signatures[0];
    return signature ? String(signature['label'] ?? '') : '';
  }
  return '';
}
