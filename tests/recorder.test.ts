import { describe, expect, it } from 'vitest'
import { parseTouchDevice } from '../src/main/adb/parsers'
import { parseHierarchy } from '../src/main/hierarchy/tree'
import { RecorderEngine, type Snapshot } from '../src/main/recorder/engine'
import { classifyTouch, parseGeteventLine, TouchTracker, type Gesture, type TouchGesture } from '../src/main/recorder/getevent'
import { fixture, touchLines } from './helpers'

const screen = { w: 1080, h: 2400, density: 420 }
const input = parseTouchDevice(fixture('getevent-p.txt'))!
const loginXml = fixture('login-dump.xml')

function gestures(lines: string[], host = 1000): Gesture[] {
  const out: Gesture[] = []
  const tracker = new TouchTracker(input, screen, (g) => out.push(g))
  lines.forEach((l, i) => {
    const e = parseGeteventLine(l, host + i)
    if (e) tracker.feed(e)
  })
  return out
}

function snap(xml: string, takenAt: number, extra: Partial<Snapshot> = {}): Snapshot {
  return { tree: parseHierarchy(xml), xml, takenAt, ...extra }
}

/** The login screen with the email field focused and showing `text`. */
function withEmail(text: string, focused = true): string {
  return loginXml.replace(
    'text="Email" resource-id="com.example.shop:id/email" class="android.widget.EditText" package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false"',
    `text="${text}" resource-id="com.example.shop:id/email" class="android.widget.EditText" package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="${focused}"`
  )
}

function withPassword(text: string): string {
  return loginXml.replace(
    'text="Password" resource-id="com.example.shop:id/password" class="android.widget.EditText" package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false"',
    `text="${text}" resource-id="com.example.shop:id/password" class="android.widget.EditText" package="com.example.shop" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="true"`
  )
}

describe('getevent', () => {
  it('parses lines and scales raw coordinates to pixels', () => {
    const g = gestures(touchLines([{ x: 540, y: 1892 }], 100, 16))
    expect(g).toHaveLength(1)
    const t = g[0] as TouchGesture
    expect(t.fingers).toBe(1)
    expect(t.path[0]).toMatchObject({ x: 540, y: 1892 })
    expect(classifyTouch(t, screen)).toEqual({ type: 'tap', x: 540, y: 1892 })
  })

  it('classifies long press, swipes and nav gestures', () => {
    const hold = gestures(touchLines([{ x: 500, y: 500 }, { x: 502, y: 501 }], 100, 700))[0] as TouchGesture
    expect(classifyTouch(hold, screen)).toMatchObject({ type: 'longPress', x: 500, y: 500 })

    const up = gestures(touchLines([{ x: 540, y: 1700 }, { x: 540, y: 1400 }, { x: 540, y: 1100 }], 100, 50))[0] as TouchGesture
    expect(classifyTouch(up, screen)).toMatchObject({ type: 'swipe', direction: 'up', from: { x: 540, y: 1700 }, to: { x: 540, y: 1100 } })

    const back = gestures(touchLines([{ x: 5, y: 1200 }, { x: 200, y: 1210 }], 100, 50))[0] as TouchGesture
    expect(classifyTouch(back, screen)).toEqual({ type: 'systemBack' })

    const home = gestures(touchLines([{ x: 540, y: 2395 }, { x: 540, y: 1800 }], 100, 50))[0] as TouchGesture
    expect(classifyTouch(home, screen)).toEqual({ type: 'systemHome' })
  })

  it('reports hardware keys on release', () => {
    const g = gestures([
      '[  10.000000] /dev/input/event4: EV_KEY       KEY_BACK             DOWN',
      '[  10.080000] /dev/input/event4: EV_KEY       KEY_BACK             UP',
      '[  11.000000] /dev/input/event4: EV_KEY       KEY_VOLUMEUP         UP'
    ])
    expect(g).toEqual([{ kind: 'key', key: 'back', at: 1001 }])
  })

  it('tracks two fingers as one multi-touch gesture', () => {
    const d = '/dev/input/event2'
    const g = gestures([
      `[ 1.000] ${d}: EV_ABS ABS_MT_SLOT 00000000`,
      `[ 1.000] ${d}: EV_ABS ABS_MT_TRACKING_ID 00000005`,
      `[ 1.000] ${d}: EV_ABS ABS_MT_POSITION_X 00000400`,
      `[ 1.000] ${d}: EV_ABS ABS_MT_POSITION_Y 00000400`,
      `[ 1.000] ${d}: EV_SYN SYN_REPORT 00000000`,
      `[ 1.010] ${d}: EV_ABS ABS_MT_SLOT 00000001`,
      `[ 1.010] ${d}: EV_ABS ABS_MT_TRACKING_ID 00000006`,
      `[ 1.010] ${d}: EV_ABS ABS_MT_POSITION_X 00000800`,
      `[ 1.010] ${d}: EV_ABS ABS_MT_POSITION_Y 00000800`,
      `[ 1.010] ${d}: EV_SYN SYN_REPORT 00000000`,
      `[ 1.200] ${d}: EV_ABS ABS_MT_TRACKING_ID ffffffff`,
      `[ 1.200] ${d}: EV_ABS ABS_MT_SLOT 00000000`,
      `[ 1.200] ${d}: EV_ABS ABS_MT_TRACKING_ID ffffffff`,
      `[ 1.200] ${d}: EV_SYN SYN_REPORT 00000000`
    ])
    expect(g).toHaveLength(1)
    expect((g[0] as TouchGesture).fingers).toBe(2)
  })
})

