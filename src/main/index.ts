import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { constants as osConstants, setPriority } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  MessageChannelMain,
  type MessagePortMain,
  nativeTheme,
  protocol,
  session,
  shell,
  type UtilityProcess,
  utilityProcess,
} from 'electron'
import type { CatalogReady } from '../catalog/index'
import catalogPath from '../catalog/index.ts?modulePath'
import computePath from '../compute/index.ts?modulePath'
import searchPath from '../search/index.ts?modulePath'
import {
  type AppInfo,
  CHANNELS,
  type Folder,
  type ServiceState,
} from '../shared/api'
import { dataPaths } from '../shared/paths'
import type { Peer, UtilityMessage } from '../shared/protocol'
import { type Client, connect, mainPort } from '../shared/rpc'
import { type MediaLocation, mediaHandler } from './media-protocol'

// electron 44: stream makes media elements consume streamed responses; ranges are implemented separately.
// https://www.electronjs.org/docs/latest/api/protocol#protocolregisterschemesasprivilegedcustomschemes
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vq',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false,
    },
  },
])

const utilities = new Set<UtilityProcess>()
let serviceState: ServiceState = 'ready'
let booted = false
let recovering = false
let restarts = 0
let catalog: Client
let workers: {
  catalog: UtilityProcess
  compute: UtilityProcess
  search: UtilityProcess
}
let db: DatabaseSync
let quitting = false
const rendererURL = new URL(
  !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href,
).href

function spawn(path: string, name: string): UtilityProcess {
  const child = utilityProcess.fork(path, [], {
    serviceName: `viquery ${name}`,
    stdio: 'pipe',
  })
  utilities.add(child)
  child.stdout?.on('data', (data) => process.stdout.write(`[${name}] ${data}`))
  child.stderr?.on('data', (data) => process.stderr.write(`[${name}] ${data}`))
  child.on('spawn', () => {
    console.info(`${name} utility started (${child.pid})`)
    if (name === 'compute' && child.pid) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch (error) {
        console.error('compute priority:', error)
      }
    }
  })
  child.on('error', (error) => console.error(`${name} utility:`, error))
  child.on('exit', (code) => {
    utilities.delete(child)
    if (!quitting && booted && !recovering) {
      console.error(`${name} utility exited (${code})`)
      void recoverUtilities()
    }
  })
  return child
}

function sendPort(
  child: UtilityProcess,
  peer: Peer,
  port: MessagePortMain,
): void {
  child.postMessage({ type: 'port', peer } satisfies UtilityMessage, [port])
}

function link(
  a: UtilityProcess,
  aPeer: Peer,
  b: UtilityProcess,
  bPeer: Peer,
): void {
  const { port1, port2 } = new MessageChannelMain()
  sendPort(a, bPeer, port1)
  sendPort(b, aPeer, port2)
}

// dev: out/main/index.js -> repo root, independent of how electron was launched
const repo = join(import.meta.dirname, '../..')

async function binary(name: string): Promise<string> {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  if (app.isPackaged) return join(process.resourcesPath, 'bin', executable)
  const candidates = [
    join(repo, 'resources', 'bin'),
    ...(process.env.PATH ?? '').split(delimiter),
  ]
  for (const directory of candidates) {
    const path = join(directory, executable)
    try {
      await access(path, fsConstants.X_OK)
      return path
    } catch {
      /* try next executable on PATH */
    }
  }
  throw new Error(`${name} not found on PATH`)
}

async function startUtilities(): Promise<void> {
  const dataDir = join(app.getPath('userData'), 'library')
  const init: UtilityMessage = {
    type: 'init',
    dataDir,
    modelsDir: app.isPackaged
      ? join(process.resourcesPath, 'models')
      : join(repo, 'models'),
    ffmpeg: await binary('ffmpeg'),
    ffprobe: await binary('ffprobe'),
  }
  workers = {
    catalog: spawn(catalogPath, 'catalog'),
    compute: spawn(computePath, 'compute'),
    search: spawn(searchPath, 'search'),
  }
  const ready = new Promise<void>((resolve, reject) => {
    workers.catalog.on('message', (message: CatalogReady) => {
      if (message.type === 'ready') resolve()
    })
    workers.catalog.once('exit', (code) =>
      reject(new Error(`catalog exited during startup (${code})`)),
    )
  })
  const searchReady = new Promise<void>((resolve, reject) => {
    workers.search.on('message', (message: CatalogReady) => {
      if (message.type === 'ready') resolve()
    })
    workers.search.once('exit', (code) =>
      reject(new Error(`search exited during startup (${code})`)),
    )
  })
  // Observe both startup failures even if catalog fails before search is awaited.
  void searchReady.catch(() => {})
  workers.catalog.postMessage(init)
  await ready
  if (!db) {
    db = new DatabaseSync(dataPaths(dataDir).db, { readOnly: true })
    db.exec('pragma query_only=on')
    protocol.handle(
      'vq',
      mediaHandler(
        dataPaths(dataDir),
        (id) =>
          db
            .prepare(`
    select f.path,d.path as root,f.size,f.mtime_ms as mtimeMs
    from file f join folder d on d.id=f.folder_id where f.media_id=? order by f.id
  `)
            .all(id) as MediaLocation[],
        new URL(rendererURL).origin,
      ),
    )
  }
  workers.compute.postMessage(init)
  workers.search.postMessage(init)
  const { port1, port2 } = new MessageChannelMain()
  catalog = connect(mainPort(port1))
  sendPort(workers.catalog, 'main', port2)
  link(workers.catalog, 'catalog', workers.compute, 'compute')
  link(workers.catalog, 'catalog', workers.search, 'search')
  await searchReady
}

