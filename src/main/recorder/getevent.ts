// Turns `adb shell getevent -lt` output into touch gestures and key presses
// (spec section 4, steps 1 and 2).

import type { TouchInputDevice } from '../adb/parsers'

export interface RawEvent {
  /** Kernel timestamp in ms (monotonic, used for durations). */
  t: number
  /** Host wall-clock ms when the line arrived (used to match snapshots). */
  host: number
  device: string
  type: string
  code: string
  value: string
}

const LINE = /^\[\s*(\d+\.\d+)\]\s+(\S+):\s+(\S+)\s+(\S+)\s+(\S+)\s*$/

export function parseGeteventLine(line: string, host: number): RawEvent | null {
  const m = line.trim().match(LINE)
  if (!m) return null
  return { t: Number(m[1]) * 1000, host, device: m[2], type: m[3], code: m[4], value: m[5] }
}

/** getevent prints ABS values as 8-digit hex; tracking id release is ffffffff. */
export function hexValue(v: string): number {
  const n = parseInt(v, 16)
  return n > 0x7fffffff ? n - 0x100000000 : n
}

export interface Point {
  x: number
  y: number
  t: number
}

export interface TouchGesture {
  kind: 'touch'
  fingers: number
  path: Point[]
  downAt: number
  upAt: number
  durationMs: number
}

export interface KeyGesture {
  kind: 'key'
  key: 'back' | 'home' | 'recents'
  at: number
}

export type Gesture = TouchGesture | KeyGesture

const KEYS: Record<string, KeyGesture['key']> = {
  KEY_BACK: 'back',
  KEY_HOME: 'home',
  KEY_HOMEPAGE: 'home',
  KEY_APPSELECT: 'recents'
}

interface Slot {
  id: number
  x: number | null
  y: number | null
}

/**
 * Multi-touch protocol B state machine (slots + tracking ids), with BTN_TOUCH and
 * single-touch ABS_X/ABS_Y fallbacks for older drivers.
 */
export class TouchTracker {
  private slots = new Map<number, Slot>()
  private slot = 0
  private btnSeen = false
  private btnDown = false
  private maxFingers = 0
  private path: Point[] = []
  private downAt = 0
  private active = false

  constructor(
    private readonly input: TouchInputDevice,
    private readonly screen: { w: number; h: number },
    private readonly emit: (g: Gesture) => void
  ) {}

  feed(e: RawEvent): void {
    if (e.type === 'EV_KEY' && KEYS[e.code]) {
      if (e.value === 'UP') this.emit({ kind: 'key', key: KEYS[e.code], at: e.host })
      return
    }
    if (e.device !== this.input.path) return

    if (e.type === 'EV_ABS') {
      const v = hexValue(e.value)
      switch (e.code) {
        case 'ABS_MT_SLOT':
          this.slot = v
          break
        case 'ABS_MT_TRACKING_ID':
          if (v < 0) this.slots.delete(this.slot)
          else this.slots.set(this.slot, { id: v, x: this.cur()?.x ?? null, y: this.cur()?.y ?? null })
          break
        case 'ABS_MT_POSITION_X':
        case 'ABS_X':
          this.ensure().x = v
          break
        case 'ABS_MT_POSITION_Y':
        case 'ABS_Y':
          this.ensure().y = v
          break
      }
    } else if (e.type === 'EV_KEY' && e.code === 'BTN_TOUCH') {
      this.btnSeen = true
      this.btnDown = e.value === 'DOWN'
      if (!this.btnDown) this.slots.clear()
    } else if (e.type === 'EV_SYN' && e.code === 'SYN_REPORT') {
      this.sync(e)
    }
  }

  private cur(): Slot | undefined {
    return this.slots.get(this.slot)
  }

  private ensure(): Slot {
    let s = this.slots.get(this.slot)
    if (!s) {
      // Drivers without tracking ids still report positions; treat them as one finger.
      s = { id: 0, x: null, y: null }
      this.slots.set(this.slot, s)
    }
    return s
  }

  private sync(e: RawEvent): void {
    const fingers = [...this.slots.values()].filter((s) => s.id >= 0)
    const down = this.btnSeen ? this.btnDown || fingers.length > 0 : fingers.length > 0
    if (down) {
      if (!this.active) {
        this.active = true
        this.path = []
        this.maxFingers = 0
        this.downAt = e.host
      }
      this.maxFingers = Math.max(this.maxFingers, fingers.length)
      const primary = fingers[0]
      if (primary && primary.x !== null && primary.y !== null) {
        const p = this.toScreen(primary.x, primary.y, e.t)
        const last = this.path[this.path.length - 1]
        if (!last || last.x !== p.x || last.y !== p.y) this.path.push(p)
      }
    } else if (this.active) {
      this.active = false
      if (this.path.length) {
        const durationMs = Math.max(0, e.t - this.path[0].t)
        this.emit({
          kind: 'touch',
          fingers: Math.max(1, this.maxFingers),
          path: this.path,
          downAt: this.downAt,
          upAt: e.host,
          durationMs
        })
      }
      this.slots.clear()
    }
  }

  private toScreen(rx: number, ry: number, t: number): Point {
    const { x, y } = this.input
    const sx = ((rx - x.min) * this.screen.w) / (x.max - x.min + 1)
    const sy = ((ry - y.min) * this.screen.h) / (y.max - y.min + 1)
    return { x: Math.round(sx), y: Math.round(sy), t }
  }
}

export type GestureKind =
  | { type: 'tap'; x: number; y: number }
  | { type: 'longPress'; x: number; y: number; durationMs: number }
  | { type: 'swipe'; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'systemBack' }
  | { type: 'systemHome' }
  | { type: 'multiTouch' }

export const LONG_PRESS_MS = 500

/** Classifies a touch (spec section 4, step 2). density is the screen dpi. */
export function classifyTouch(g: TouchGesture, screen: { w: number; h: number; density: number }): GestureKind {
  if (g.fingers > 1) return { type: 'multiTouch' }
  const start = g.path[0]
  const end = g.path[g.path.length - 1]
  const slop = Math.max(10, Math.round(((screen.density || 160) / 160) * 8))
  const maxMove = Math.max(...g.path.map((p) => Math.hypot(p.x - start.x, p.y - start.y)))
  if (maxMove <= slop) {
    return g.durationMs >= LONG_PRESS_MS
      ? { type: 'longPress', x: start.x, y: start.y, durationMs: g.durationMs }
      : { type: 'tap', x: start.x, y: start.y }
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const horizontal = Math.abs(dx) > Math.abs(dy)
  const direction = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'

  // Gesture navigation: edge swipes are system back, a swipe up from the bottom edge is home.
  const edge = Math.round(screen.w * 0.04)
  if (horizontal && (start.x <= edge || start.x >= screen.w - edge)) return { type: 'systemBack' }
  if (!horizontal && direction === 'up' && start.y >= screen.h - Math.round(screen.h * 0.025)) return { type: 'systemHome' }

  return {
    type: 'swipe',
    from: { x: start.x, y: start.y },
    to: { x: end.x, y: end.y },
    durationMs: Math.max(50, Math.round(g.durationMs)),
    direction
  }
}
