// red-team scratch: drive the real built app (out/main) against a crafted library, capture state + screenshots.
// usage (from worktree): PATH=/opt/homebrew/bin:$PATH npx electron /tmp/red-claude/app-harness.mjs <libraryDir> <outDir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog, net } from 'electron'

const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const library = process.argv.at(-2)
const out = process.argv.at(-1)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
const log = (k, v) => console.log(`RC ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 240000)

app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => writeFileSync(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    const type = (selector, text) => run(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push(s)); true')
      const t0 = Date.now()
      await run('window.viquery.addFolder()')
      log('addFolder ms', Date.now() - t0)
      let phase
      do { await delay(200); phase = await run('window.__idx.at(-1)') } while (phase?.phase !== 'idle')
      await delay(1500)
      log('idle', phase)
      const db = new DatabaseSync(join(profile, 'library/viquery.db'), { readOnly: true })
      log('jobs', db.prepare("select f.name, j.stage, j.state, j.attempts, substr(j.error,1,120) as error from job j join file f on f.media_id=j.media_id where j.state != 'done' or j.error is not null order by f.name").all())
      log('library rows', db.prepare("select f.name, m.kind, m.width, m.height, m.duration_ms, exists(select 1 from job j where j.media_id=m.id and j.stage='thumb' and j.state='done') ready from media m join file f on f.media_id=m.id order by f.name").all())
      const ids = Object.fromEntries(db.prepare('select name, media_id from file').all().map((r) => [r.name, r.media_id]))
      db.close()
      // search results + frame url status for every moment thumbnail
      for (const q of ['a rocket launching', 'a dog and a cat', 'purple giraffe', 'ask what you can do for your country']) {
        const r = await run(`window.viquery.search(${JSON.stringify(q)}, {scope:{kind:'all'},media:'all'})`)
        const frames = []
        for (const v of r.videos) for (const m of v.moments) {
          const status = (await net.fetch(`vq://frame/${v.mediaId}/${m.seekMs}`)).status
          frames.push(`${v.mediaId}@${m.seekMs}:${status}`)
        }
        log(`search ${q}`, { images: r.images.length, videos: r.videos.map((v) => [v.mediaId, v.moments.map((m) => `${m.startMs}-${m.endMs}`)]), pending: r.pending, frames })
      }
      // UI: rocket query, card + player
      await type('input[aria-label="Search library"]', 'a rocket launching')
      await delay(2000)
      log('ui rocket card', await run(`[...document.querySelectorAll('.moment')].map(m => m.getAttribute('aria-label') + ' | range=' + m.querySelector('.range')?.textContent)`))
      await shot('search-rocket')
      await run(`document.querySelector('.moment[data-id="${ids['launch.mp4']}"] .frame').click(); true`)
      await delay(2500)
      log('ui player rocket', await run(`({ t: document.querySelector('.vplayer video')?.currentTime, pins: [...document.querySelectorAll('.vpanel .when')].map(e => e.textContent), missing: document.querySelector('.missing')?.textContent ?? null })`))
      await shot('player-rocket')
      await run(`document.querySelector('.viewer-top button').click(); true`)
      await delay(500)
      // UI: stopword query
      await type('input[aria-label="Search library"]', 'a dog and a cat')
      await delay(2000)
      log('ui dog-and-cat', await run(`({ status: document.querySelector('[role=status]')?.textContent, cards: [...document.querySelectorAll('.moment')].map(m => [m.getAttribute('aria-label'), getComputedStyle(m.querySelector('.frame img')).visibility, m.querySelector('.frame img').src]) })`))
      await shot('search-dog-and-cat')
      // UI: open launch from dog-and-cat card -> player markers + hovered thumbnails
      await run(`document.querySelector('.moment .frame').click(); true`)
      await delay(2500)
      log('ui player dog-and-cat', await run(`({ pins: [...document.querySelectorAll('.vpanel .hit')].map(b => b.textContent + ' img=' + getComputedStyle(b.querySelector('img')).visibility + ' ' + b.querySelector('img').src) })`))
      await shot('player-dog-and-cat')
      await run(`document.querySelector('.viewer-top button').click(); true`)
      await delay(300)
      // UI: clear search, open specific originals in the viewer
      await type('input[aria-label="Search library"]', '')
      await delay(1500)
      for (const name of ['coffee-heic.heic', 'cat-tiff.tiff', 'clip-avi.avi', 'clip-mpg.mpg', 'gap.mp4']) {
        const opened = await run(`(() => { const t = [...document.querySelectorAll('.tile')].find(t => (t.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)})); if (!t) return false; t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
        await delay(2500)
        log(`viewer ${name}`, { opened, missing: await run(`document.querySelector('.missing')?.textContent ?? null`), status: await net.fetch(`vq://media/${ids[name]}`, { method: 'HEAD' }).then((r) => `${r.status} ${r.headers.get('content-type')}`), videoError: await run(`document.querySelector('.vplayer video')?.error?.message ?? null`) })
        await shot(`viewer-${name}`)
        await run(`document.querySelector('.viewer-top button')?.click(); true`)
        await delay(500)
      }
      log('library tiles', await run(`[...document.querySelectorAll('.tile')].map(t => t.getAttribute('aria-label') + ' img=' + !!t.querySelector('img'))`))
      await shot('library')
      app.quit()
    } catch (error) {
      console.error('RC harness failed:', error)
      await shot('failure').catch(() => {})
      app.exit(1)
    }
  })
})
await import(join(wt, 'out/main/index.js'))
