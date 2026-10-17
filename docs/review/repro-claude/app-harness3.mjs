// red-team scratch: folder-menu focus during indexing, resizer pointerup, stale Enter in player find. args: <libraryDir> <outDir>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'

const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [library, out] = process.argv.slice(-2)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
const log = (k, v) => console.log(`RC ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 400000)

app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    const shot = async (name) => writeFileSync(join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    const setInput = (selector, text) => `(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
    try {
      await run('window.__idx = []; window.__changes = 0; window.viquery.onIndex(s => window.__idx.push(s)); window.viquery.onLibraryChanged(() => window.__changes++); true')
      await run('window.viquery.addFolder()')
      let s
      do { await delay(100); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'videos')
      await delay(500)
      // 1. folder context menu -> confirm -> focus Remove, watch focus while indexing continues
      await run(`(() => { const b = [...document.querySelectorAll('.sidebar button.nav')].find(b => b.textContent.includes('lib-moments')); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 340 })); return true })()`)
      await delay(300)
      await run(`(() => { document.querySelector('.sidebar .menu[popover] .menu-item').click(); return true })()`)
      await delay(300)
      await run(`(() => { document.querySelector('.confirm .btn-danger').focus(); return document.activeElement.textContent })()`).then((t) => log('focused before', t))
      const seen = []
      const c0 = await run('window.__changes')
      for (let i = 0; i < 14; i++) { await delay(500); seen.push(await run('document.activeElement?.textContent ?? null')) }
      log('focus over 7s while indexing', { libraryChangedEvents: (await run('window.__changes')) - c0, activeElement: seen })
      await shot('folder-menu-focus')
      await run(`document.querySelector('.confirm .btn')?.click(); true`)
      await delay(300)
      // 2. resizer: pointerup without a pointerdown on it
      const before = await run(`getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-width')`)
      await run(`document.querySelector('.resizer').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 345, pointerId: 1 })); true`)
      await delay(300)
      log('resizer pointerup without drag', { before, after: await run(`getComputedStyle(document.querySelector('.app')).getPropertyValue('--sidebar-width')`) })
      // 3. stale Enter in player find
      do { await delay(300); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(2500)
      await run(`(() => { const t = [...document.querySelectorAll('.tile')].find(t => (t.getAttribute('aria-label') ?? '').startsWith('launch.mp4')); t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return !!t })()`)
      await delay(2000)
      await run(`(() => { const v = document.querySelector('.vplayer video'); v.pause(); document.querySelector('.vplayer').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); return true })()`)
      await delay(400)
      await run(setInput('.vpanel input[type=search]', 'an astronaut'))
      await delay(1500)
      log('find "an astronaut" pins', await run(`[...document.querySelectorAll('.vpanel .when')].map(e => e.textContent)`))
      await run(setInput('.vpanel input[type=search]', 'a rocket launching'))
      await run(`document.querySelector('.vpanel input[type=search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`)
      await delay(400)
      const t = await run(`document.querySelector('.vplayer video').currentTime`)
      await delay(1500)
      log('Enter right after typing "a rocket launching"', { seekedTo: t, pinsNow: await run(`[...document.querySelectorAll('.vpanel .when')].map(e => e.textContent)`) })
      app.quit()
    } catch (error) {
      console.error('RC harness failed:', error)
      await shot('failure').catch(() => {})
      app.exit(1)
    }
  })
})
await import(join(wt, 'out/main/index.js'))
