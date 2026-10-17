// red-team scratch: does the grid keep the user's place when items land above the viewport? args: <libraryDir> <newFilesDir> <outDir>
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [library, extra, out] = process.argv.slice(-3)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
const log = (k, v) => console.log(`RC ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 300000)
app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => writeFileSync(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    const probe = `(() => { const s = document.querySelector('.scroll'); const r = s.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.tile'); return { scrollTop: s.scrollTop, height: document.querySelector('.grid').style.height, centerTile: el?.getAttribute('aria-label') ?? null } })()`
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push(s)); true')
      await run('window.viquery.addFolder()')
      let s
      do { await delay(200); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(2500)
      await run(`(() => { const b = [...document.querySelectorAll('.sidebar button.nav')].find(b => b.textContent.startsWith('All media')); b.click(); return true })()`)
      await delay(500)
      await run(`document.querySelector('.scroll').scrollTop = 2400; true`)
      await delay(800)
      const before = await run(probe)
      await shot('scroll-before')
      for (const f of readdirSync(extra)) cpSync(join(extra, f), join(library, f))
      await delay(6000) // watcher -> rescan -> libraryChanged -> refetch
      const after = await run(probe)
      await shot('scroll-after')
      log('viewport center before/after 60 newer items landed above', { before, after })
      app.quit()
    } catch (error) { console.error('RC harness failed:', error); await shot('failure').catch(() => {}); app.exit(1) }
  })
})
await import(join(wt, 'out/main/index.js'))
