// Wires every InvokeApi channel to the backend services.

import { ipcMain, type WebContents } from 'electron'
import type { EventApi, InvokeApi } from '@shared/api'
import type { SetupCheck } from '@shared/types'
import type { Adb } from './adb/adb'
import type { AppiumManager } from './appium-manager'
import type { DeviceManager } from './device-manager'
import type { Mirror } from './mirror'
import type { RunService } from './player/runner'
import type { RecorderService } from './recorder/service'
import type { Store } from './store'

export interface Services {
  adb: Adb
  store: Store
  devices: DeviceManager
  appium: AppiumManager
  mirror: Mirror
  recorder: RecorderService
  runner: RunService
}

type Handlers = { [K in keyof InvokeApi]: (...args: Parameters<InvokeApi[K]>) => ReturnType<InvokeApi[K]> | Promise<ReturnType<InvokeApi[K]>> }

export async function setupCheck(svc: Services): Promise<SetupCheck> {
  const adb = await svc.adb
    .run(['version'])
    .then((out) => ({ ok: true, detail: String(out).split('\n')[0].trim() }))
    .catch(() => ({ ok: false, detail: `adb not found (${svc.adb.bin}). Install Android platform-tools or set ANDROID_HOME` }))
  const uiautomator2 = await svc.appium.driverInstalled()
  const appium = svc.appium.running
    ? { ok: true, detail: `Running on ${svc.appium.url!.host}` }
    : { ok: false, detail: svc.appium.lastError || 'Not running (optional: recording falls back to adb snapshots)' }
  return { adb, appium, uiautomator2 }
}

export function registerIpc(svc: Services, send: <K extends keyof EventApi>(ch: K, payload: EventApi[K]) => void): void {
  const { store, devices, appium, mirror, recorder, runner } = svc
  const h: Handlers = {
    'projects:list': () => store.listProjects(),
    'projects:create': (input) => store.createProject(input),
    'projects:update': (id, patch) => store.updateProject(id, patch),
    'projects:delete': (id) => store.deleteProject(id),

    'flows:list': (projectId) => store.listFlows(projectId),
    'flows:get': (projectId, flowId) => store.getFlow(projectId, flowId),
    'flows:delete': (projectId, flowId) => store.deleteFlow(projectId, flowId),

    'devices:list': () => devices.list(),
    'devices:setup': () => setupCheck(svc),
    'devices:pair': (hostPort, code) => devices.pair(hostPort, code),
    'devices:connect': (hostPort) => devices.connect(hostPort),
    'devices:apps': (serial) => devices.apps(serial),
    'devices:launch': async (serial, projectId) => {
      const p = store.getProject(projectId)
      await devices.shell(serial).launch(p.appPackage, p.appActivity)
    },

    'appium:start': async () => {
      await appium.start().catch(() => {})
      return setupCheck(svc)
    },

    'mirror:start': (serial) => mirror.start(devices.shell(serial)),
    'mirror:stop': () => {
      if (recorder.status().state !== 'recording' && runner.status()?.state !== 'running') mirror.stop()
    },
    'mirror:elementAt': (x, y) => recorder.elementAt(x, y),

    'recorder:start': (opts) => {
      if (runner.status()?.state === 'running') throw new Error('Wait for the current run to finish')
      return recorder.start(opts)
    },
    'recorder:stop': () => recorder.stop(),
    'recorder:status': () => recorder.status(),
    'recorder:deleteStep': (id) => recorder.deleteStep(id),
    'recorder:addWait': (ms) => recorder.addWait(ms),
    'recorder:mirrorGesture': (g) => recorder.mirrorGesture(g),
    'recorder:mirrorText': (text) => recorder.mirrorText(text),
    'recorder:mirrorKey': (key) => recorder.mirrorKey(key),
    'recorder:addAssert': (x, y, kind) => recorder.addAssert(x, y, kind),
    'recorder:save': (req) => recorder.save(req),
    'recorder:discard': () => recorder.discard(),

    'runs:start': (opts) => runner.start(opts),
    'runs:abort': () => runner.abort(),
    'runs:status': () => runner.status(),
    'runs:list': (projectId) => store.listRuns(projectId),
    'runs:get': (projectId, runId) => store.getRun(projectId, runId),
    'runs:image': (projectId, runId, file) => {
      const type = file.endsWith('.png') ? 'image/png' : 'text/xml'
      return `data:${type};base64,${store.readRunFile(projectId, runId, file).toString('base64')}`
    }
  }

  for (const [ch, fn] of Object.entries(h)) {
    ipcMain.handle(ch, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args))
  }

  devices.on('changed', (list) => send('devices:changed', list))
  recorder.on('status', (st) => send('recorder:status', st))
  mirror.on('frame', (f) => send('mirror:frame', f))
  runner.on('status', (b) => send('runs:status', b))
}

export function sender(getContents: () => WebContents | null) {
  return <K extends keyof EventApi>(ch: K, payload: EventApi[K]): void => {
    const wc = getContents()
    if (wc && !wc.isDestroyed()) wc.send(ch, payload)
  }
}
