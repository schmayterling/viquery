import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

// Run: /opt/homebrew/bin/node research/bench-platform/scan.mjs
// Exact dot-product top-20; single worker, seeded data, no dependencies.
const rows = Number(process.env.BENCH_ROWS ?? 100000);
const dims = Number(process.env.BENCH_DIMS ?? 512);
const runs = 15;
const warmups = 5;
const k = 20;
let seed = 0x12345678;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }

function offer(heap, id, score, limit) {
  if (heap.length < limit) {
    heap.push({ id, score });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >>> 1;
      if (heap[p].score <= score) break;
      heap[i] = heap[p]; i = p;
    }
    heap[i] = { id, score };
    return;
  }
  if (score <= heap[0].score) return;
  let i = 0;
  while (i * 2 + 1 < heap.length) {
    let c = i * 2 + 1;
    if (c + 1 < heap.length && heap[c + 1].score < heap[c].score) c++;
    if (heap[c].score >= score) break;
    heap[i] = heap[c]; i = c;
  }
  heap[i] = { id, score };
}

// Separate functions keep V8's typed-array accesses monomorphic.
function scanFloat32(matrix, query, count, dimension, limit) {
  const heap = [];
  for (let row = 0, offset = 0; row < count; row++, offset += dimension) {
    let score = 0;
    for (let d = 0; d < dimension; d++) score += matrix[offset + d] * query[d];
    offer(heap, row, score, limit);
  }
  return heap.sort((a, b) => b.score - a.score);
}
function scanInt8(matrix, query, count, dimension, limit) {
  const heap = [];
  for (let row = 0, offset = 0; row < count; row++, offset += dimension) {
    let score = 0;
    for (let d = 0; d < dimension; d++) score += matrix[offset + d] * query[d];
    offer(heap, row, score, limit);
  }
  return heap.sort((a, b) => b.score - a.score);
}
function verify(scan, Type) {
  const n = 37, d = 7, limit = 5;
  const a = Type.from({ length: n * d }, () => Type === Int8Array ? Math.floor(random() * 255) - 127 : random() * 2 - 1);
  const q = Type.from({ length: d }, () => Type === Int8Array ? Math.floor(random() * 255) - 127 : random() * 2 - 1);
  const reference = Array.from({ length: n }, (_, id) => ({ id, score: Array.from(q).reduce((sum, v, j) => sum + a[id * d + j] * v, 0) })).sort((x, y) => y.score - x.score).slice(0, limit);
  assert.deepEqual(scan(a, q, n, d, limit), reference);
}
function quantile(a, q) { return a[Math.ceil(q * a.length) - 1]; }
function measure(type, scan, matrix, Type) {
  const samples = [];
  let checksum = 0;
  for (let i = -warmups; i < runs; i++) {
    const query = Type.from({ length: dims }, () => Type === Int8Array ? Math.floor(random() * 255) - 127 : random() * 2 - 1);
    const start = performance.now();
    const result = scan(matrix, query, rows, dims, k);
    const ms = performance.now() - start;
    checksum += result[0].id + result[0].score;
    if (i >= 0) samples.push(ms);
  }
  const ordered = [...samples].sort((a, b) => a - b);
  return { type, bytes: matrix.byteLength, minMs: ordered[0], p50Ms: quantile(ordered, .5), p95Ms: quantile(ordered, .95), maxMs: ordered.at(-1), meanMs: samples.reduce((a, b) => a + b) / samples.length, samplesMs: samples, checksum };
}

if (isMainThread) {
  const start = performance.now();
  const worker = new Worker(new URL(import.meta.url));
  worker.once('message', result => {
    result.totalWorkerLifetimeMs = performance.now() - start;
    const path = new URL(`./scan-${rows}x${dims}.json`, import.meta.url);
    writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  });
  worker.once('error', error => { console.error(error); process.exitCode = 1; });
} else {
  verify(scanFloat32, Float32Array);
  verify(scanInt8, Int8Array);
  const started = performance.now();
  const floats = new Float32Array(rows * dims);
  const ints = new Int8Array(rows * dims);
  for (let i = 0; i < floats.length; i++) { const v = random() * 2 - 1; floats[i] = v; ints[i] = Math.round(v * 127); }
  const setupMs = performance.now() - started;
  const results = [measure('float32', scanFloat32, floats, Float32Array), measure('int8', scanInt8, ints, Int8Array)];
  parentPort.postMessage({ checked: new Date().toISOString(), node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), rows, dims, k, runs, warmups, setupMs, correctness: 'both typed-array scans match independent full-sort reference', workload: 'seeded uniform random row-major matrix; new query each run; dot product plus exact top-k heap; warm in-memory; one worker thread; excludes embedding/ipc/db/disk', results, memory: process.memoryUsage() });
}
