// indexed read the caller knows is in bounds (noUncheckedIndexedAccess)
export const at = <T>(a: ArrayLike<T>, i: number) => a[i] as T

const numbers = new Intl.NumberFormat()
const months = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
})
const days = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const longDays = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export const num = (n: number) => numbers.format(n)
export const count = (n: number, one: string, many = `${one}s`) =>
  `${num(n)} ${n === 1 ? one : many}`
export const month = (ms: number) => months.format(ms)
export const day = (ms: number) => days.format(ms)
export const longDay = (ms: number) => longDays.format(ms)

// m:ss or h:mm:ss (design §3), never raw seconds
export function timecode(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const ss = String(s % 60).padStart(2, '0')
  const m = Math.floor(s / 60)
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}`
    : `${m}:${ss}`
}
export const span = (startMs: number, endMs: number) =>
  `${timecode(startMs)} – ${timecode(endMs)}`

export function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000
    i++
  }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${units[i]}`
}

export function minutes(ms: number) {
  const m = Math.round(ms / 60_000)
  return m < 1
    ? '<1 min'
    : m < 60
      ? `${m} min`
      : `${Math.floor(m / 60)} h ${m % 60} min`
}
