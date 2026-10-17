// red-team scratch: do moment cards blank out when a library change clears the item cache? args: <libraryDir> <outDir>
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [library, out] = process.argv.slice(-2)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true })
rmSync(join(library, 'late.jpg'), { force: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 300000)
app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push(s)); true')
      await run('window.viquery.addFolder()')
      let s
      do { await delay(300); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(2500)
      await run(`(() => { const i = document.querySelector('input[aria-label="Search library"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'a rocket launching'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await delay(2000)
      // sample card titles + marker geometry in the renderer at 16ms while a new file lands in the watched folder
      await run(`window.__samples = []; window.__t = setInterval(() => { const c = document.querySelector('.moment'); window.__samples.push([c?.querySelector('.name')?.textContent ?? null, c?.querySelector('.timeline button')?.style.width ?? null]) }, 16); true`)
      copyFileSync('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude/tests/fixtures/library/coffee.jpg', join(library, 'late.jpg'))
      await delay(4000)
      const samples = await run('clearInterval(window.__t); window.__samples')
      const distinct = [...new Set(samples.map((x) => JSON.stringify(x)))]
      console.log('RC card title/marker states observed over 4s after a library change:', JSON.stringify({ samples: samples.length, distinct, blankFrames: samples.filter((x) => !x[0]).length }))
      rmSync(join(library, 'late.jpg'), { force: true })
      app.quit()
    } catch (error) { console.error('RC harness failed:', error); app.exit(1) }
  })
})
await import(join(wt, 'out/main/index.js'))