describe('RecorderEngine (record on phone)', () => {
  function engineWithGestures(snapshots: Snapshot[], lines: string[], host: number): RecorderEngine {
    const engine = new RecorderEngine(screen, { detectTyping: true })
    snapshots.forEach((s) => engine.addSnapshot(s))
    gestures(lines, host).forEach((g) => engine.onGesture(g))
    return engine
  }

  it('records a tap with element locators from the pre-touch snapshot', () => {
    const engine = engineWithGestures([snap(loginXml, 900)], touchLines([{ x: 540, y: 1892 }], 5, 30), 1000)
    expect(engine.steps).toHaveLength(1)
    const step = engine.steps[0]
    expect(step).toMatchObject({ id: 'stp_01', action: 'tap', timeoutMs: 10000, snapshot: 'snapshots/stp_01' })
    expect(step.target!.locators[0]).toEqual({ strategy: 'id', value: 'com.example.shop:id/login_btn' })
    expect(step.target!.element!.text).toBe('Log in')
    expect(step.target!.fallbackPoint).toEqual({ xPct: 0.5, yPct: 0.7883 })
    expect(engine.artifacts.get('stp_01')!.xml).toBe(loginXml)
  })

  it('ignores snapshots taken after the touch began', () => {
    const later = snap(loginXml.replace(/Log in/g, 'Next screen'), 1500)
    const engine = engineWithGestures([snap(loginXml, 900), later], touchLines([{ x: 540, y: 1892 }], 5, 30), 1000)
    expect(engine.steps[0].target!.element!.text).toBe('Log in')
  })

  it('falls back to coordinates with a warning when there is no snapshot', () => {
    const engine = engineWithGestures([], touchLines([{ x: 540, y: 1892 }], 5, 30), 1000)
    expect(engine.steps[0].target!.locators).toEqual([])
    expect(engine.steps[0].warning).toMatch(/coordinates/)
  })

  it('records a swipe on a list as a scroll of that list', () => {
    const lines = touchLines([{ x: 540, y: 1700 }, { x: 540, y: 1400 }, { x: 540, y: 1100 }], 5, 50)
    const engine = engineWithGestures([snap(loginXml, 900)], lines, 1000)
    expect(engine.steps[0]).toMatchObject({
      action: 'scroll',
      params: { direction: 'up', scroll: 'down', from: { xPct: 0.5, yPct: 0.7083 }, to: { xPct: 0.5, yPct: 0.4583 } }
    })
    expect(engine.steps[0].target!.locators[0]).toEqual({ strategy: 'id', value: 'com.example.shop:id/list' })
  })

  it('ignores taps on the soft keyboard', () => {
    const kb = snap(withEmail('Email'), 900, { keyboard: [0, 1540, 1080, 2400] })
    const engine = engineWithGestures([kb], touchLines([{ x: 300, y: 2000 }], 5, 30), 1000)
    expect(engine.steps).toEqual([])
  })

  it('turns text changes into one type step with the final value', () => {
    const engine = new RecorderEngine(screen, { detectTyping: true })
    engine.addSnapshot(snap(withEmail('Email'), 100)) // focused, hint shown
    engine.addSnapshot(snap(withEmail('dem'), 200))
    engine.addSnapshot(snap(withEmail('demo@example.com'), 300))
    expect(engine.steps).toHaveLength(1)
    expect(engine.steps[0]).toMatchObject({ action: 'type', params: { text: 'demo@example.com' } })
    expect(engine.steps[0].target!.locators[0]).toEqual({ strategy: 'id', value: 'com.example.shop:id/email' })
    engine.addSnapshot(snap(withEmail('demo@example.com', false), 400)) // focus left the field
    expect(engine.steps).toHaveLength(1)
  })

  it('drops the type step when the field is cleared back to where it started', () => {
    const engine = new RecorderEngine(screen, { detectTyping: true })
    engine.addSnapshot(snap(withEmail('Email'), 100))
    engine.addSnapshot(snap(withEmail('x'), 200))
    engine.addSnapshot(snap(withEmail('Email'), 300))
    expect(engine.steps).toEqual([])
  })

  it('flags password fields as secret with an unknown value', () => {
    const engine = new RecorderEngine(screen, { detectTyping: true })
    engine.addSnapshot(snap(withPassword('Password'), 100))
    engine.addSnapshot(snap(withPassword('••••••'), 200))
    expect(engine.steps[0]).toMatchObject({ action: 'type', secret: true, params: { text: '', masked: 6 } })
  })

  it('records the sequence tap field, type, tap button', () => {
    const engine = new RecorderEngine(screen, { detectTyping: true })
    engine.addSnapshot(snap(loginXml, 900))
    gestures(touchLines([{ x: 540, y: 670 }], 5, 30), 1000).forEach((g) => engine.onGesture(g))
    engine.addSnapshot(snap(withEmail('Email'), 1200))
    engine.addSnapshot(snap(withEmail('demo@example.com'), 1500))
    engine.addSnapshot(snap(withEmail('demo@example.com'), 1800))
    gestures(touchLines([{ x: 540, y: 1892 }], 9, 30), 2000).forEach((g) => engine.onGesture(g))
    expect(engine.steps.map((s) => s.action)).toEqual(['tap', 'type', 'tap'])
    expect(engine.steps.map((s) => s.id)).toEqual(['stp_01', 'stp_02', 'stp_03'])
  })
})

