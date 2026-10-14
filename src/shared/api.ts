import type {
  Device,
  Flow,
  FlowSummary,
  InstalledApp,
  MirrorFrame,
  Project,
  ProjectSummary,
  RecordMode,
  RecorderStatus,
  SaveFlowRequest,
  SetupCheck,
  ElementInfo
} from './types'

export interface NewProjectInput {
  name: string
  appPackage: string
  appActivity: string
  apkPath?: string
  launchOptions?: Partial<Project['launchOptions']>
}

/** Request/response calls. Each key is an IPC channel handled in src/main/ipc.ts. */
export interface InvokeApi {
  'projects:list': () => ProjectSummary[]
  'projects:create': (input: NewProjectInput) => Project
  'projects:update': (id: string, patch: Partial<NewProjectInput>) => Project
  'projects:delete': (id: string) => void

  'flows:list': (projectId: string) => FlowSummary[]
  'flows:get': (projectId: string, flowId: string) => Flow
  'flows:delete': (projectId: string, flowId: string) => void

  'devices:list': () => Device[]
  'devices:setup': () => SetupCheck
  'devices:pair': (hostPort: string, code: string) => string
  'devices:connect': (hostPort: string) => string
  'devices:apps': (serial: string) => InstalledApp[]
  'devices:launch': (serial: string, projectId: string) => void

  'appium:start': () => SetupCheck

  'mirror:start': (serial: string) => void
  'mirror:stop': () => void
  /** Element under a point on the mirror, for the inspector hover. */
  'mirror:elementAt': (x: number, y: number) => ElementInfo | null

  'recorder:start': (opts: { serial: string; projectId: string; mode: RecordMode; launchApp: boolean }) => RecorderStatus
  'recorder:stop': () => RecorderStatus
  'recorder:status': () => RecorderStatus
  'recorder:deleteStep': (stepId: string) => RecorderStatus
  'recorder:addWait': (ms: number) => RecorderStatus
  /** Mode B: a click or drag on the mirror, in device pixels. */
  'recorder:mirrorGesture': (g: { from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }) => RecorderStatus
  'recorder:mirrorText': (text: string) => RecorderStatus
  'recorder:mirrorKey': (key: 'back' | 'home' | 'enter') => RecorderStatus
  'recorder:addAssert': (x: number, y: number, kind: 'assertVisible' | 'assertText') => RecorderStatus
  'recorder:save': (req: SaveFlowRequest) => Flow
  'recorder:discard': () => RecorderStatus
}

/** Pushed from main to the UI. */
export interface EventApi {
  'devices:changed': Device[]
  'recorder:status': RecorderStatus
  'mirror:frame': MirrorFrame
}

type Promisify<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never

export interface AndroautoBridge {
  invoke<K extends keyof InvokeApi>(channel: K, ...args: Parameters<InvokeApi[K]>): ReturnType<Promisify<InvokeApi[K]>>
  on<K extends keyof EventApi>(channel: K, cb: (payload: EventApi[K]) => void): () => void
}

export const INVOKE_CHANNELS: (keyof InvokeApi)[] = [
  'projects:list', 'projects:create', 'projects:update', 'projects:delete',
  'flows:list', 'flows:get', 'flows:delete',
  'devices:list', 'devices:setup', 'devices:pair', 'devices:connect', 'devices:apps', 'devices:launch',
  'appium:start',
  'mirror:start', 'mirror:stop', 'mirror:elementAt',
  'recorder:start', 'recorder:stop', 'recorder:status', 'recorder:deleteStep', 'recorder:addWait',
  'recorder:mirrorGesture', 'recorder:mirrorText', 'recorder:mirrorKey', 'recorder:addAssert',
  'recorder:save', 'recorder:discard'
]

export const EVENT_CHANNELS: (keyof EventApi)[] = ['devices:changed', 'recorder:status', 'mirror:frame']
