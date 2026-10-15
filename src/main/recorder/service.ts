// Runs a recording session against a real device: getevent stream (Mode A), hierarchy
// snapshot loop, mirror actions (Mode B), and saving the result.

import { createInterface } from 'node:readline'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ElementInfo, Flow, RecordMode, RecorderStatus, SaveFlowRequest } from '@shared/types'
import { KEYCODES, type DeviceShell } from '../adb/adb'
import { parseImeFrame, parseImeShown, parseTouchDevice } from '../adb/parsers'
import type { AppiumManager } from '../appium-manager'
import type { DeviceManager } from '../device-manager'
import { AdbDumpSource, AppiumSource, type HierarchySource } from '../hierarchy/source'
import { focusedEditText, parseHierarchy } from '../hierarchy/tree'
import type { Mirror } from '../mirror'
import type { Store } from '../store'
import { RecorderEngine, type Snapshot } from './engine'
import { parseGeteventLine, TouchTracker } from './getevent'
import { buildFlow } from './save'

interface Session {
  serial: string
  projectId: string
  mode: RecordMode
  sh: DeviceShell
  engine: RecorderEngine
  source: HierarchySource
  getevent: ChildProcess | null
  startedAt: number
  alive: boolean
  queue: Promise<unknown>
  lastActionAt: number
}

const IDLE: RecorderStatus = { state: 'idle', mode: 'phone', serial: null, projectId: null, startedAt: null, steps: [], hierarchySource: null }

export class RecorderService extends EventEmitter {
  private s: Session | null = null
  private state: RecorderStatus['state'] = 'idle'
  private message = ''

  constructor(
    private readonly devices: DeviceManager,
    private readonly appium: AppiumManager,
    private readonly mirror: Mirror,
    private readonly store: Store
  ) {
    super()
  }

  status(): RecorderStatus {
    const s = this.s
    if (!s) return { ...IDLE, state: this.state, ...(this.message ? { message: this.message } : {}) }
    const msg = this.message || s.engine.lastMessage
    return {
      state: this.state,
      mode: s.mode,
      serial: s.serial,
      projectId: s.projectId,
      startedAt: s.startedAt,
      steps: s.engine.steps,
      hierarchySource: s.source.name,
      ...(msg ? { message: msg } : {})
    }
  }

  private changed(): void {
    this.emit('status', this.status())
  }

  async start(opts: { serial: string; projectId: string; mode: RecordMode; launchApp: boolean }): Promise<RecorderStatus> {
    if (this.state === 'recording' || this.state === 'starting') throw new Error('Already recording')
    const device = this.devices.get(opts.serial)
    if (!device || device.state !== 'device') throw new Error('Device is not connected')
    if (!device.screen) throw new Error('Could not read the device screen size')
    const project = this.store.getProject(opts.projectId)
    const sh = this.devices.shell(opts.serial)

    this.state = 'starting'
    this.message = 'Connecting to the device…'
    this.s = null
    this.changed()

    let source: HierarchySource
    try {
      source = this.appium.running ? await AppiumSource.open(this.appium.url!, opts.serial) : new AdbDumpSource(sh)
    } catch (e) {
      source = new AdbDumpSource(sh)
      this.message = `Appium session failed, using adb snapshots: ${(e as Error).message.split('\n')[0]}`
    }

    const engine = new RecorderEngine(device.screen, { detectTyping: opts.mode === 'phone' }, () => this.changed())
    const s: Session = {
      ...opts,
      sh,
      engine,
      source,
      getevent: null,
      startedAt: Date.now(),
      alive: true,
      queue: Promise.resolve(),
      lastActionAt: 0
    }
    this.s = s
    this.mirror.start(sh)

    try {
      if (opts.launchApp) {
        engine.launchApp(project.appPackage, project.appActivity)
        await sh.launch(project.appPackage, project.appActivity)
        s.lastActionAt = Date.now()
      }
      if (opts.mode === 'phone') await this.startGetevent(s, device.screen)
    } catch (e) {
      await this.teardown()
      this.state = 'idle'
      this.s = null
      this.message = (e as Error).message
      this.changed()
      throw e
    }

    this.state = 'recording'
    if (!this.message.startsWith('Appium')) this.message = ''
    this.changed()
    void this.snapshotLoop(s)
    return this.status()
  }

