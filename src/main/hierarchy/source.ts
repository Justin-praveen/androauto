// Where UI hierarchy snapshots come from. Appium's UiAutomator2 page source is preferred
// (faster and the same engine replay uses); plain `uiautomator dump` over adb works without
// Appium. Only one can run at a time on a device, since both use UiAutomation.

import type { DeviceShell } from '../adb/adb'

export interface HierarchySource {
  readonly name: 'appium' | 'adb'
  dump(): Promise<string>
  close(): Promise<void>
}

export class AdbDumpSource implements HierarchySource {
  readonly name = 'adb' as const
  constructor(private readonly dev: DeviceShell) {}

  async dump(): Promise<string> {
    const out = (await this.dev.execOut('uiautomator dump --compressed /dev/tty', 15000)).toString('utf8')
    const end = out.lastIndexOf('</hierarchy>')
    if (end < 0) {
      // Some builds can't write to /dev/tty; fall back to a file on the device.
      await this.dev.shell('uiautomator dump --compressed /sdcard/androauto_ui.xml', 15000)
      return this.dev.shell('cat /sdcard/androauto_ui.xml')
    }
    return out.slice(0, end + '</hierarchy>'.length)
  }

  async close(): Promise<void> {}
}

export class AppiumSource implements HierarchySource {
  readonly name = 'appium' as const
  private constructor(private readonly browser: WebdriverIO.Browser) {}

  static async open(appiumUrl: URL, serial: string): Promise<AppiumSource> {
    const { remote } = await import('webdriverio')
    const browser = await remote({
      hostname: appiumUrl.hostname,
      port: Number(appiumUrl.port),
      path: appiumUrl.pathname,
      logLevel: 'warn',
      connectionRetryCount: 1,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': serial,
        'appium:noReset': true,
        'appium:newCommandTimeout': 900,
        // Faster page source: don't wait for the UI to go idle (recording polls continuously).
        'appium:waitForIdleTimeout': 0,
        'appium:settings[waitForIdleTimeout]': 0
      } as WebdriverIO.Capabilities
    })
    return new AppiumSource(browser)
  }

  async dump(): Promise<string> {
    return this.browser.getPageSource()
  }

  async close(): Promise<void> {
    await this.browser.deleteSession().catch(() => {})
  }
}
