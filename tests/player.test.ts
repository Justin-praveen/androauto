import { describe, expect, it } from 'vitest'
import { DeviceShell, type AdbRunner } from '../src/main/adb/adb'
import { findAll, locate, parseUiSelector } from '../src/main/hierarchy/locate'
import type { HierarchySource } from '../src/main/hierarchy/source'
import { parseHierarchy } from '../src/main/hierarchy/tree'
import { FlowPlayer, resolveText } from '../src/main/player/player'
import type { Flow, Run, Step } from '../src/shared/types'
import { fixture } from './helpers'

const loginXml = fixture('login-dump.xml')
const tree = parseHierarchy(loginXml)

describe('locate', () => {
  it('finds by id, accessibility id, UiSelector and XPath', () => {
    expect(findAll(tree, { strategy: 'id', value: 'com.example.shop:id/login_btn' })[0].cls).toBe('android.widget.Button')
    expect(findAll(tree, { strategy: 'id', value: 'login_btn' })).toHaveLength(1)
    expect(findAll(tree, { strategy: 'accessibility id', value: 'Log in' })).toHaveLength(1)
    expect(findAll(tree, { strategy: 'uiautomator', value: 'new UiSelector().text("Shirts")' })[0].text).toBe('Shirts')
    expect(findAll(tree, { strategy: 'uiautomator', value: 'new UiSelector().resourceId("com.example.shop:id/row").instance(1)' })[0].bounds).toEqual([0, 1200, 1080, 1400])
    expect(findAll(tree, { strategy: 'xpath', value: "//android.widget.Button[@resource-id='com.example.shop:id/login_btn']" })).toHaveLength(1)
    expect(findAll(tree, { strategy: 'xpath', value: "//android.widget.LinearLayout[@resource-id='com.example.shop:id/row'][.//*[@text='Shirts']]" })[0].bounds).toEqual([0, 1200, 1080, 1400])
    expect(findAll(tree, { strategy: 'xpath', value: "(//android.widget.LinearLayout[@resource-id='com.example.shop:id/row'])[2]" })[0].bounds).toEqual([0, 1200, 1080, 1400])
  })

  it('works on Appium page source too', () => {
    const t = parseHierarchy(fixture('appium-source.xml'))
    expect(findAll(t, { strategy: 'xpath', value: "//android.widget.Button[@text='Sign in']" })).toHaveLength(1)
  })

  it('tries locators in order and skips broken ones', () => {
    const hit = locate(tree, [
      { strategy: 'id', value: 'com.example.shop:id/gone' },
      { strategy: 'uiautomator', value: 'new UiSelector().bogus(1)' },
      { strategy: 'xpath', value: '//[' },
      { strategy: 'accessibility id', value: 'Log in' }
    ])
    expect(hit?.locator.strategy).toBe('accessibility id')
    expect(parseUiSelector('new UiSelector().className("a.B").text("say \\"hi\\"").instance(2)')).toEqual([
      { method: 'className', arg: 'a.B' },
      { method: 'text', arg: 'say "hi"' },
      { method: 'instance', arg: 2 }
    ])
  })
})

// ---- player against a scripted phone --------------------------------------------------------

class FakePhone implements AdbRunner {
  calls: string[] = []
  run(args: string[]): Promise<string | Buffer> {
    const cmd = args.slice(2).join(' ')
    this.calls.push(cmd)
    if (cmd === 'exec-out screencap -p') return Promise.resolve(Buffer.from('png'))
    return Promise.resolve('')
  }
  stream(): never {
    throw new Error('no stream')
  }
}

function setup(screens: (() => string) | string[], opts = {}) {
  const phone = new FakePhone()
  const sh = new DeviceShell(phone, 'R5CT1234')
  let i = 0
  const source: HierarchySource = {
    name: 'adb',
    dump: async () => (typeof screens === 'function' ? screens() : screens[Math.min(i++, screens.length - 1)]),
    close: async () => {}
  }
  let clock = 0
  const files = new Map<string, Buffer | string>()
  const player = new FlowPlayer(
    {
      sh,
      source,
      screen: { w: 1080, h: 2400, density: 420 },
      secret: (k) => (k === 'shop_app_password' ? 'hunter2' : undefined),
      writeFile: (n, d) => files.set(n, d),
      onProgress: () => {},
      aborted: () => false,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      }
    },
    opts
  )
  return { phone, player, files }
}

const s = (id: string, action: Step['action'], extra: Partial<Step> = {}): Step => ({ id, action, waitBeforeMs: 0, timeoutMs: 10000, ...extra })
const tgt = (locators: Step['target'] extends infer T ? (T extends { locators: infer L } ? L : never) : never, xPct = 0.5, yPct = 0.5) => ({
  locators,
  element: null,
  fallbackPoint: { xPct, yPct }
})

