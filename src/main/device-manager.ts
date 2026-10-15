// Watches `adb devices`, reads device details, pairs over Wi-Fi, lists apps and launches them.

import { EventEmitter } from 'node:events'
import type { Device, InstalledApp } from '@shared/types'
import { DeviceShell, type AdbRunner } from './adb/adb'
import { parseDevices, parsePackages, parseResolveActivity, parseWmDensity, parseWmSize } from './adb/parsers'

export class DeviceManager extends EventEmitter {
  private cache = new Map<string, Device>()
  private timer: NodeJS.Timeout | null = null
  private lastJson = ''

  constructor(readonly adb: AdbRunner) {
    super()
  }

  start(intervalMs = 2000): void {
    const tick = (): void => {
      this.refresh()
        .catch(() => {})
        .finally(() => {
          this.timer = setTimeout(tick, intervalMs)
        })
    }
    tick()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  list(): Device[] {
    return [...this.cache.values()]
  }

  get(serial: string): Device | undefined {
    return this.cache.get(serial)
  }

  shell(serial: string): DeviceShell {
    return new DeviceShell(this.adb, serial)
  }

  async refresh(): Promise<Device[]> {
    const lines = parseDevices((await this.adb.run(['devices', '-l'])) as string)
    const next = new Map<string, Device>()
    for (const l of lines) {
      const known = this.cache.get(l.serial)
      if (known && known.state === l.state && (l.state !== 'device' || known.screen)) {
        next.set(l.serial, known)
        continue
      }
      const d: Device = { serial: l.serial, state: l.state, model: l.model || l.serial, android: '', sdk: 0, screen: null, connection: l.connection }
      if (l.state === 'device') await this.describe(d).catch(() => {})
      next.set(l.serial, d)
    }
    this.cache = next
    const json = JSON.stringify(this.list())
    if (json !== this.lastJson) {
      this.lastJson = json
      this.emit('changed', this.list())
    }
    return this.list()
  }

  private async describe(d: Device): Promise<void> {
    const sh = this.shell(d.serial)
    const props = await sh.shell('getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk')
    const [model, release, sdk] = props.split(/\r?\n/).map((s) => s.trim())
    d.model = model || d.model
    d.android = release ?? ''
    d.sdk = Number(sdk) || 0
    const size = parseWmSize(await sh.shell('wm size'))
    const density = parseWmDensity(await sh.shell('wm density'))
    if (size) d.screen = { ...size, density }
  }

  async pair(hostPort: string, code: string): Promise<string> {
    return ((await this.adb.run(['pair', hostPort, code], { timeoutMs: 30000 })) as string).trim()
  }

  async connect(hostPort: string): Promise<string> {
    const out = ((await this.adb.run(['connect', hostPort], { timeoutMs: 30000 })) as string).trim()
    if (/failed|unable|cannot/i.test(out)) throw new Error(out)
    await this.refresh()
    return out
  }

  /** Third-party apps on the device, with their launcher activity when it resolves. */
  async apps(serial: string): Promise<InstalledApp[]> {
    const sh = this.shell(serial)
    const pkgs = parsePackages(await sh.shell('pm list packages -3'))
    const result: InstalledApp[] = []
    for (const pkg of pkgs) {
      const out = await sh.shell(`cmd package resolve-activity --brief ${pkg}`).catch(() => '')
      result.push({ package: pkg, activity: parseResolveActivity(out) })
    }
    return result
  }
}
