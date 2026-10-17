import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ViqueryApi } from '../shared/api'

const api: ViqueryApi = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
}

contextBridge.exposeInMainWorld('viquery', api)
