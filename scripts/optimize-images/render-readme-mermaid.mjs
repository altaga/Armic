/**
 * Render README.md mermaid blocks to Docs/refs/generated/README-mermaid-N.png
 * Usage: node render-readme-mermaid.mjs (from repo root or this folder)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const README = path.join(REPO, 'README.md');
const OUT = path.join(REPO, 'Docs/refs/generated');

const text = fs.readFileSync(README, 'utf8');
const re = /```mermaid\s*\n([\s\S]*?)```/g;
fs.mkdirSync(OUT, { recursive: true });

let i = 0;
for (const m of text.matchAll(re)) {
  i += 1;
  const body = m[1].trim();
  const mmd = path.join(OUT, `README-mermaid-${i}.mmd`);
  const png = path.join(OUT, `README-mermaid-${i}.png`);
  fs.writeFileSync(mmd, body);
  execFileSync(
    'npx',
    ['-y', '@mermaid-js/mermaid-cli@10.9.1', '-i', mmd, '-o', png, '-b', 'white', '-s', '2'],
    { cwd: REPO, stdio: 'inherit', shell: true },
  );
  console.log(`OK README-mermaid-${i}.png`);
}

console.log(`\nRendered ${i} diagram(s) to ${OUT}`);
