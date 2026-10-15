import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Finds the adb binary: ANDROAUTO_ADB, then the Android SDK, then PATH. */
export function findAdb(): string {
  if (process.env.ANDROAUTO_ADB) return process.env.ANDROAUTO_ADB
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'
  for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (sdk) {
      const p = join(sdk, 'platform-tools', exe)
      if (existsSync(p)) return p
    }
  }
  return 'adb'
}

export interface AdbRunner {
  /** Runs adb with args and resolves stdout. Binary output when `binary` is set. */
  run(args: string[], opts?: { binary?: boolean; timeoutMs?: number }): Promise<string | Buffer>
  /** Starts a long-running adb process (getevent). */
  stream(args: string[]): ChildProcess
}

export class Adb implements AdbRunner {
  constructor(readonly bin = findAdb()) {}

  run(args: string[], opts: { binary?: boolean; timeoutMs?: number } = {}): Promise<string | Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        this.bin,
        args,
        {
          encoding: opts.binary ? 'buffer' : 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: opts.timeoutMs ?? 20000,
          windowsHide: true
        },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr?.toString() || err.message).trim()
            reject(new Error(`adb ${args.join(' ')}: ${msg}`))
          } else resolve(stdout)
        }
      )
    })
  }

  stream(args: string[]): ChildProcess {
    return spawn(this.bin, args, { windowsHide: true })
  }
}

/** Convenience wrapper bound to one device serial. */
export class DeviceShell {
  constructor(
    readonly adb: AdbRunner,
    readonly serial: string
  ) {}

  async shell(cmd: string, timeoutMs?: number): Promise<string> {
    return (await this.adb.run(['-s', this.serial, 'shell', cmd], { timeoutMs })) as string
  }

  async execOut(cmd: string, timeoutMs?: number): Promise<Buffer> {
    return (await this.adb.run(['-s', this.serial, 'exec-out', cmd], { binary: true, timeoutMs })) as Buffer
  }

  async screencap(): Promise<Buffer> {
    return this.execOut('screencap -p', 10000)
  }

  async tap(x: number, y: number): Promise<void> {
    await this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`)
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void> {
    await this.shell(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(ms)}`)
  }

  async keyevent(code: number): Promise<void> {
    await this.shell(`input keyevent ${code}`)
  }

  async inputText(text: string): Promise<void> {
    await this.shell(`input text ${escapeInputText(text)}`)
  }

  async launch(pkg: string, activity: string): Promise<void> {
    if (activity) {
      const component = activity.includes('/') ? activity : `${pkg}/${activity}`
      const out = await this.shell(`am start -W -n ${component}`, 30000)
      if (/Error/i.test(out)) throw new Error(out.trim())
    } else {
      await this.shell(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, 30000)
    }
  }
}

/** `input text` treats spaces as separators and the shell interprets metacharacters. */
export function escapeInputText(text: string): string {
  return text
    .split('')
    .map((ch) => {
      if (ch === ' ') return '%s'
      if (/[A-Za-z0-9._@,:=+\-/]/.test(ch)) return ch
      return '\\' + ch
    })
    .join('')
}

export const KEYCODES = { back: 4, home: 3, enter: 66 } as const
