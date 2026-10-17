import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Only fetch metadata. Never download or run third-party binaries.
const releases = [
  ['electron/electron', 'v44.9.0'],
  ['eugeneware/ffmpeg-static', 'b6.1.1'],
  ['ente/ffmpeg-packaging', '9.0.2'],
  ['microsoft/onnxruntime', 'v1.30.0'],
  ['libvips/libvips', 'v8.18.7']
];
const releaseResults = [];
for (const [repo, tag] of releases) {
  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'viquery-research' } });
  const data = await response.json();
  releaseResults.push({ repo, tag, status: response.status, url, published: data.published_at, assets: (data.assets ?? []).filter(a => !/debug|pdb|symbols|chromedriver|mksnapshot|ffplay|ffserver/.test(a.name)).map(a => ({ name: a.name, bytes: a.size, url: a.browser_download_url, digest: a.digest })) });
}
const names = ['@img/sharp-darwin-arm64','@img/sharp-darwin-x64','@img/sharp-win32-x64','@img/sharp-linux-x64','@img/sharp-linux-arm64','@img/sharp-libvips-darwin-arm64','@img/sharp-libvips-darwin-x64','@img/sharp-libvips-win32-x64','@img/sharp-libvips-linux-x64','@img/sharp-libvips-linux-arm64','@ffmpeg-installer/darwin-arm64','@ffmpeg-installer/darwin-x64','@ffmpeg-installer/win32-x64','@ffmpeg-installer/linux-x64','@ffmpeg-installer/linux-arm64','chokidar@4.0.3'];
const packages = [];
for (const name of names) {
  const result = spawnSync('/opt/homebrew/bin/npm', ['view', name, 'version', 'dist.unpackedSize', 'license', '--json'], { encoding: 'utf8', timeout: 30000 });
  packages.push({ name, status: result.status, ...(result.status === 0 ? JSON.parse(result.stdout) : { error: result.stderr.slice(-400) }) });
}
const result = { checked: new Date().toISOString(), note: 'github asset bytes are compressed archive sizes except bare executable assets; npm sizes are full unpacked packages, not installed product sizes', releases: releaseResults, packages };
writeFileSync(new URL('./assets.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ releases: releaseResults.map(x => ({repo: x.repo, tag: x.tag, status:x.status, assets:x.assets.length})), packages }, null, 2));
