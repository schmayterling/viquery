// Run after npm run build: PATH=/opt/homebrew/bin:$PATH npx electron tests/fixtures/core-smoke.mjs
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { app, dialog, net, shell } from 'electron'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = join(root, 'tests/fixtures/library')
const profile = join(root, 'out/core-smoke-profile')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.getAppPath = () => root
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
let revealed
shell.showItemInFolder = (path) => {
  revealed = path
}
const timeout = setTimeout(() => {
  console.error('core smoke timed out')
  app.exit(1)
}, 180000)

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const run = (code) => win.webContents.executeJavaScript(code)
      await run(
        'window.__smokeIndex = []; window.viquery.onIndex(s => window.__smokeIndex.push(s)); true',
      )
      const info = await run('window.viquery.appInfo()')
      assert.equal(info.platform, process.platform)
      const folder = await run('window.viquery.addFolder()')
      assert.equal(folder.count, 3)
      let phase
      do {
        await delay(100)
        phase = await run('window.__smokeIndex.at(-1)')
      } while (phase?.phase !== 'idle' || phase.items !== 3)
      assert.equal(phase.failed, 0)
      const db = new DatabaseSync(join(profile, 'library/viquery.db'), {
        readOnly: true,
      })
      const jobs = db.prepare('select state from job').all()
      db.close()
      assert.equal(jobs.length, 7)
      assert.ok(jobs.every((job) => job.state === 'done'))
      const items = await run(
        `window.viquery.library({scope:{kind:'all'},media:'all'}).then(i => window.viquery.items(Array.from(i.ids)))`,
      )
      const cat = items.find((item) => item.name === 'cat.jpg')
      const coffee = items.find((item) => item.name === 'coffee.jpg')
      const video = items.find((item) => item.kind === 'video')
      assert.ok(cat && coffee && video)
      const scenes = await run(`window.viquery.scenes(${video.id})`)
      assert.equal(scenes.length, 2)
      for (const url of [
        `vq://thumb/${cat.id}`,
        `vq://sprite/${video.id}`,
        `vq://frame/${video.id}/${scenes[0].frameMs}`,
      ]) {
        const size = await run(`(async () => {
          const image = new Image()
          image.src = ${JSON.stringify(url)}
          await image.decode()
          return [image.naturalWidth, image.naturalHeight]
        })()`)
        assert.ok(size[0] > 0 && size[1] > 0)
      }
      assert.match(
        (await run(`window.viquery.transcript(${video.id})`))
          .map((s) => s.text)
          .join(' '),
        /country/i,
      )
      for (const [query, expected] of [
        ['a cat', cat.id],
        ['a cup of coffee', coffee.id],
      ]) {
        const result = await run(
          `window.viquery.search(${JSON.stringify(query)}, {scope:{kind:'all'},media:'all'})`,
        )
        assert.equal(result.images[0]?.mediaId, expected)
      }
      const rocket = await run(
        `window.viquery.search('a rocket launching', {scope:{kind:'all'},media:'all'})`,
      )
      assert.equal(rocket.videos[0]?.mediaId, video.id)
      assert.ok(rocket.videos[0].moments[0].seekMs < 5500)
      const astronaut = await run(
        `window.viquery.search('an astronaut', {scope:{kind:'all'},media:'all'})`,
      )
      assert.ok(astronaut.videos[0]?.moments[0].seekMs >= 5500)
      const speech = await run(
        `window.viquery.search('ask what you can do for your country', {scope:{kind:'all'},media:'all'})`,
      )
      assert.equal(speech.videos[0]?.mediaId, video.id)
      assert.ok(
        speech.videos[0].moments.some((moment) =>
          moment.sources.includes('speech'),
        ),
      )
      await run(`window.viquery.reveal(${video.id})`)
      assert.equal(resolve(revealed), resolve(video.path))
      const ranged = await net.fetch(`vq://media/${video.id}`, {
        headers: { Range: 'bytes=32-95' },
      })
      assert.equal(ranged.status, 206)
      assert.equal(
        ranged.headers.get('content-range'),
        `bytes 32-95/${video.bytes}`,
      )
      assert.deepEqual(
        Buffer.from(await ranged.arrayBuffer()),
        readFileSync(video.path).subarray(32, 96),
      )
      const head = await net.fetch(`vq://media/${video.id}`, { method: 'HEAD' })
      assert.equal(head.headers.get('content-length'), String(video.bytes))
      assert.equal((await head.arrayBuffer()).byteLength, 0)
      const seek = await run(`new Promise((resolve, reject) => {
        const video = document.createElement('video')
        const timeout = setTimeout(() => reject(new Error('video seek timed out')), 10000)
        video.muted = true
        video.onloadedmetadata = () => { video.currentTime = 8 }
        video.onseeked = () => { clearTimeout(timeout); resolve({time:video.currentTime,duration:video.duration}); video.remove() }
        video.onerror = () => { clearTimeout(timeout); reject(new Error('video playback failed: '+video.error?.message)) }
        video.src = 'vq://media/${video.id}'
        document.body.append(video)
        video.load()
      })`)
      assert.ok(Math.abs(seek.time - 8) < 0.1)
      const loaded = once(win.webContents, 'did-finish-load')
      win.reload()
      await loaded
      const reloaded = await run(
        "window.viquery.library({scope:{kind:'all'},media:'all'}).then(i => i.ids.length)",
      )
      assert.equal(reloaded, 3)
      console.info(
        'core smoke passed: three utilities, seven jobs done, real search, thumb/sprite/frame, range/head, video seek, reload',
      )
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      console.error('core smoke failed:', error)
      clearTimeout(timeout)
      process.exitCode = 1
      app.quit()
    }
  })
})

await import('../../out/main/index.js')
