// Run after npm run build: PATH=/opt/homebrew/bin:$PATH npx electron tests/fixtures/core-smoke.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { app, dialog, net, shell } from 'electron'

const root = fileURLToPath(new URL('../../', import.meta.url))
const profile = join(root, 'out/core-smoke-profile')
const fixture = join(profile, 'fixtures')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
cpSync(join(root, 'tests/fixtures/library'), fixture, { recursive: true })
for (const [name, duration, audio] of [
  ['bars', 90, []],
  ['tone', 12, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000']],
  ['silence', 12, ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono']],
]) {
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=128x96:rate=5`,
    ...audio,
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    join(fixture, `${name}.mp4`),
  ])
}
// Distinct encodings keep three cat media identities; identical copies become path aliases.
for (const width of [128, 192])
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    join(fixture, 'cat.jpg'),
    '-vf',
    `scale=${width}:-1`,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    join(fixture, `cat-${width}.jpg`),
  ])
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
      assert.equal(folder.count, 8)
      let phase
      do {
        await delay(100)
        phase = await run('window.__smokeIndex.at(-1)')
      } while (phase?.phase !== 'idle' || phase.items !== 8)
      assert.equal(phase.failed, 0)
      const db = new DatabaseSync(join(profile, 'library/viquery.db'), {
        readOnly: true,
      })
      const jobs = db.prepare('select state from job').all()
      db.close()
      assert.equal(jobs.length, 19)
      assert.ok(jobs.every((job) => job.state === 'done'))
      const items = await run(
        `window.viquery.library({scope:{kind:'all'},media:'all'}).then(i => window.viquery.items(Array.from(i.ids)))`,
      )
      const cat = items.find((item) => item.name === 'cat.jpg')
      const coffee = items.find((item) => item.name === 'coffee.jpg')
      const video = items.find((item) => item.name === 'launch.mp4')
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
      const cats = items
        .filter((item) => /^cat(?:-\d+)?\.jpg$/u.test(item.name))
        .map((item) => item.id)
      const catHits = await run(
        "window.viquery.search('a cat', {scope:{kind:'all'},media:'all'})",
      )
      assert.deepEqual(
        {
          count: cats.length,
          topIsCat: cats.includes(catHits.images[0]?.mediaId),
          cats: catHits.images
            .filter((hit) => cats.includes(hit.mediaId))
            .map((hit) => hit.mediaId)
            .sort(),
        },
        { count: 3, topIsCat: true, cats: cats.sort() },
        'ranked retrieval preserves all three matching cat encodings',
      )
      const coffeeHits = await run(
        "window.viquery.search('a cup of coffee', {scope:{kind:'all'},media:'all'})",
      )
      assert.equal(coffeeHits.images[0]?.mediaId, coffee.id)
      const rocket = await run(
        `window.viquery.search('a rocket launching', {scope:{kind:'all'},media:'all'})`,
      )
      assert.deepEqual(
        [
          rocket.videos[0]?.mediaId,
          rocket.videos[0]?.moments[0]?.seekMs < 5500,
          rocket.videos.every((hit) =>
            hit.moments.every((m) => m.endMs - m.startMs <= 30000),
          ),
        ],
        [video.id, true, true],
        'rocket query ranks the rocket scene first, above generated testsrc2/tone/silence distractors',
      )
      const timeline = (query) =>
        run(`window.viquery.searchVideo(${video.id}, ${JSON.stringify(query)})`)
      const rocketHeat = await timeline('a rocket launching')
      const astronautHeat = await timeline('an astronaut')
      const speechHeat = await timeline('ask what you can do for your country')
      assert.deepEqual(
        rocketHeat.map((s) => s.match),
        [true, false],
      )
      assert.deepEqual(
        astronautHeat.map((s) => s.match),
        [false, true],
      )
      assert.ok(rocketHeat[0].score > rocketHeat[1].score)
      assert.ok(astronautHeat[1].score > astronautHeat[0].score)
      assert.ok(
        speechHeat.every(
          (s) =>
            s.match &&
            (s.sources.includes('visual') || s.seekMs === s.startMs) &&
            s.sources.includes('speech') &&
            /country/i.test(s.snippet),
        ),
      )
      console.info(
        'scene search:',
        JSON.stringify({ rocketHeat, astronautHeat, speechHeat }),
      )
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
      assert.equal(reloaded, 8)
      console.info(
        'core smoke passed: three utilities, nineteen jobs done, real search, thumb/sprite/frame, range/head, video seek, reload',
      )
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      console.error('core smoke failed:', error)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})

await import('../../out/main/index.js')
