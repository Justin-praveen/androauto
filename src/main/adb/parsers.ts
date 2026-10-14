// Pure parsers for adb command output. Kept free of I/O so they can be unit tested.

import type { Device, InstalledApp } from '@shared/types'

export interface AdbDeviceLine {
  serial: string
  state: string
  model: string
  connection: Device['connection']
}

/** Parses `adb devices -l`. */
export function parseDevices(out: string): AdbDeviceLine[] {
  const result: AdbDeviceLine[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const [serial, state, ...rest] = line.split(/\s+/)
    if (!serial || !state) continue
    const props: Record<string, string> = {}
    for (const kv of rest) {
      const i = kv.indexOf(':')
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1)
    }
    result.push({
      serial,
      state,
      model: (props.model ?? '').replace(/_/g, ' '),
      connection: connectionOf(serial)
    })
  }
  return result
}

export function connectionOf(serial: string): Device['connection'] {
  if (serial.startsWith('emulator-')) return 'emulator'
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial) || serial.includes('._adb-tls-connect.')) return 'wifi'
  return 'usb'
}

/** Parses `wm size` (prefers the override size when set). */
export function parseWmSize(out: string): { w: number; h: number } | null {
  const override = out.match(/Override size:\s*(\d+)x(\d+)/)
  const physical = out.match(/Physical size:\s*(\d+)x(\d+)/)
  const m = override ?? physical
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

/** Parses `wm density`. */
export function parseWmDensity(out: string): number {
  const m = out.match(/Override density:\s*(\d+)/) ?? out.match(/Physical density:\s*(\d+)/)
  return m ? Number(m[1]) : 0
}

export interface AxisRange {
  min: number
  max: number
}

export interface TouchInputDevice {
  path: string
  name: string
  x: AxisRange
  y: AxisRange
}

/**
 * Parses `getevent -pl` and returns the touchscreen: the first device reporting
 * ABS_MT_POSITION_X/Y. Device naming varies by vendor, so we look at capabilities, not names.
 */
export function parseTouchDevice(out: string): TouchInputDevice | null {
  const blocks = out.split(/^add device \d+:\s*/m).slice(1)
  for (const block of blocks) {
    const path = block.split(/\r?\n/)[0].trim()
    const name = block.match(/name:\s*"([^"]*)"/)?.[1] ?? ''
    const x = axis(block, 'ABS_MT_POSITION_X')
    const y = axis(block, 'ABS_MT_POSITION_Y')
    if (x && y) return { path, name, x, y }
  }
  return null
}

function axis(block: string, label: string): AxisRange | null {
  const m = block.match(new RegExp(`${label}\\s*:\\s*value -?\\d+, min (-?\\d+), max (-?\\d+)`))
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null
}

/** Parses `pm list packages` output. */
export function parsePackages(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.slice('package:'.length))
    .sort()
}

/** Parses `cmd package resolve-activity --brief <pkg>`: the last line is pkg/activity. */
export function parseResolveActivity(out: string): string | null {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1]
  if (!last || !last.includes('/') || /No activity found/i.test(out)) return null
  return last.slice(last.indexOf('/') + 1)
}

export function toInstalledApp(pkg: string, resolveOut: string): InstalledApp {
  return { package: pkg, activity: parseResolveActivity(resolveOut) }
}

/** `dumpsys input_method`: whether the soft keyboard is on screen. */
export function parseImeShown(out: string): boolean {
  return /mInputShown=true/.test(out) || /mIsInputViewShown=true/.test(out)
}

/**
 * Keyboard rectangle from `dumpsys window InputMethod`. The IME window often covers the whole
 * screen with a content inset, so the visible keyboard starts at frame.top + inset.top.
 */
export function parseImeFrame(out: string): [number, number, number, number] | null {
  const frame = out.match(/\b(?:mFrame|frame)=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!frame) return null
  const [l, t, r, b] = frame.slice(1, 5).map(Number)
  const inset = out.match(/mGivenContentInsets=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  const top = inset ? t + Number(inset[2]) : t
  if (b - top <= 0) return null
  return [l, top, r, b]
}
