// Starts a local Appium server on a free port and checks the UiAutomator2 driver (spec section 2).
// Appium is optional for recording: without it the recorder uses `uiautomator dump` over adb.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
  })
}

export function findAppium(appRoot: string): string | null {
  if (process.env.ANDROAUTO_APPIUM) return process.env.ANDROAUTO_APPIUM
  const local = join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'appium.cmd' : 'appium')
  return existsSync(local) ? local : 'appium'
}

export class AppiumManager {
  private proc: ChildProcess | null = null
  url: URL | null = null
  lastError = ''

  constructor(private readonly appRoot: string) {}

  get running(): boolean {
    return !!this.url
  }

  private bin(): string | null {
    return findAppium(this.appRoot)
  }

  /** Whether the uiautomator2 driver is installed, using `appium driver list --installed --json`. */
  driverInstalled(): Promise<{ ok: boolean; detail: string }> {
    const bin = this.bin()
    if (!bin) return Promise.resolve({ ok: false, detail: 'Appium not found' })
    return new Promise((resolve) => {
      execFile(
        bin,
        ['driver', 'list', '--installed', '--json'],
        { timeout: 60000, shell: process.platform === 'win32', windowsHide: true },
        (err, stdout) => {
          if (err) return resolve({ ok: false, detail: 'Appium not found. Run npm install, or install Appium globally' })
          try {
            const drivers = JSON.parse(stdout) as Record<string, { version?: string }>
            const d = drivers.uiautomator2
            resolve(d ? { ok: true, detail: `uiautomator2 ${d.version ?? ''}`.trim() } : { ok: false, detail: 'Run: npm run appium:driver' })
          } catch {
            resolve({ ok: false, detail: 'Could not read the Appium driver list' })
          }
        }
      )
    })
  }

  async start(): Promise<URL> {
    if (this.url) return this.url
    const bin = this.bin()
    if (!bin) throw new Error('Appium not found')
    const port = await freePort()
    this.proc = spawn(bin, ['--port', String(port), '--address', '127.0.0.1', '--log-level', 'warn', '--relaxed-security'], {
      shell: process.platform === 'win32',
      windowsHide: true
    })
    let stderr = ''
    this.proc.stderr?.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-2000)))
    this.proc.on('exit', () => {
      this.proc = null
      this.url = null
    })
    const url = new URL(`http://127.0.0.1:${port}/`)
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (!this.proc) break
      try {
        const res = await fetch(new URL('status', url))
        if (res.ok) {
          this.url = url
          this.lastError = ''
          return url
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    this.stop()
    this.lastError = stderr.trim() || 'Appium did not start'
    throw new Error(this.lastError)
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    this.url = null
  }
}
