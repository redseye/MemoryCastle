// Reads the package version at runtime rather than importing package.json as
// a module: package.json sits outside tsconfig's rootDir ("src"), so a
// static import would fail the build. The relative path below holds for both
// src/server/version.ts (dev/ts-node) and dist/server/version.js (built),
// since dist mirrors src's directory depth one-for-one.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readPackageVersion();
