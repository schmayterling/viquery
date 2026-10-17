import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const modelsDir = join(root, 'models')
export const fixture = join(root, 'tests/fixtures/library')

export function binaries() {
  const find = (name: string) => {
    const filename = process.platform === 'win32' ? `${name}.exe` : name
    const path = (process.env.PATH ?? '')
      .split(delimiter)
      .map((directory) => join(directory, filename))
      .find(existsSync)
    if (!path) throw new Error(`${name} missing from PATH`)
    return path
  }
  return { ffmpeg: find('ffmpeg'), ffprobe: find('ffprobe') }
}

export function dot(a: Float32Array, b: Float32Array) {
  let sum = 0
  for (const [i, value] of a.entries()) sum += value * (b[i] as number)
  return sum
}
