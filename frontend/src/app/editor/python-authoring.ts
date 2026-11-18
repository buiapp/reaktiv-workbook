import type { PythonCompletion } from '../python-editor.component';

export const PYTHON_LABEL = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const PYTHON_IMPORT =
  /^(?:import\s+[A-Za-z_][A-Za-z0-9_.]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_.]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*|from\s+[A-Za-z_][A-Za-z0-9_.]*\s+import\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)*)$/;
export const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);
export const PYTHON_COMPLETIONS: readonly PythonCompletion[] = [
  ...[...PYTHON_KEYWORDS].map((label) => ({ label, type: 'keyword' as const, detail: 'Python' })),
  ...[
    'abs',
    'all',
    'any',
    'bool',
    'dict',
    'enumerate',
    'filter',
    'float',
    'int',
    'len',
    'list',
    'map',
    'max',
    'min',
    'print',
    'range',
    'reversed',
    'round',
    'set',
    'sorted',
    'str',
    'sum',
    'tuple',
    'zip',
  ].map((label) => ({ label, type: 'function' as const, detail: 'Python built-in' })),
  { label: 'np', type: 'module', detail: 'NumPy' },
  { label: 'math', type: 'module', detail: 'Python standard library' },
  { label: 'statistics', type: 'module', detail: 'Python standard library' },
  { label: 'asyncio', type: 'module', detail: 'Async runtime' },
  { label: 'env', type: 'variable', detail: 'Workbook environment variables' },
  { label: 'Artifact', type: 'class', detail: 'Downloadable artifact' },
  { label: 'artifact', type: 'function', detail: 'Create a downloadable artifact' },
  { label: 'every', type: 'function', detail: 'Clock: tick on an interval, e.g. every(minutes=5)' },
  {
    label: 'at',
    type: 'function',
    detail: 'Clock: tick on a schedule, e.g. at("08:00", days="mon-fri")',
  },
  { label: 'cancellation', type: 'variable', detail: 'Async resource cancellation event' },
  { label: 'resource_params', type: 'variable', detail: 'Async resource context' },
  { label: 'source', type: 'variable', detail: 'Current source value in a linked computation' },
  {
    label: 'previous',
    type: 'variable',
    detail: 'Previous linked state: value, source; None on first computation',
  },
  { label: 'params', type: 'variable', detail: 'Captured parameters of an explicit resource' },
];

export function parseRequirements(source: string): string[] {
  return [
    ...new Set(
      source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ),
  ];
}

/** Top-level functions, classes, and names assigned in shared code. */
export function sharedCodeNames(code: string): PythonCompletion[] {
  const completions: PythonCompletion[] = [];
  const seen = new Set<string>();
  for (const match of code.matchAll(
    /^(?:(?:async\s+)?def\s+([A-Za-z_]\w*)|class\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=))/gm,
  )) {
    const label = match[1] ?? match[2] ?? match[3];
    if (seen.has(label)) continue;
    seen.add(label);
    completions.push({
      label,
      type: match[1] ? 'function' : match[2] ? 'class' : 'variable',
      detail: 'Shared code',
    });
  }
  return completions;
}

export function parseGlobalImports(source: string): string[] {
  const imports = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  for (const [index, statement] of imports.entries()) {
    if (!PYTHON_IMPORT.test(statement)) {
      throw new Error(`Invalid global import on line ${index + 1}: ${statement}`);
    }
  }
  return [...new Set(imports)];
}

export function globalImportCompletions(imports: readonly string[]): PythonCompletion[] {
  const completions: PythonCompletion[] = [];
  const seen = new Set<string>();
  for (const statement of imports) {
    const imported = /^import\s+(.+)$/.exec(statement)?.[1];
    const fromImported = /^from\s+\S+\s+import\s+(.+)$/.exec(statement)?.[1];
    for (const item of (imported ?? fromImported ?? '').split(',')) {
      const value = item.trim();
      if (value === '' || value === '*') continue;
      const alias = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.[1];
      const label = alias ?? value.split('.')[0].trim();
      if (!PYTHON_LABEL.test(label) || seen.has(label)) continue;
      seen.add(label);
      completions.push({ label, type: 'module', detail: 'Workbook global import' });
    }
  }
  return completions;
}

export function parseEnvironmentVariables(source: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    const key = (separator < 0 ? line : line.slice(0, separator)).trim();
    const value = separator < 0 ? '' : line.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable on line ${index + 1}: ${key || '(empty)'}`);
    }
    variables[key] = value;
  }
  return variables;
}
