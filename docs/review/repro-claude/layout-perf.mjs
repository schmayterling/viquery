import { justify, monthGroups, move } from '/tmp/red-claude/layout.bundle.mjs'
const N = 100_000
const takenAt = new Float64Array(N), aspect = new Float32Array(N)
let t = Date.now()
for (let i = 0; i < N; i++) { t -= Math.random() * 3 * 3600_000; takenAt[i] = t; aspect[i] = [1.5, 0.75, 1.333, 1, 1.777][i % 5] }
const lib = { takenAt, aspect }
const time = (label, fn, runs = 7) => { const xs = []; let r; for (let i = 0; i < runs; i++) { const s = performance.now(); r = fn(); xs.push(performance.now() - s) } xs.sort((a, b) => a - b); console.log(`${label}: median ${xs[runs >> 1].toFixed(1)}ms min ${xs[0].toFixed(1)} max ${xs.at(-1).toFixed(1)} (n=${runs})`); return r }
const groups = time('monthGroups(100k)', () => monthGroups(lib))
console.log('groups', groups.length)
const geo = time('justify(100k, 1100px, 196)', () => justify(aspect, groups, 1100, 196, false))
console.log('rows', geo.rows.length, 'height', Math.round(geo.height))
time('justify(100k, square)', () => justify(aspect, groups, 1100, 196, true))