function flowOf(steps: Step[]): Flow {
  return {
    id: 'flw_1', projectId: 'prj_1', name: 'Login', description: '', tags: [], version: 1, recordedOn: null,
    startState: { launchApp: true, clearData: false },
    variables: { username: 'demo@example.com', password: '${secret:shop_app_password}' },
    steps, createdAt: '', updatedAt: ''
  }
}
const newRun = (): Run => ({ id: 'run_1', projectId: 'prj_1', flowId: 'flw_1', flowName: 'Login', flowVersion: 1, device: 'R5CT1234', deviceModel: 'Pixel 7', status: 'queued', startedAt: '', durationMs: 0, steps: [] })

describe('FlowPlayer', () => {
  it('runs a login flow and passes', async () => {
    const { phone, player, files } = setup([loginXml])
    const flow = flowOf([
      s('stp_01', 'launchApp', { params: { appPackage: 'com.example.shop', appActivity: '.MainActivity' } }),
      s('stp_02', 'type', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/email' }]), params: { text: '${username}' } }),
      s('stp_03', 'type', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/password' }]), params: { text: '${password}' }, secret: true }),
      s('stp_04', 'tap', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/login_btn' }]) }),
      s('stp_05', 'scroll', { params: { from: { xPct: 0.5, yPct: 0.7 }, to: { xPct: 0.5, yPct: 0.4 }, durationMs: 300 } }),
      s('stp_06', 'pressKey', { params: { key: 'back' } }),
      s('stp_07', 'assertText', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/title' }]), params: { text: 'Welcome back' } })
    ])
    const run = await player.run(flow, newRun())
    expect(run.status).toBe('passed')
    expect(run.steps.map((r) => r.status)).toEqual(Array(7).fill('passed'))
    expect(run.steps[3].locatorUsed).toBe('id')
    expect(phone.calls).toEqual(
      expect.arrayContaining([
        'shell am force-stop com.example.shop',
        'shell am start -W -n com.example.shop/.MainActivity',
        'shell input tap 540 672',
        'shell input keyevent 123 67 67 67 67 67',
        'shell input text demo@example.com',
        'shell input text hunter2',
        'shell input tap 540 1892',
        'shell input swipe 540 1680 540 960 300',
        'shell input keyevent 4'
      ])
    )
    expect(files.has('stp_04.png')).toBe(true)
  })

  it('waits for an element to appear', async () => {
    const empty = loginXml.replace(/com\.example\.shop:id\/login_btn/g, 'x')
    const { player } = setup([empty, empty, loginXml])
    const run = await player.run(flowOf([s('stp_01', 'tap', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/login_btn' }]) })]), newRun())
    expect(run.status).toBe('passed')
  })

  it('falls back to the recorded point with a warning', async () => {
    const { phone, player } = setup([loginXml])
    const run = await player.run(flowOf([s('stp_01', 'tap', { timeoutMs: 1000, target: tgt([{ strategy: 'id', value: 'nope' }], 0.25, 0.5) })]), newRun())
    expect(run.status).toBe('passed')
    expect(run.steps[0]).toMatchObject({ status: 'warning', locatorUsed: 'coordinates' })
    expect(phone.calls).toContain('shell input tap 270 1200')
  })

  it('fails an assert, saves the screen, and skips the rest', async () => {
    const { player, files } = setup([loginXml])
    const run = await player.run(
      flowOf([
        s('stp_01', 'assertText', { timeoutMs: 2000, target: tgt([{ strategy: 'id', value: 'com.example.shop:id/title' }]), params: { text: 'Hello' } }),
        s('stp_02', 'tap', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/login_btn' }]) })
      ]),
      newRun()
    )
    expect(run.status).toBe('failed')
    expect(run.steps[0]).toMatchObject({ status: 'failed', error: 'Expected text "Hello" but found "Welcome back"', hierarchy: 'stp_01.xml' })
    expect(run.steps[1].status).toBe('skipped')
    expect(run.error).toMatch(/Expected text/)
    expect(files.get('stp_01.xml')).toBe(loginXml)
  })

  it('continues after a failure when asked', async () => {
    const { player } = setup([loginXml], { continueOnFailure: true })
    const run = await player.run(
      flowOf([
        s('stp_01', 'assertVisible', { timeoutMs: 500, target: tgt([{ strategy: 'id', value: 'nope' }]) }),
        s('stp_02', 'tap', { target: tgt([{ strategy: 'id', value: 'com.example.shop:id/login_btn' }]) })
      ]),
      newRun()
    )
    expect(run.status).toBe('failed')
    expect(run.steps.map((r) => r.status)).toEqual(['failed', 'passed'])
  })

  it('resolves variables and reports missing ones', () => {
    const flow = flowOf([])
    expect(resolveText('${username} / ${password}', flow, () => 'pw')).toBe('demo@example.com / pw')
    expect(() => resolveText('${nope}', flow, () => undefined)).toThrow(/not defined/)
    expect(() => resolveText('${password}', flow, () => undefined)).toThrow(/not stored/)
  })
})
