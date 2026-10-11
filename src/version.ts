import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The package version, read from mgcheck's own package.json so the CLI and the
 * MCP server never drift from what was published. Walks upward because this
 * module runs from src/ (dev), dist/ or dist/mcp/ depending on how it was bundled.
 */
function readVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'mgcheck' && typeof pkg.version === 'string') return pkg.version;
      }
      dir = dirname(dir);
    }
  } catch { /* fall through */ }
  return '0.0.0';
}

export const VERSION = readVersion();
