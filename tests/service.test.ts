// End-to-end recorder test against a fake adb: devices, getevent stream, hierarchy dumps, save.
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AdbRunner } from '../src/main/adb/adb'
import { AppiumManager } from '../src/main/appium-manager'
import { DeviceManager } from '../src/main/device-manager'
import { Mirror } from '../src/main/mirror'
import { RecorderService } from '../src/main/recorder/service'
import { RunService } from '../src/main/player/runner'
import { Store } from '../src/main/store'
import type { RecorderStatus } from '../src/shared/types'
import { fixture, touchLines } from './helpers'

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000043800000960080600000000', 'hex')

class FakeAdb implements AdbRunner {
  calls: string[] = []
  screen = fixture('login-dump.xml')
  stdout = new PassThrough()

  async run(args: string[]): Promise<string | Buffer> {
    const cmd = args.join(' ')
    this.calls.push(cmd)
    if (cmd === 'devices -l') return 'List of devices attached\nR5CT1234 device usb:1-1 model:Pixel_7\n'
    const sh = cmd.replace(/^-s R5CT1234 (shell|exec-out) /, '')
    if (sh.startsWith('getprop')) return 'Pixel 7\n14\n34\n'
    if (sh === 'wm size') return 'Physical size: 1080x2400\n'
    if (sh === 'wm density') return 'Physical density: 420\n'
    if (sh === 'getevent -pl') return fixture('getevent-p.txt')
    if (sh.startsWith('uiautomator dump')) return Buffer.from(this.screen + 'UI hierchary dumped to: /dev/tty\n')
    if (sh === 'screencap -p') return PNG
    if (sh.startsWith('am start')) return 'Status: ok\n'
    if (sh.startsWith('am force-stop') || sh.startsWith('pm clear')) return ''
    if (sh.startsWith('dumpsys')) return ''
    if (sh.startsWith('input ')) return ''
    throw new Error(`unexpected adb ${cmd}`)
  }

  stream(): ChildProcess {
    const proc = new EventEmitter() as ChildProcess
    Object.assign(proc, { stdout: this.stdout, kill: () => true })
    return proc
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await wait(20)
  }
}

function setup() {
  const adb = new FakeAdb()
  const store = new Store(mkdtempSync(join(tmpdir(), 'androauto-svc-')))
  const devices = new DeviceManager(adb)
  const mirror = new Mirror()
  const recorder = new RecorderService(devices, new AppiumManager('/nonexistent'), mirror, store)
  const project = store.createProject({ name: 'Shop App', appPackage: 'com.example.shop', appActivity: '.MainActivity' })
  const statuses: RecorderStatus[] = []
  recorder.on('status', (s) => statuses.push(s))
  return { adb, store, devices, mirror, recorder, project, statuses }
}

