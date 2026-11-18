/** The reason from a Python error (its last line without the exception type), not the traceback. */
export function pythonErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const last =
    text
      .trim()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .at(-1) ?? text;
  return last.replace(/^(?:[A-Za-z_.]*(?:Error|Exception)):\s*/, '');
}
