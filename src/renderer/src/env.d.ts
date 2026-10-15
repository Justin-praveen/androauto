import type { AndroautoBridge } from '@shared/api'

declare global {
  interface Window {
    androauto?: AndroautoBridge
  }
}
