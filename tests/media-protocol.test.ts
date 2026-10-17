import assert from 'node:assert/strict'
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mediaHandler } from '../src/main/media-protocol.ts'
import { dataPaths } from '../src/shared/paths.ts'

test('media protocol streams original ranges, head, empty files and limits paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viquery-protocol-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'launch.mp4')
  await cp(new URL('./fixtures/library/launch.mp4', import.meta.url), file)
  const info = await stat(file)
  const bytes = await readFile(file)
  const empty = join(root, 'empty.mp4')
  await writeFile(empty, '')
  const zero = await stat(empty)
  const link = join(root, 'external.mp4')
  await symlink(file, link)
  const handler = mediaHandler(
    dataPaths(root),
    (id) => [
      {
        path: id === 2 ? empty : id === 3 ? link : file,
        root: id === 3 ? join(root, 'other') : root,
        size: id === 2 ? 0 : info.size,
        mtimeMs: id === 2 ? zero.mtimeMs : info.mtimeMs,
      },
    ],
    'null',
  )
  const response = await handler(new Request('vq://media/1'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('content-type'), 'video/mp4')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  for (const [value, start, end] of [
    ['bytes=20-49', 20, 49],
    ['bytes=20-', 20, bytes.length - 1],
    ['bytes=-100', bytes.length - 100, bytes.length - 1],
    ['bytes=0-999999999999999999999', 0, bytes.length - 1],
  ] as const) {
    const ranged = await handler(
      new Request('vq://media/1', { headers: { Range: value } }),
    )
    assert.equal(ranged.status, 206)
    assert.equal(
      ranged.headers.get('content-range'),
      `bytes ${start}-${end}/${bytes.length}`,
    )
    assert.equal(Number(ranged.headers.get('content-length')), end - start + 1)
    assert.deepEqual(
      Buffer.from(await ranged.arrayBuffer()),
      bytes.subarray(start, end + 1),
    )
  }
  const head = await handler(
    new Request('vq://media/1', {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    }),
  )
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-length'), '10')
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  for (const range of ['bytes=-0', `bytes=${bytes.length}-`, 'bytes=9-2']) {
    const invalid = await handler(
      new Request('vq://media/1', { headers: { Range: range } }),
    )
    assert.equal(invalid.status, 416)
    assert.equal(
      invalid.headers.get('content-range'),
      `bytes */${bytes.length}`,
    )
  }
  const multi = await handler(
    new Request('vq://media/1', { headers: { Range: 'bytes=0-1,5-6' } }),
  )
  assert.equal(multi.status, 200)
  await multi.body?.cancel()
  assert.equal(
    (await handler(new Request('vq://media/2'))).headers.get('content-length'),
    '0',
  )
  assert.equal(
    (
      await handler(
        new Request('vq://media/2', { headers: { Range: 'bytes=0-' } }),
      )
    ).status,
    416,
  )
  assert.equal((await handler(new Request('vq://media/3'))).status, 404)
  assert.equal((await handler(new Request('vq://media/1/2'))).status, 404)
  assert.equal(
    (await handler(new Request('vq://frame/1/../../etc/passwd'))).status,
    404,
  )
  const controller = new AbortController()
  const aborted = await handler(
    new Request('vq://media/1', { signal: controller.signal }),
  )
  controller.abort()
  await aborted.body?.cancel()
})
