/// <reference types="vite/client" />
import type { ViqueryApi } from '../../shared/api'

declare global {
  interface Window {
    viquery: ViqueryApi
  }
}
