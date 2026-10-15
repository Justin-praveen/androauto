import { describe, expect, it } from 'vitest'
import { escapeInputText } from '../src/main/adb/adb'
import {
  parseDevices, parseImeFrame, parseImeShown, parsePackages, parseResolveActivity,
  parseTouchDevice, parseWmDensity, parseWmSize
} from '../src/main/adb/parsers'
import { fixture } from './helpers'

describe('adb parsers', () => {
  it('parses adb devices -l with usb, wifi, emulator and unauthorized', () => {
    const out = `List of devices attached
R5CT1234               device usb:1-1 product:panther model:Pixel_7 device:panther transport_id:1
192.168.1.20:41235     device product:dm1q model:SM_S911B device:dm1q transport_id:3
emulator-5554          offline transport_id:4
ZY22ABC                unauthorized usb:2-1 transport_id:5
`
    expect(parseDevices(out)).toEqual([
      { serial: 'R5CT1234', state: 'device', model: 'Pixel 7', connection: 'usb' },
      { serial: '192.168.1.20:41235', state: 'device', model: 'SM S911B', connection: 'wifi' },
      { serial: 'emulator-5554', state: 'offline', model: '', connection: 'emulator' },
      { serial: 'ZY22ABC', state: 'unauthorized', model: '', connection: 'usb' }
    ])
  })

  it('ignores the daemon start banner', () => {
    expect(parseDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n')).toEqual([])
  })

  it('prefers override size and density', () => {
    expect(parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({ w: 720, h: 1600 })
    expect(parseWmSize('Physical size: 1080x2400')).toEqual({ w: 1080, h: 2400 })
    expect(parseWmDensity('Physical density: 420')).toBe(420)
    expect(parseWmDensity('Physical density: 420\nOverride density: 480')).toBe(480)
  })

  it('finds the touchscreen by capabilities, not by name', () => {
    expect(parseTouchDevice(fixture('getevent-p.txt'))).toEqual({
      path: '/dev/input/event2', name: 'fts_ts', x: { min: 0, max: 4319 }, y: { min: 0, max: 9599 }
    })
    expect(parseTouchDevice('add device 1: /dev/input/event0\n  name: "keys"\n')).toBeNull()
  })

  it('parses packages and launcher activities', () => {
    expect(parsePackages('package:com.b\npackage:com.a\n')).toEqual(['com.a', 'com.b'])
    expect(parseResolveActivity('priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.example.shop/.MainActivity\n')).toBe('.MainActivity')
    expect(parseResolveActivity('No activity found')).toBeNull()
  })

  it('reads keyboard visibility and its rectangle', () => {
    expect(parseImeShown('  mInputShown=true mShowRequested=true')).toBe(true)
    expect(parseImeShown('  mInputShown=false')).toBe(false)
    const win = `WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #3 Window{5e1 u0 InputMethod}:
    mFrame=[0,84][1080,2400] last=[0,84][1080,2400]
    mGivenContentInsets=[0,1456][0,0] mGivenVisibleInsets=[0,1456][0,0]`
    expect(parseImeFrame(win)).toEqual([0, 1540, 1080, 2400])
  })

  it('escapes text for input text', () => {
    expect(escapeInputText('demo@example.com')).toBe('demo@example.com')
    expect(escapeInputText("hi there's $5")).toBe("hi%sthere\\'s%s\\$5")
  })
})
