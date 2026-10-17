import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const packages = ['electron','electron-vite','vite','typescript','react','react-dom','electron-builder','@electron/rebuild','better-sqlite3','sqlite-vec','@libsql/client','@libsql/hrana-client','usearch','hnswlib-node','@lancedb/lancedb','faiss-node','ffmpeg-static','ffprobe-static','@ffmpeg-installer/ffmpeg','ffbinaries','sharp','onnxruntime-node','@parcel/watcher','chokidar','blake3','hash-wasm'];
const results = [];
for (const name of packages) {
  const out = spawnSync('/opt/homebrew/bin/npm', ['view', name, 'version', 'dist-tags', 'engines', 'license', 'dist.unpackedSize', 'repository.url', '--json'], { encoding: 'utf8', timeout: 30000 });
  const row = { name, status: out.status, ...(out.status === 0 ? JSON.parse(out.stdout) : { error: out.stderr.slice(-600) }) };
  if (row.version) {
    const meta = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`).then(r => r.json());
    row.published = meta.time?.[row.version];
    row.source = `https://registry.npmjs.org/${encodeURIComponent(name)}/${row.version}`;
  }
  results.push(row);
  process.stdout.write(`${name}: ${row.version ?? row.error}\n`);
}
writeFileSync(new URL('./releases.json', import.meta.url), JSON.stringify({ checked: new Date().toISOString(), method: 'npm view; registry metadata for publish timestamp', node: process.version, packages: results }, null, 2) + '\n');