describe('RecorderService with a fake phone', () => {
  it('detects the device with its screen details', async () => {
    const { devices } = setup()
    expect(await devices.refresh()).toEqual([
      { serial: 'R5CT1234', state: 'device', model: 'Pixel 7', android: '14', sdk: 34, screen: { w: 1080, h: 2400, density: 420 }, connection: 'usb' }
    ])
  })

  it('records on the phone: launch, tap from getevent, then saves the flow', async () => {
    const { adb, store, devices, mirror, recorder, project } = setup()
    await devices.refresh()
    const st = await recorder.start({ serial: 'R5CT1234', projectId: project.id, mode: 'phone', launchApp: true })
    expect(st).toMatchObject({ state: 'recording', hierarchySource: 'adb' })
    expect(adb.calls).toContain('-s R5CT1234 shell am start -W -n com.example.shop/.MainActivity')

    await until(() => adb.calls.filter((c) => c.includes('uiautomator dump')).length >= 2 && !!mirror.latest)
    await wait(50)
    for (const l of touchLines([{ x: 540, y: 1892 }], 5, 30)) adb.stdout.write(l + '\n')
    await until(() => recorder.status().steps.length === 2)

    const stopped = await recorder.stop()
    expect(stopped.state).toBe('review')
    expect(stopped.steps.map((s) => s.action)).toEqual(['launchApp', 'tap'])
    expect(stopped.steps[1].target!.element!.text).toBe('Log in')

    const flow = recorder.save({ name: 'Login', description: '', tags: ['smoke'], variables: {}, secretValues: {} })
    expect(recorder.status().state).toBe('idle')
    const dir = join(store.root, 'projects', project.id, 'flows')
    expect(JSON.parse(readFileSync(join(dir, 'login.json'), 'utf8')).id).toBe(flow.id)
    expect(readFileSync(join(dir, 'login/snapshots/stp_02.png')).subarray(0, 4)).toEqual(PNG.subarray(0, 4))
    mirror.stop()
  })

  it('records in the mirror: performs the tap on the phone and records the element', async () => {
    const { adb, devices, mirror, recorder, project } = setup()
    await devices.refresh()
    await recorder.start({ serial: 'R5CT1234', projectId: project.id, mode: 'mirror', launchApp: false })
    expect(adb.calls).not.toContain('-s R5CT1234 shell getevent -pl')
    const st = await recorder.mirrorGesture({ from: { x: 540, y: 1892 }, to: { x: 540, y: 1892 }, durationMs: 60 })
    expect(st.steps[0].action).toBe('tap')
    expect(st.steps[0].target!.locators[0]).toEqual({ strategy: 'id', value: 'com.example.shop:id/login_btn' })
    expect(adb.calls).toContain('-s R5CT1234 shell input tap 540 1892')
    await recorder.mirrorKey('back')
    expect(adb.calls).toContain('-s R5CT1234 shell input keyevent 4')
    expect(recorder.elementAt(300, 1300)?.text).toBe('Shirts')
    await recorder.discard()
    expect(recorder.status()).toMatchObject({ state: 'idle', steps: [] })
    mirror.stop()
  })

  it('runs saved flows one after another and reports pass and fail', async () => {
    const { adb, store, devices, mirror, recorder, project } = setup()
    await devices.refresh()
    await recorder.start({ serial: 'R5CT1234', projectId: project.id, mode: 'mirror', launchApp: true })
    await recorder.mirrorGesture({ from: { x: 540, y: 1892 }, to: { x: 540, y: 1892 }, durationMs: 60 })
    await recorder.addAssert(500, 360, 'assertText')
    await recorder.stop()
    const good = recorder.save({ name: 'Login', description: '', tags: [], variables: {}, secretValues: {} })
    mirror.stop()

    // A second flow whose check no longer matches the screen.
    const bad = store.createFlow(
      { ...good, name: 'Broken', steps: good.steps.map((st) => (st.action === 'assertText' ? { ...st, timeoutMs: 300, params: { text: 'Goodbye' } } : st)) },
      new Map()
    )

    const runner = new RunService(devices, new AppiumManager('/nonexistent'), recorder, store, { settleMs: 0, pollMs: 50 })
    const batch = runner.start({ projectId: project.id, flowIds: [good.id, bad.id], serial: 'R5CT1234' })
    expect(batch.runs.map((r) => r.status)).toEqual(['queued', 'queued'])
    await until(() => runner.status()!.state === 'done', 5000)
    const done = runner.status()!
    expect(done.runs.map((r) => r.status)).toEqual(['passed', 'failed'])
    expect(done.runs[1].error).toBe('Expected text "Goodbye" but found "Welcome back"')
    expect(adb.calls.filter((c) => c === '-s R5CT1234 shell input tap 540 1892')).toHaveLength(3)

    const runs = store.listRuns(project.id)
    expect(runs).toHaveLength(2)
    expect(store.getRun(project.id, done.runs[0].id).steps.map((st) => st.status)).toEqual(['passed', 'passed', 'passed'])
    expect(store.readRunFile(project.id, done.runs[0].id, 'stp_02.png').subarray(0, 4)).toEqual(PNG.subarray(0, 4))
    expect(store.listFlows(project.id).find((f) => f.id === bad.id)!.lastRun).toMatchObject({ status: 'failed', failedStep: 3 })
    expect(() => runner.start({ projectId: project.id, flowIds: [], serial: 'R5CT1234' })).toThrow(/at least one/)
  })

  it('refuses to start without a connected device', async () => {
    const { recorder, project } = setup()
    await expect(recorder.start({ serial: 'nope', projectId: project.id, mode: 'phone', launchApp: false })).rejects.toThrow(/not connected/)
  })
})
