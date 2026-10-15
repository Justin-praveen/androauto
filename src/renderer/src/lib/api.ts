import type { AndroautoBridge } from '@shared/api'
import { createMockBridge } from './mock-api'

/** The Electron bridge, or an in-memory mock when the UI runs in a plain browser (npm run ui:preview). */
export const api: AndroautoBridge = window.androauto ?? createMockBridge()
export const isMock = !window.androauto
