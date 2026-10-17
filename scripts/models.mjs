import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(
  await readFile(
    new URL('../research/default-model-pins.json', import.meta.url),
    'utf8',
  ),
)

async function verified(path, pin) {
  try {
    if ((await stat(path)).size !== pin.bytes) return false
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === pin.sha256
}

for (const [repo, model] of Object.entries(manifest)) {
  for (const pin of model.files) {
    const target = join(root, 'models', repo, pin.file)
    if (await verified(target, pin)) {
      console.log(`verified ${repo}/${pin.file}`)
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    const partial = `${target}.partial`
    try {
      const response = await fetch(pin.url)
      if (!response.ok || !response.body)
        throw new Error(`${response.status} downloading ${pin.url}`)
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial),
      )
      if (!(await verified(partial, pin)))
        throw new Error(`sha256/size mismatch: ${repo}/${pin.file}`)
      await rename(partial, target)
      console.log(`downloaded ${repo}@${model.revision}/${pin.file}`)
    } finally {
      await rm(partial, { force: true })
    }
  }
}
