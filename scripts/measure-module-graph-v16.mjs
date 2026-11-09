#!/usr/bin/env node
// Count the actual static ESM closure of app.js. Dynamic modules and workers are
// deliberately excluded: this measures parse-blocking code, not total traffic.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { init, parse } = require(require.resolve('es-module-lexer', {
  paths: [require.resolve('vite')],
}));
await init;

const baseline = process.argv[2] || '6ee683ee505b36e212e1b0f12a987a863d71ddf4';
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Use a full baseline Git commit SHA.');
const entry = 'public/app.js';
function localDependency(file, specifier) {
  if (!specifier?.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.split(/[?#]/, 1)[0]));
}
async function graph(revision, entries = [entry]) {
  const pending = [...entries], nodes = new Map(), external = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (nodes.has(file)) continue;
    const bytes = revision
      ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
      : await fs.readFile(path.join(root, file));
    const [imports] = parse(bytes.toString('utf8'), file);
    const statics = [], dynamics = [];
    for (const item of imports) {
      if (item.d === -2) continue; // import.meta
      if (item.d >= 0) {
        dynamics.push(item.n || '(non-literal dynamic import)');
        continue;
      }
      const dependency = localDependency(file, item.n);
      if (dependency) { statics.push(dependency); pending.push(dependency); }
      else external.add(item.n || '(unresolved static import)');
    }
    nodes.set(file, {
      file,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      imports: [...new Set(statics)].sort(),
      dynamicImports: [...new Set(dynamics)].sort(),
    });
  }
  const modules = [...nodes.values()].sort((a, b) => a.file.localeCompare(b.file));
  return {
    revision: revision || 'working tree',
    entries,
    moduleCount: modules.length,
    bytes: modules.reduce((n, m) => n + m.bytes, 0),
    gzipBytes: modules.reduce((n, m) => n + m.gzipBytes, 0),
    externalImports: [...external].sort(),
    modules,
  };
}
const before = await graph(baseline);
const after = await graph(null);
const beforeQuick = await graph(baseline, ['public/quick-views.js']);
const afterQuick = await graph(null, ['public/quick-views.js']);
const afterFirstView = await graph(null, [entry, 'public/quick-views.js']);
const beforeFiles = new Set(before.modules.map(m => m.file));
const afterFiles = new Set(after.modules.map(m => m.file));
const result = {
  method: 'ESM lexer follows literal static imports/re-exports from public/app.js; dynamic imports, workers, CSS, framework bootstrap and data fetches excluded. gzipBytes sums per-file gzip level 9, a transport-size estimate rather than measured wire traffic.',
  before,
  after,
  quickViews: {before: beforeQuick, after: afterQuick},
  afterFirstView,
  change: {
    modules: after.moduleCount - before.moduleCount,
    bytes: after.bytes - before.bytes,
    gzipBytes: after.gzipBytes - before.gzipBytes,
    byteReductionPercent: +(100 * (1 - after.bytes / before.bytes)).toFixed(2),
    gzipReductionPercent: +(100 * (1 - after.gzipBytes / before.gzipBytes)).toFixed(2),
    removed: [...beforeFiles].filter(f => !afterFiles.has(f)).sort(),
    added: [...afterFiles].filter(f => !beforeFiles.has(f)).sort(),
  },
};
const output = path.join(root, 'docs/module-loading-v16/graph.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  baseline,
  before: { modules: before.moduleCount, bytes: before.bytes, gzipBytes: before.gzipBytes },
  after: { modules: after.moduleCount, bytes: after.bytes, gzipBytes: after.gzipBytes },
  quickViews: {
    before: { modules: beforeQuick.moduleCount, bytes: beforeQuick.bytes, gzipBytes: beforeQuick.gzipBytes },
    after: { modules: afterQuick.moduleCount, bytes: afterQuick.bytes, gzipBytes: afterQuick.gzipBytes },
  },
  afterFirstView: { modules: afterFirstView.moduleCount, bytes: afterFirstView.bytes, gzipBytes: afterFirstView.gzipBytes },
  change: result.change,
  output: path.relative(root, output),
}, null, 2));
