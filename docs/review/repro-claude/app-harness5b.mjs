// red-team scratch: quit while the thumb stage runs ffmpeg on a long 4k video; do ffmpeg children outlive the app? args: <libraryDir> <outDir>
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
const ps = () => { try { return execFileSync('/bin/ps', ['-axo', 'pid,ppid,etime,command']).toString().split('\n').filter((l) => l.includes('bin/ffmpeg') && l.includes('uhd60')).map((l) => l.trim()) } catch { return [] } }
app.once('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    await win.webContents.executeJavaScript('window.viquery.addFolder()')
    for (let i = 0; i < 100 && !ps().some((l) => l.includes('filter:v')); i++) await delay(100)
    console.log('RC ffmpeg before quit:', JSON.stringify(ps().map((l) => l.slice(0, 60) + ' … ' + l.slice(l.indexOf('-i '), l.indexOf('-i ') + 60))))
    app.quit()
  })
})
app.on('will-quit', () => {
  // electron exits right after this; a detached checker reports what is still running
  const script = `sleep 2; echo "RC 2s after quit:"; ps -axo pid,ppid,etime,command | grep bin/ffmpeg | grep uhd60 | grep -v grep | cut -c1-90; sleep 12; echo "RC 14s after quit:"; ps -axo pid,ppid,etime,command | grep bin/ffmpeg | grep uhd60 | grep -v grep | cut -c1-90; echo "RC leftover decode dirs:"; for d in $(find ${profile} -name '.decode-*' -maxdepth 6); do echo "$d $(ls $d | wc -l) files"; done`
  execFileSync('/bin/sh', ['-c', `(${script}) > ${join(out, 'after-quit.txt')} 2>&1 &`])
})
await import(join(wt, 'out/main/index.js'))
