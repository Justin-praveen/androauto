import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const hex = (n: number): string => (n < 0 ? 0x100000000 + n : n).toString(16).padStart(8, '0')

/** getevent -lt lines for one finger following `points` (screen px, scaled x4 like the fixture). */
export function touchLines(points: { x: number; y: number }[], startSec: number, stepMs: number, trackingId = 1): string[] {
  const dev = '/dev/input/event2'
  const ts = (i: number): string => `[ ${(startSec + (i * stepMs) / 1000).toFixed(6)}]`
  const lines: string[] = []
  points.forEach((p, i) => {
    if (i === 0) {
      lines.push(`${ts(i)} ${dev}: EV_ABS       ABS_MT_TRACKING_ID   ${hex(trackingId)}`)
      lines.push(`${ts(i)} ${dev}: EV_KEY       BTN_TOUCH            DOWN`)
    }
    lines.push(`${ts(i)} ${dev}: EV_ABS       ABS_MT_POSITION_X    ${hex(p.x * 4)}`)
    lines.push(`${ts(i)} ${dev}: EV_ABS       ABS_MT_POSITION_Y    ${hex(p.y * 4)}`)
    lines.push(`${ts(i)} ${dev}: EV_SYN       SYN_REPORT           00000000`)
  })
  const end = ts(points.length)
  lines.push(`${end} ${dev}: EV_ABS       ABS_MT_TRACKING_ID   ffffffff`)
  lines.push(`${end} ${dev}: EV_KEY       BTN_TOUCH            UP`)
  lines.push(`${end} ${dev}: EV_SYN       SYN_REPORT           00000000`)
  return lines
}
