// renderer <-> main contract. the preload exposes exactly this shape as window.viquery.
export type AppInfo = { version: string; platform: string }

export type ViqueryApi = {
  appInfo(): Promise<AppInfo>
}

export const CHANNELS = {
  appInfo: 'app:info',
} as const
