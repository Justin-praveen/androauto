// The recorder's core: turns gestures plus UI snapshots into Steps (spec section 4).
// No I/O here; RecorderService feeds it, which keeps it unit-testable without a phone.

import type { ElementInfo, ScreenInfo, Step, StepTarget } from '@shared/types'
import { buildLocators } from '../hierarchy/locators'
import {
  contains,
  elementAt,
  focusedEditText,
  scrollableAt,
  toElementInfo,
  type Bounds,
  type UiNode,
  type UiTree
} from '../hierarchy/tree'
import { classifyTouch, type Gesture } from './getevent'

export interface Snapshot {
  tree: UiTree
  xml: string
  /** Host ms when the dump finished; the UI it shows existed at or before this time. */
  takenAt: number
  png?: Buffer
  /** Soft keyboard rectangle when it is on screen. */
  keyboard?: Bounds | null
}

export interface StepArtifacts {
  xml: string
  png?: Buffer
}

export const DEFAULT_TIMEOUT_MS = 10000
/** A snapshot older than this before a touch is too stale to trust for element lookup. */
export const MAX_SNAPSHOT_AGE_MS = 8000

interface TypingState {
  key: string
  baseline: string
  stepId: string | null
}

export class RecorderEngine {
  readonly steps: Step[] = []
  readonly artifacts = new Map<string, StepArtifacts>()
  private snapshots: Snapshot[] = []
  private counter = 0
  private typing: TypingState | null = null
  lastMessage = ''

  constructor(
    private readonly screen: ScreenInfo,
    private readonly opts: { detectTyping: boolean },
    private readonly onChange: () => void = () => {}
  ) {}