describe('RecorderEngine (record in mirror and manual steps)', () => {
  it('maps a mirror click to the element and a drag to a swipe', () => {
    const engine = new RecorderEngine(screen, { detectTyping: false })
    const s = snap(loginXml, 100)
    expect(engine.mirrorGesture(s, { x: 540, y: 1892 }, { x: 540, y: 1892 }, 80).action).toBe('tap')
    expect(engine.mirrorGesture(s, { x: 540, y: 380 }, { x: 900, y: 380 }, 300)).toMatchObject({ action: 'swipe', params: { direction: 'right' } })
  })

  it('types into the focused field, adds asserts, waits, keys and deletes', () => {
    const engine = new RecorderEngine(screen, { detectTyping: false })
    const s = snap(withEmail('Email'), 100)
    engine.launchApp('com.example.shop', '.MainActivity')
    expect(engine.mirrorText(s, 'hello')).toMatchObject({ action: 'type', params: { text: 'hello' } })
    expect(engine.addAssert(s, 500, 360, 'assertText')).toMatchObject({ action: 'assertText', params: { text: 'Welcome back' } })
    engine.addWait(1500)
    engine.pressKey(s, 'back')
    expect(engine.steps.map((x) => x.action)).toEqual(['launchApp', 'type', 'assertText', 'wait', 'pressKey'])
    engine.deleteStep('stp_03')
    expect(engine.steps.map((x) => x.id)).toEqual(['stp_01', 'stp_02', 'stp_04', 'stp_05'])
  })
})