function connectRenderer(win: BrowserWindow): void {
  const catalogChannel = new MessageChannelMain()
  const searchChannel = new MessageChannelMain()
  sendPort(workers.catalog, 'renderer', catalogChannel.port1)
  sendPort(workers.search, 'renderer', searchChannel.port1)
  win.webContents.postMessage(CHANNELS.ports, null, [
    catalogChannel.port2,
    searchChannel.port2,
  ])
}

function services(state: ServiceState): void {
  serviceState = state
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send(CHANNELS.services, state)
}

async function stopUtilities(): Promise<void> {
  catalog?.disconnect()
  await Promise.all(
    [...utilities].map(
      (child) =>
        new Promise<void>((resolve) => {
          child.once('exit', () => resolve())
          child.kill()
        }),
    ),
  )
}

async function recoverUtilities(): Promise<void> {
  recovering = true
  services('recovering')
  await stopUtilities()
  while (!quitting && restarts < 3) {
    await delay(500 * 3 ** restarts++)
    try {
      await startUtilities()
      if (quitting) return
      for (const win of BrowserWindow.getAllWindows()) connectRenderer(win)
      services('ready')
      recovering = false
      return
    } catch (error) {
      console.error('service restart:', error)
      await stopUtilities()
    }
  }
  if (!quitting) services('failed')
  recovering = false
}

function trusted(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (
    !win ||
    event.senderFrame !== win.webContents.mainFrame ||
    event.senderFrame.url !== rendererURL
  )
    throw new Error('untrusted ipc sender')
  return win
}

// design §5 tokens: --surface / --ink; win/linux draw native controls over the topbar
const chrome = () => {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    height: 40,
    color: dark ? '#202020' : '#f5f5f5',
    symbolColor: dark ? '#ececec' : '#33393a',
  }
}

// default menu binds cmd/ctrl +/-/0 to page zoom; the renderer owns those keys
const menu = () =>
  Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ])

function createWindow(): void {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 12, y: 13 },
    ...(!mac && { titleBarOverlay: chrome() }),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f5f5f5',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  if (!mac) {
    const update = () => win.setTitleBarOverlay(chrome())
    nativeTheme.on('updated', update)
    win.once('closed', () => nativeTheme.off('updated', update))
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererURL) event.preventDefault()
  })
  win.webContents.on('did-finish-load', () => {
    if (serviceState === 'ready') connectRenderer(win)
    win.webContents.send(CHANNELS.services, serviceState)
  })
  win.on('focus', () => {
    void catalog.call('reconnect').catch(console.error)
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    win.loadURL(rendererURL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

if (primary)
  app
    .whenReady()
    .then(async () => {
      // Electron 44: fullscreen is a permission; limit it to our top-level app page.
      // https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler
      session.defaultSession.setPermissionRequestHandler(
        (webContents, permission, callback, details) =>
          callback(
            permission === 'fullscreen' &&
              details.isMainFrame &&
              webContents.mainFrame.url === rendererURL &&
              details.requestingUrl === rendererURL,
          ),
      )
      session.defaultSession.setPermissionCheckHandler(
        (webContents, permission, _origin, details) =>
          permission === 'fullscreen' &&
          details.isMainFrame === true &&
          webContents?.mainFrame.url === rendererURL &&
          details.requestingUrl === rendererURL,
      )
      const devOrigin = process.env.ELECTRON_RENDERER_URL
        ? new URL(rendererURL).origin
        : null
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url)
        const remote = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
        const dev =
          devOrigin &&
          url.host === new URL(rendererURL).host &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        callback({ cancel: remote && !dev })
      })
      await startUtilities()
      booted = true
      ipcMain.handle(CHANNELS.appInfo, (event): AppInfo => {
        trusted(event)
        return { version: app.getVersion(), platform: process.platform }
      })
      ipcMain.handle(
        CHANNELS.addFolder,
        async (event): Promise<Folder | null> => {
          const picked = await dialog.showOpenDialog(trusted(event), {
            properties: ['openDirectory'],
          })
          if (picked.canceled || !picked.filePaths[0]) return null
          return catalog.call<Folder>('addFolder', picked.filePaths[0])
        },
      )
      ipcMain.handle(CHANNELS.reveal, async (event, id: unknown) => {
        trusted(event)
        if (
          typeof id !== 'number' ||
          !Number.isSafeInteger(id) ||
          id < 1 ||
          id > 0xffffffff
        )
          throw new Error('invalid media id')
        const path = await catalog.call<string | null>('lookup', id)
        if (path) shell.showItemInFolder(path)
      })
      Menu.setApplicationMenu(menu())
      createWindow()
      app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win?.isMinimized()) win.restore()
        win?.focus()
      })
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((error) => {
      console.error('startup:', error)
      app.quit()
    })

app.on('before-quit', () => {
  quitting = true
  for (const child of utilities) child.kill()
  db?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