  get latestSnapshot(): Snapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null
  }

  /** Latest snapshot that finished before `t` (spec: use the pre-touch snapshot). */
  snapshotBefore(t: number): Snapshot | null {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const s = this.snapshots[i]
      if (s.takenAt <= t) return t - s.takenAt <= MAX_SNAPSHOT_AGE_MS ? s : null
    }
    return null
  }

  addSnapshot(s: Snapshot): void {
    this.snapshots.push(s)
    if (this.snapshots.length > 12) this.snapshots.shift()
    if (this.opts.detectTyping) this.detectTyping(s)
  }

  private nextId(): string {
    this.counter++
    return `stp_${String(this.counter).padStart(2, '0')}`
  }

  private push(step: Omit<Step, 'id' | 'waitBeforeMs' | 'timeoutMs'>, snap: Snapshot | null): Step {
    const full: Step = { id: this.nextId(), waitBeforeMs: 0, timeoutMs: DEFAULT_TIMEOUT_MS, ...step }
    if (snap) {
      full.snapshot = `snapshots/${full.id}`
      this.artifacts.set(full.id, { xml: snap.xml, png: snap.png })
    }
    this.steps.push(full)
    this.typing = this.typing && { ...this.typing, stepId: null }
    this.onChange()
    return full
  }

  private pct(x: number, y: number): { xPct: number; yPct: number } {
    const r = (n: number): number => Math.round(n * 10000) / 10000
    return { xPct: r(x / this.screen.w), yPct: r(y / this.screen.h) }
  }

  private targetFor(snap: Snapshot | null, x: number, y: number): { target: StepTarget; warning?: string } {
    const fallbackPoint = this.pct(x, y)
    if (!snap) return { target: { locators: [], element: null, fallbackPoint }, warning: 'No screen snapshot yet: uses coordinates' }
    const hit = elementAt(snap.tree, x, y)
    if (!hit) return { target: { locators: [], element: null, fallbackPoint }, warning: 'No element at this point: uses coordinates' }
    return { target: this.target(snap.tree, hit.target, fallbackPoint, hit.leaf) }
  }

  private target(tree: UiTree, node: UiNode, fallbackPoint: StepTarget['fallbackPoint'], leaf?: UiNode): StepTarget {
    return { locators: buildLocators(tree, node, leaf), element: toElementInfo(node), fallbackPoint }
  }

  /** Mode A: a gesture captured from getevent. */
  onGesture(g: Gesture): Step | null {
    if (g.kind === 'key') {
      return this.push({ action: 'pressKey', params: { key: g.key } }, this.snapshotBefore(g.at))
    }
    const kind = classifyTouch(g, this.screen)
    const snap = this.snapshotBefore(g.downAt)
    if (kind.type === 'multiTouch') {
      this.lastMessage = 'Multi-finger gestures are not recorded yet'
      this.onChange()
      return null
    }
    if (kind.type === 'systemBack') return this.push({ action: 'pressKey', params: { key: 'back' } }, snap)
    if (kind.type === 'systemHome') return this.push({ action: 'pressKey', params: { key: 'home' } }, snap)

    const start = kind.type === 'swipe' ? kind.from : kind
    if (snap?.keyboard && contains(snap.keyboard, start.x, start.y)) return null // typing on the soft keyboard

    if (kind.type === 'tap' || kind.type === 'longPress') {
      const { target, warning } = this.targetFor(snap, kind.x, kind.y)
      return this.push(
        {
          action: kind.type,
          target,
          ...(kind.type === 'longPress' ? { params: { durationMs: kind.durationMs } } : {}),
          ...(warning ? { warning } : {})
        },
        snap
      )
    }
    return this.swipe(snap, kind.from, kind.to, kind.durationMs)
  }

  private swipe(
    snap: Snapshot | null,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number
  ): Step {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const fingerDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    const container = snap ? scrollableAt(snap.tree, from.x, from.y) : null
    const params = { from: this.pct(from.x, from.y), to: this.pct(to.x, to.y), durationMs, direction: fingerDir }
    if (container && snap) {
      // Finger up means content scrolls down.
      const scrollDir = { up: 'down', down: 'up', left: 'right', right: 'left' }[fingerDir]
      return this.push(
        { action: 'scroll', target: this.target(snap.tree, container, this.pct(from.x, from.y)), params: { ...params, scroll: scrollDir } },
        snap
      )
    }
    return this.push({ action: 'swipe', params }, snap)
  }

  /** Spec 4.4: one type step per field with the final text, coalesced across snapshots. */
  private detectTyping(s: Snapshot): void {
    const field = focusedEditText(s.tree)
    if (!field) {
      this.typing = null
      return
    }
    const key = field.resourceId || `${field.cls}@${field.bounds.join(',')}`
    if (!this.typing || this.typing.key !== key) {
      this.typing = { key, baseline: field.text, stepId: null }
      return
    }
    const t = this.typing
    const existing = t.stepId ? this.steps.find((st) => st.id === t.stepId) : undefined
    const isLast = existing && this.steps[this.steps.length - 1] === existing

    if (field.text === t.baseline) {
      if (existing && isLast) {
        this.steps.pop()
        this.artifacts.delete(existing.id)
        t.stepId = null
        this.onChange()
      }
      return
    }
    const params = field.password ? { text: '', masked: field.text.length } : { text: field.text }
    if (existing && isLast) {
      if (JSON.stringify(existing.params) === JSON.stringify(params)) return
      existing.params = params
      existing.target = this.target(s.tree, field, existing.target!.fallbackPoint)
      this.artifacts.set(existing.id, { xml: s.xml, png: s.png })
      this.onChange()
      return
    }
    const [l, top, r, b] = field.bounds
    const step = this.push(
      {
        action: 'type',
        target: this.target(s.tree, field, this.pct((l + r) / 2, (top + b) / 2)),
        params,
        ...(field.password ? { secret: true } : {})
      },
      s
    )
    // push() clears the typing link; re-attach it so later snapshots update this step.
    this.typing = { key, baseline: t.baseline, stepId: step.id }
  }

  // ---- Mode B and manual steps -------------------------------------------------------------

  /** Mode B: the user clicked or dragged on the mirror. Returns the step to perform. */
  mirrorGesture(snap: Snapshot | null, from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number): Step {
    const moved = Math.hypot(to.x - from.x, to.y - from.y)
    if (moved < 12) {
      const action = durationMs >= 500 ? 'longPress' : 'tap'
      const { target, warning } = this.targetFor(snap, from.x, from.y)
      return this.push({ action, target, ...(action === 'longPress' ? { params: { durationMs } } : {}), ...(warning ? { warning } : {}) }, snap)
    }
    return this.swipe(snap, from, to, Math.max(150, durationMs))
  }

  mirrorText(snap: Snapshot | null, text: string): Step {
    const field = snap ? focusedEditText(snap.tree) : null
    if (!field || !snap)
      return this.push({ action: 'type', params: { text }, warning: 'No focused text field found: types into whatever has focus' }, snap)
    const [l, t, r, b] = field.bounds
    return this.push(
      {
        action: 'type',
        target: this.target(snap.tree, field, this.pct((l + r) / 2, (t + b) / 2)),
        params: { text },
        ...(field.password ? { secret: true } : {})
      },
      snap
    )
  }

  pressKey(snap: Snapshot | null, key: string): Step {
    return this.push({ action: 'pressKey', params: { key } }, snap)
  }

  launchApp(appPackage: string, appActivity: string): Step {
    return this.push({ action: 'launchApp', params: { appPackage, appActivity } }, null)
  }

  addWait(ms: number): Step {
    return this.push({ action: 'wait', params: { ms } }, null)
  }

  addAssert(snap: Snapshot | null, x: number, y: number, kind: 'assertVisible' | 'assertText'): Step | null {
    if (!snap) return null
    const hit = elementAt(snap.tree, x, y)
    if (!hit) return null
    const node = kind === 'assertText' && hit.leaf.text ? hit.leaf : hit.target
    const info: ElementInfo = toElementInfo(node)
    return this.push(
      {
        action: kind,
        target: this.target(snap.tree, node, this.pct(x, y), hit.leaf),
        ...(kind === 'assertText' ? { params: { text: info.text } } : {})
      },
      snap
    )
  }

  deleteStep(id: string): void {
    const i = this.steps.findIndex((s) => s.id === id)
    if (i >= 0) {
      this.steps.splice(i, 1)
      this.artifacts.delete(id)
      if (this.typing?.stepId === id) this.typing.stepId = null
      this.onChange()
    }
  }

  elementAt(x: number, y: number): ElementInfo | null {
    const snap = this.latestSnapshot
    const hit = snap && elementAt(snap.tree, x, y)
    return hit ? toElementInfo(hit.target) : null
  }
}
