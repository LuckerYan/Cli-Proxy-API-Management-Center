// Combines the two-pass Vite builds (`BUILD_ENTRY=main` then
// `BUILD_ENTRY=codexExtract`) into a single dist layout that mirrors what
// release workflows expect:
//   dist/index.html            -> main React app (management center)
//   dist/codex-extract.html    -> standalone Codex card extraction page
//
// The second Vite invocation writes to `dist/codexExtract/index.html`; this
// script lifts that file out and removes the intermediate folder.
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sub = path.join(root, 'dist', 'codexExtract');
const subEntry = path.join(sub, 'codex-extract.html');
const target = path.join(root, 'dist', 'codex-extract.html');

try {
  statSync(subEntry);
} catch {
  console.error('postbuild: missing', subEntry);
  process.exit(1);
}

mkdirSync(path.dirname(target), { recursive: true });
try {
  rmSync(target);
} catch {
  /* ignore */
}
renameSync(subEntry, target);
rmSync(sub, { recursive: true, force: true });
console.log('postbuild: wrote', path.relative(root, target));
