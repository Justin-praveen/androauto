// Live view of the phone. v1 polls `screencap` (a few frames per second, no extra install);
// the spec's scrcpy stream is the upgrade path and can replace this behind the same events.

import { EventEmitter } from 'node:events'
import type { MirrorFrame } from '@shared/types'
import type { DeviceShell } from './adb/adb'

export function pngSize(png: Buffer): { w: number; h: number } {
  // IHDR: width and height are big-endian uint32 at bytes 16 and 20.
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) return { w: 0, h: 0 }
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) }
}

export class Mirror extends EventEmitter {
  private serial: string | null = null
  private generation = 0
  latest: { serial: string; png: Buffer; at: number } | null = null

  get activeSerial(): string | null {
    return this.serial
  }

  start(sh: DeviceShell, minIntervalMs = 200): void {
    if (this.serial === sh.serial) return
    this.stop()
    this.serial = sh.serial
    const gen = ++this.generation
    const loop = async (): Promise<void> => {
      while (gen === this.generation) {
        const t0 = Date.now()
        try {
          const png = await sh.screencap()
          if (gen !== this.generation) return
          this.latest = { serial: sh.serial, png, at: Date.now() }
          const { w, h } = pngSize(png)
          const frame: MirrorFrame = { serial: sh.serial, dataUrl: `data:image/png;base64,${png.toString('base64')}`, w, h, at: Date.now() }
          this.emit('frame', frame)
        } catch {
          await new Promise((r) => setTimeout(r, 1000))
        }
        const wait = minIntervalMs - (Date.now() - t0)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
    }
    void loop()
  }

  stop(): void {
    this.generation++
    this.serial = null
    this.latest = null
  }
}
