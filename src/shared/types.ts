// Data model from spec.md section 3. Shared by the main process and the UI.

export interface Project {
  id: string
  name: string
  appPackage: string
  appActivity: string
  apkPath?: string
  launchOptions: { clearDataBeforeRun: boolean; grantPermissions: boolean }
  createdAt: string
}

export interface ProjectSummary extends Project {
  flowCount: number
}

export interface ScreenInfo {
  w: number
  h: number
  density: number
}

export interface Device {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | string
  model: string
  android: string
  sdk: number
  screen: ScreenInfo | null
  connection: 'usb' | 'wifi' | 'emulator'
}

export type StepAction =
  | 'tap'
  | 'longPress'
  | 'swipe'
  | 'scroll'
  | 'type'
  | 'pressKey'
  | 'launchApp'
  | 'wait'
  | 'assertVisible'
  | 'assertText'

export type LocatorStrategy = 'id' | 'accessibility id' | 'uiautomator' | 'xpath'

export interface Locator {
  strategy: LocatorStrategy
  value: string
}

export interface ElementInfo {
  class: string
  text: string
  resourceId: string
  contentDesc: string
  bounds: [number, number, number, number]
  password?: boolean
}

export interface StepTarget {
  locators: Locator[]
  element: ElementInfo | null
  fallbackPoint: { xPct: number; yPct: number }
}

export interface Step {
  id: string
  action: StepAction
  target?: StepTarget
  params?: Record<string, unknown>
  waitBeforeMs: number
  timeoutMs: number
  snapshot?: string
  /** Shown in the UI: element could not be resolved, step falls back to coordinates. */
  warning?: string
  /** Typed into a password field: value is unknown until the user fills it in on save. */
  secret?: boolean
}

export interface Flow {
  id: string
  projectId: string
  name: string
  description: string
  tags: string[]
  version: number
  recordedOn: { serial: string; model: string; screen: { w: number; h: number } } | null
  startState: { launchApp: boolean; clearData: boolean }
  variables: Record<string, string>
  steps: Step[]
  createdAt: string
  updatedAt: string
}

export type FlowSummary = Pick<Flow, 'id' | 'projectId' | 'name' | 'tags' | 'version' | 'updatedAt'> & {
  stepCount: number
}

export type RecordMode = 'phone' | 'mirror'

export interface RecorderStatus {
  /** review: stopped, steps waiting to be saved or discarded. */
  state: 'idle' | 'starting' | 'recording' | 'review'
  mode: RecordMode
  serial: string | null
  projectId: string | null
  startedAt: number | null
  steps: Step[]
  hierarchySource: 'appium' | 'adb' | null
  message?: string
}

export interface SetupCheck {
  adb: { ok: boolean; detail: string }
  appium: { ok: boolean; detail: string }
  uiautomator2: { ok: boolean; detail: string }
}

export interface MirrorFrame {
  serial: string
  /** data:image/png;base64,... */
  dataUrl: string
  w: number
  h: number
  at: number
}

export interface SaveFlowRequest {
  name: string
  description: string
  tags: string[]
  /** stepId -> variable name. The step's typed text becomes ${name}. */
  variables: Record<string, string>
  /** stepId -> value for password steps whose text could not be read from the screen. */
  secretValues: Record<string, string>
}

export interface InstalledApp {
  package: string
  activity: string | null
}
