// Path normalization helpers. Internal storage paths are always forward-slash;
// input from callers (esp. on Windows) may use backslashes and must be normalized
// before comparison or persistence.

export function toForwardSlash(path: string): string {
  return path.replace(/\\/g, '/');
}