  private async startGetevent(s: Session, screen: { w: number; h: number }): Promise<void> {
    const input = parseTouchDevice(await s.sh.shell('getevent -pl', 15000))
    if (!input) throw new Error('No touchscreen found in getevent -p. Try "In mirror" mode on this device.')
    const tracker = new TouchTracker(input, screen, (g) => {
      if (this.s === s && this.state === 'recording') s.engine.onGesture(g)
    })
    const proc = s.sh.adb.stream(['-s', s.serial, 'shell', 'getevent', '-lt'])
    s.getevent = proc
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      const e = parseGeteventLine(line, Date.now())
      if (e) tracker.feed(e)
    })
    proc.on('exit', () => {
      if (this.s === s && this.state === 'recording') {
        this.message = 'Lost the connection to the device input stream'
        this.changed()
      }
    })
  }

  /** Serialised: uiautomator can't dump twice at once. */
  private snapshot(s: Session): Promise<Snapshot | null> {
    const next = s.queue.then(() => this.takeSnapshot(s)).catch(() => null)
    s.queue = next
    return next
  }

  private async takeSnapshot(s: Session): Promise<Snapshot | null> {
    if (!s.alive) return null
    const xml = await s.source.dump()
    const takenAt = Date.now()
    const tree = parseHierarchy(xml)
    let keyboard: Snapshot['keyboard'] = null
    if (s.mode === 'phone' && focusedEditText(tree)) {
      const shown = parseImeShown(await s.sh.shell('dumpsys input_method').catch(() => ''))
      if (shown) keyboard = parseImeFrame(await s.sh.shell('dumpsys window InputMethod').catch(() => ''))
    }
    const frame = this.mirror.latest
    const snap: Snapshot = { tree, xml, takenAt, keyboard, png: frame?.serial === s.serial ? frame.png : undefined }
    if (s.alive) s.engine.addSnapshot(snap)
    return snap
  }

  private async snapshotLoop(s: Session): Promise<void> {
    let failures = 0
    while (s.alive && this.s === s && this.state === 'recording') {
      const snap = await this.snapshot(s)
      if (!snap) {
        failures++
        if (failures === 3) {
          this.message = 'Screen snapshots are failing; steps will fall back to coordinates'
          this.changed()
        }
        await new Promise((r) => setTimeout(r, 1000))
      } else if (failures) {
        failures = 0
        this.message = ''
        this.changed()
      }
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  /** Snapshot that reflects the screen after the last action (Mode B needs the current screen). */
  private async freshSnapshot(s: Session): Promise<Snapshot | null> {
    const latest = s.engine.latestSnapshot
    if (latest && latest.takenAt > s.lastActionAt + 400) return latest
    return (await this.snapshot(s)) ?? latest
  }

  private need(): Session {
    if (!this.s || this.state !== 'recording') throw new Error('Not recording')
    return this.s
  }

  async mirrorGesture(g: { from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }): Promise<RecorderStatus> {
    const s = this.need()
    const snap = await this.freshSnapshot(s)
    const step = s.engine.mirrorGesture(snap, g.from, g.to, g.durationMs)
    if (step.action === 'tap') await s.sh.tap(g.from.x, g.from.y)
    else if (step.action === 'longPress') await s.sh.swipe(g.from.x, g.from.y, g.from.x, g.from.y, Math.max(600, g.durationMs))
    else await s.sh.swipe(g.from.x, g.from.y, g.to.x, g.to.y, Math.max(150, g.durationMs))
    s.lastActionAt = Date.now()
    return this.status()
  }

  async mirrorText(text: string): Promise<RecorderStatus> {
    const s = this.need()
    const snap = await this.freshSnapshot(s)
    s.engine.mirrorText(snap, text)
    await s.sh.inputText(text)
    s.lastActionAt = Date.now()
    return this.status()
  }

  async mirrorKey(key: keyof typeof KEYCODES): Promise<RecorderStatus> {
    const s = this.need()
    s.engine.pressKey(s.engine.latestSnapshot, key)
    await s.sh.keyevent(KEYCODES[key])
    s.lastActionAt = Date.now()
    return this.status()
  }

  async addAssert(x: number, y: number, kind: 'assertVisible' | 'assertText'): Promise<RecorderStatus> {
    const s = this.need()
    const step = s.engine.addAssert(await this.freshSnapshot(s), x, y, kind)
    if (!step) throw new Error('No element at that point')
    return this.status()
  }

  addWait(ms: number): RecorderStatus {
    this.need().engine.addWait(ms)
    return this.status()
  }

  deleteStep(id: string): RecorderStatus {
    this.s?.engine.deleteStep(id)
    return this.status()
  }

  elementAt(x: number, y: number): ElementInfo | null {
    return this.s?.engine.elementAt(x, y) ?? null
  }

  async stop(): Promise<RecorderStatus> {
    if (!this.s) return this.status()
    await this.teardown()
    this.state = this.s.engine.steps.length ? 'review' : 'idle'
    if (this.state === 'idle') this.s = null
    this.changed()
    return this.status()
  }

  private async teardown(): Promise<void> {
    const s = this.s
    if (!s) return
    s.alive = false
    s.getevent?.kill()
    await s.queue.catch(() => {})
    await s.source.close()
  }

  save(req: SaveFlowRequest): Flow {
    const s = this.s
    if (!s || this.state !== 'review') throw new Error('Stop the recording before saving')
    const project = this.store.getProject(s.projectId)
    const { flow, secrets } = buildFlow(project, this.devices.get(s.serial) ?? null, s.engine.steps, req)
    const saved = this.store.createFlow(flow, s.engine.artifacts)
    for (const [k, v] of Object.entries(secrets)) this.store.setSecret(k, v)
    this.s = null
    this.state = 'idle'
    this.message = ''
    this.changed()
    return saved
  }

  async discard(): Promise<RecorderStatus> {
    await this.teardown()
    this.s = null
    this.state = 'idle'
    this.message = ''
    this.changed()
    return this.status()
  }
}
