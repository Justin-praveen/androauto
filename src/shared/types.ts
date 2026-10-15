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
  lastRun?: { id: string; status: RunStatus; startedAt: string; durationMs: number; failedStep: number | null }
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

// ---- Replay (spec section 5) ---------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'aborted'
export type StepStatus = 'pending' | 'running' | 'passed' | 'warning' | 'failed' | 'skipped'

export interface RunStepResult {
  stepId: string
  status: StepStatus
  /** Locator strategy that found the element, or 'coordinates' when the fallback point was used. */
  locatorUsed?: string
  durationMs?: number
  error?: string
  warning?: string
  /** File names inside the run folder. */
  screenshot?: string
  hierarchy?: string
}

export interface Run {
  id: string
  projectId: string
  flowId: string
  flowName: string
  flowVersion: number
  device: string
  deviceModel: string
  status: RunStatus
  startedAt: string
  durationMs: number
  error?: string
  steps: RunStepResult[]
  batchId?: string
}

export type RunSummary = Omit<Run, 'steps'> & { failedStep: number | null; stepCount: number }

export interface BatchStatus {
  id: string
  projectId: string
  serial: string
  state: 'running' | 'done' | 'aborted'
  startedAt: number
  finishedAt: number | null
  /** One entry per flow, in run order. */
  runs: Run[]
  /** Index into runs of the flow running now. */
  current: number
}

// ---- AI test ideas (spec section 6) --------------------------------------------------------

export interface AiSettings {
  /** OpenAI-compatible endpoint, e.g. OmniRoute at http://localhost:20128/v1 */
  baseUrl: string
  model: string
  temperature: number
}

export interface AiSettingsView extends AiSettings {
  hasApiKey: boolean
}

export type TestCategory = 'positive' | 'negative' | 'boundary' | 'edge' | 'security' | 'usability'

export type TestChange =
  | { type: 'setText'; stepId: string; value: string }
  | { type: 'removeStep'; stepId: string }
  | { type: 'repeatStep'; stepId: string; times: number }
  | { type: 'stopAfter'; stepId: string }
  | { type: 'pressKey'; afterStepId: string; key: 'back' | 'home' | 'enter' }
  | { type: 'wait'; afterStepId: string; ms: number }
  | { type: 'assertTextContains'; afterStepId: string; text: string }

export interface TestIdea {
  id: string
  title: string
  category: TestCategory
  priority: 'high' | 'medium' | 'low'
  description: string
  expected: string
  /** Can be turned into a flow from the changes below; otherwise it is a manual check. */
  automatable: boolean
  changes: TestChange[]
  manualSteps: string[]
  /** Flow created from this idea, once the user creates it. */
  createdFlowId?: string
}

export interface TestIdeas {
  flowId: string
  flowVersion: number
  model: string
  generatedAt: string
  ideas: TestIdea[]
}
