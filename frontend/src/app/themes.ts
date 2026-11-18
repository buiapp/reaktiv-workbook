export interface AppTheme {
  id: string;
  name: string;
  type?: 'light' | 'dark';
  colors?: Record<string, string>;
}
export interface ThemeAPI {
  key: string;
  customKey: string;
  builtins: AppTheme[];
  parse(text: string): AppTheme;
  all(): AppTheme[];
  apply(id: string): string;
}
declare global { interface Window { reaktivThemes: ThemeAPI; } }

/** The small public script also applies the theme before Angular's first paint. */
export function themes(): ThemeAPI { return window.reaktivThemes; }

export function importThemes(files: {name: string; text: string}[]): AppTheme[] {
  if (!files.length) throw new Error('No JSON theme files found.');
  if (files.length > 100) throw new Error('Import at most 100 themes at once.');
  const api = themes();
  // Validate the complete batch before replacing any saved theme.
  const imported = files.map(file => {
    try { return api.parse(file.text); }
    catch (error) { throw new Error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  if (new Set(imported.map(t => t.id)).size !== imported.length) throw new Error('Theme names must be unique within a folder.');
  const merged = new Map(api.all().filter(t => t.id.startsWith('custom:')).map(t => [t.id,t]));
  for (const theme of imported) merged.set(theme.id,theme);
  if (merged.size > 100) throw new Error('Keep at most 100 custom themes.');
  localStorage.setItem(api.customKey, JSON.stringify([...merged.values()]));
  return imported;
}
