// red-team scratch: marker click target, utility crash behavior. args: <scenario> <libraryDir> <outDir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'

const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [scenario, library, out] = process.argv.slice(-3)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
const log = (k, v) => console.log(`RC ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 300000)
const utility = (name) => app.getAppMetrics().find((m) => m.type === 'Utility' && [m.serviceName, m.name].some((s) => (s ?? '').includes(name)))

app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => writeFileSync(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    const type = (text) => run(`(() => { const i = document.querySelector('input[aria-label="Search library"]'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    const db = () => new DatabaseSync(join(profile, 'library/viquery.db'), { readOnly: true })
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push({ ...s, at: Date.now() })); true')
      await run('window.viquery.addFolder()')
      if (scenario === 'compute-kill') {
        let s
        do { await delay(100); s = await run('window.__idx.at(-1)') } while (!(s?.phase === 'videos' && s.done >= 1))
        const victim = utility('compute')
        log('killing compute', { pid: victim?.pid, state: s })
        process.kill(victim.pid, 'SIGKILL')
        await delay(25000)
        const last = await run('window.__idx.at(-1)')
        const d = db()
        log('25s after compute crash', { lastIndexEvent: last, eventAgeMs: Date.now() - last.at, jobs: d.prepare('select stage, state, count(*) n from job group by stage, state').all() })
        d.close()
        await shot('compute-crash-footer')
        app.quit()
        return
      }
      let s
      do { await delay(200); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(1000)
      const api = await run(`window.viquery.search('a rocket launching', {scope:{kind:'all'},media:'all'})`)
      const d = db()
      const ids = Object.fromEntries(d.prepare('select name, media_id from file').all().map((r) => [r.name, r.media_id]))
      d.close()
      const bars = api.videos.find((v) => v.mediaId === ids['bars.mp4'])
      log('api bars moments (rank order)', bars?.moments.map((m) => `${m.startMs}-${m.endMs} seek=${m.seekMs}`))
      await type('a rocket launching')
      await delay(2000)
      // click the marker of the latest moment that is not moments[0]
      const k = bars.moments.reduce((best, m, i) => (i > 0 && (best < 0 || m.startMs > bars.moments[best].startMs) ? i : best), -1)
      log('clicking marker', { k, moment: bars.moments[k] })
      await run(`(() => { const card = document.querySelector('.moment[data-id="${ids['bars.mp4']}"]'); card.querySelectorAll('.timeline button')[${k}].click(); return true })()`)
      await delay(3000)
      log('player after marker click', { currentTime: await run(`document.querySelector('.vplayer video')?.currentTime`), expectedAtLeast: (bars.moments[k].startMs - 1000) / 1000 })
      await shot('marker-click-player')
      await run(`document.querySelector('.viewer-top button').click(); true`)
      await delay(800)
      // keyboard path: focus card, ] to the same moment, Enter
      await run(`(() => { const card = document.querySelector('.moment[data-id="${ids['bars.mp4']}"]'); card.focus(); for (let i = 0; i < ${k}; i++) card.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true })); return card.getAttribute('aria-label') })()`).then((l) => log('card label after ]', l))
      await delay(200)
      await run(`(() => { const card = document.querySelector('.moment[data-id="${ids['bars.mp4']}"]'); card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true })()`)
      await delay(3000)
      log('player after ] + Enter', { currentTime: await run(`document.querySelector('.vplayer video')?.currentTime`) })
      await run(`document.querySelector('.viewer-top button').click(); true`)
      await delay(800)
      // search utility crash: does the ui ever surface it?
      const victim = utility('search')
      log('killing search', { pid: victim?.pid })
      process.kill(victim.pid, 'SIGKILL')
      await delay(500)
      await type('a cat')
      await delay(8000)
      log('ui 8s after search crash, query "a cat"', await run(`({ header: document.querySelector('.head')?.textContent, error: document.querySelector('.error-line')?.textContent ?? null, stale: document.querySelector('.results')?.dataset.stale ?? null, cards: [...document.querySelectorAll('.moment')].map(m => m.dataset.id) })`))
      await shot('search-crash')
      app.quit()
    } catch (error) {
      console.error('RC harness failed:', error)
      await shot('failure').catch(() => {})
      app.exit(1)
    }
  })
})
await import(join(wt, 'out/main/index.js'))
