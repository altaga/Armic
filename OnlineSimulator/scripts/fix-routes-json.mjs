import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routesPath = join(root, 'dist', 'server', '_expo', 'routes.json');

const raw = readFileSync(routesPath, 'utf8');
const fixed = raw.replace(/\\/g, '/');
if (fixed !== raw) {
  writeFileSync(routesPath, fixed);
  console.log('Fixed Windows backslashes in dist/server/_expo/routes.json');
}
