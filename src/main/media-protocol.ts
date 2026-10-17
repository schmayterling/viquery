import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { DataPaths } from '../shared/paths.ts'

export type MediaLocation = {
  path: string
  root: string
  size: number
  mtimeMs: number
}

const mime: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg',
}

export function mediaHandler(
  paths: DataPaths,
  lookup: (id: number) => MediaLocation[],
  origin: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 })
    const url = new URL(request.url)
    const match = /^\/([1-9]\d*)(?:\/(0|[1-9]\d*))?$/.exec(url.pathname)
    const id = Number(match?.[1])
    const ms = match?.[2] === undefined ? undefined : Number(match[2])
    if (
      url.protocol !== 'vq:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      !match ||
      !Number.isSafeInteger(id) ||
      id > 0xffffffff ||
      (url.hostname === 'frame' ? !Number.isSafeInteger(ms) : ms !== undefined)
    ) {
      return new Response(null, { status: 404 })
    }
    const requestOrigin = request.headers.get('origin')
    if (requestOrigin && requestOrigin !== origin)
      return new Response(null, { status: 403 })
    const original = url.hostname === 'media'
    let locations: MediaLocation[]
    if (original) locations = lookup(id)
    else {
      const path =
        url.hostname === 'thumb'
          ? paths.thumb(id)
          : url.hostname === 'preview'
            ? paths.preview(id)
            : url.hostname === 'sprite'
              ? paths.sprite(id)
              : url.hostname === 'frame'
                ? paths.frame(id, ms as number)
                : null
      if (!path) return new Response(null, { status: 404 })
      locations = [{ path, root: paths.root, size: 0, mtimeMs: 0 }]
    }
    for (const location of locations) {
      try {
        const path = await realpath(location.path)
        const inside = relative(await realpath(location.root), path)
        if (
          inside === '..' ||
          inside.startsWith(`..${sep}`) ||
          isAbsolute(inside)
        )
          continue
        const type = original ? mime[extname(path).toLowerCase()] : 'image/webp'
        if (!type) continue
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        const info = await file.stat()
        if (
          !info.isFile() ||
          (original &&
            (info.size !== location.size || info.mtimeMs !== location.mtimeMs))
        ) {
          await file.close()
          continue
        }
        const range = byteRange(request.headers.get('range'), info.size)
        const headers = new Headers({
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
          'Access-Control-Allow-Origin': origin,
          Vary: 'Origin',
        })
        if (range === 'unsatisfiable') {
          await file.close()
          headers.set('Content-Range', `bytes */${info.size}`)
          headers.set('Content-Length', '0')
          return new Response(null, { status: 416, headers })
        }
        const start = range?.start ?? 0
        const end = range?.end ?? info.size - 1
        headers.set('Content-Length', String(end - start + 1))
        if (range)
          headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`)
        const status = range ? 206 : 200
        if (request.method === 'HEAD' || info.size === 0) {
          await file.close()
          return new Response(null, { status, headers })
        }
        const stream = file.createReadStream({ start, end })
        const abort = () => {
          stream.destroy()
        }
        request.signal.addEventListener('abort', abort, { once: true })
        stream.once('close', () =>
          request.signal.removeEventListener('abort', abort),
        )
        if (request.signal.aborted) abort()
        // node 24: toWeb cancellation destroys the fs stream, closing its owned fd.
        // https://nodejs.org/docs/v24.22.0/api/stream.html#streamreadabletowebstreamreadable-options
        return new Response(
          Readable.toWeb(stream) as ReadableStream<Uint8Array>,
          { status, headers },
        )
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (
          code === 'ENOENT' ||
          code === 'ENOTDIR' ||
          code === 'ELOOP' ||
          code === 'EACCES'
        )
          continue
        throw error
      }
    }
    return new Response(null, { status: 404 })
  }
}

function byteRange(
  value: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = value ? /^bytes=(\d*)-(\d*)$/.exec(value) : null
  if (!match || (!match[1] && !match[2])) return null
  const total = BigInt(size)
  const suffix = !match[1]
  const first = BigInt((suffix ? match[2] : match[1]) as string)
  const start = suffix ? (first >= total ? 0n : total - first) : first
  const last = !suffix && match[2] ? BigInt(match[2]) : total - 1n
  if (start >= total || last < start || (suffix && first === 0n))
    return 'unsatisfiable'
  return { start: Number(start), end: Number(last < total ? last : total - 1n) }
}
