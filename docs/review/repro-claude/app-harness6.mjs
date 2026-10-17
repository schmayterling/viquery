// red-team scratch: arrow through videos in the viewer; count main-process fds still open on originals. args: <libraryDir> <outDir>
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, dialog } from 'electron'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const [library, out] = process.argv.slice(-2)
const profile = join(out, 'profile')
rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [library] })
const fds = () => execFileSync('/usr/sbin/lsof', ['-p', String(process.pid)]).toString().split('\n').filter((l) => l.includes(library.split('/').at(-1)) && /\.(mp4|mov)/.test(l)).length
setTimeout(() => { console.error('RC timeout'); app.exit(1) }, 300000)
app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code)
    try {
      await run('window.__idx = []; window.viquery.onIndex(s => window.__idx.push(s)); true')
      await run('window.viquery.addFolder()')
      let s
      do { await delay(300); s = await run('window.__idx.at(-1)') } while (s?.phase !== 'idle')
      await delay(2000)
      await run(`(() => { const b = [...document.querySelectorAll('.sidebar button.nav')].find(b => b.textContent.startsWith('Videos')); b.click(); return true })()`)
      await delay(1000)
      await run(`(() => { const t = document.querySelector('.tile'); t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
      await delay(1500)
      const seen = []
      for (let i = 0; i < 7; i++) {
        seen.push({ video: await run(`document.querySelector('.viewer .title')?.textContent`), openFds: fds(), videoEls: await run(`document.querySelectorAll('video').length`) })
        await run(`document.querySelector('.viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true`)
        await delay(1200)
      }
      await delay(3000)
      seen.push({ after3s: true, openFds: fds() })
      console.log('RC fds while arrowing through videos:', JSON.stringify(seen))
      app.quit()
    } catch (error) { console.error('RC harness failed:', error); app.exit(1) }
  })
})
await import(join(wt, 'out/main/index.js'))
