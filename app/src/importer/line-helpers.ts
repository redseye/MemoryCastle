// Shared line classification for markdown castle files (plan §8). Blank lines,
// heading lines, blockquote boilerplate, and HTML comments are structural and
// are discarded silently rather than reported as import warnings.

export function splitLines(content: string): string[] {
  return content.split(/\r\n|\n/);
}

export function isBlank(line: string): boolean {
  return line.trim() === '';
}

export function isHeading(line: string): boolean {
  return /^#+\s/.test(line.trim());
}

export function isBlockquote(line: string): boolean {
  return line.trim().startsWith('>');
}

export function isCommentLine(line: string): boolean {
  return line.trim().startsWith('<!--');
}

// True for any line that carries no importable content and should never be
// reported as an import warning.
export function isBoilerplate(line: string): boolean {
  return isBlank(line) || isHeading(line) || isBlockquote(line) || isCommentLine(line);
}
