// red-team scratch: chip parsing mid-sentence; quick look after Tab. args: <libraryDir> <outDir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [library, out] = process.argv.slice(-2)
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
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push(s)); true')
      await run('window.viquery.addFolder()')
      let s
      do { await delay(300); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(2000)
      // (a) type a natural-language query one keystroke at a time, like a user
      const typed = 'a video game console on a desk'
      for (let i = 1; i <= typed.length; i++) {
        await run(`(() => { const i = document.querySelector('input[aria-label="Search library"]'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, i.value + ${JSON.stringify(typed[i - 1])}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
        await delay(15)
      }
      await delay(800)
      log('typed "a video game console on a desk"', await run(`({ field: document.querySelector('input[aria-label="Search library"]').value, mediaSegment: [...document.querySelectorAll('.segmented[aria-label="Media type"] button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent })`))
      await shot('chip-eaten')
      // clear search and reset media
      await run(`(() => { const i = document.querySelector('input[aria-label="Search library"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await delay(500)
      log('after clearing the query, library view media filter', await run(`[...document.querySelectorAll('.segmented[aria-label="Media type"] button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent`))
      await run(`[...document.querySelectorAll('.segmented[aria-label="Media type"] button')][0].click(); true`)
      await delay(800)
      // (b) quick look: Space on a tile, Tab away, Escape
      await run(`(() => { const t = document.querySelector('.tile'); t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return true })()`)
      await delay(800)
      const open1 = await run(`!!document.querySelector('.quicklook')`)
      // move focus out the way Tab would (next focusable after the quick look is the grid/sidebar)
      await run(`document.querySelector('.sidebar button.nav').focus(); true`)
      await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`)
      await delay(400)
      log('quick look: open, focus moved out, Escape', { opened: open1, stillOpenAfterEscape: await run(`!!document.querySelector('.quicklook')`), focusTrapped: false })
      await shot('quicklook-escape')
      app.quit()
    } catch (error) { console.error('RC harness failed:', error); await shot('failure').catch(() => {}); app.exit(1) }
  })
})
await import(join(wt, 'out/main/index.js'))
