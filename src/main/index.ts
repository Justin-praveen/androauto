import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { Adb } from './adb/adb'
import { AppiumManager } from './appium-manager'
import { DeviceManager } from './device-manager'
import { registerIpc, sender, type Services } from './ipc'
import { Mirror } from './mirror'
import { RunService } from './player/runner'
import { RecorderService } from './recorder/service'
import { Store } from './store'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'androauto',
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  const adb = new Adb()
  const store = new Store()
  const devices = new DeviceManager(adb)
  const appium = new AppiumManager(app.getAppPath())
  const mirror = new Mirror()
  const recorder = new RecorderService(devices, appium, mirror, store)
  const runner = new RunService(devices, appium, recorder, store)
  const svc: Services = { adb, store, devices, appium, mirror, recorder, runner }

  registerIpc(svc, sender(() => win?.webContents ?? null))
  devices.start()
  // Appium is optional; start it in the background so the Devices checklist can report on it.
  if (process.env.ANDROAUTO_NO_APPIUM !== '1') void appium.start().catch(() => {})

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('before-quit', () => {
    devices.stop()
    runner.abort()
    mirror.stop()
    appium.stop()
    void recorder.discard()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
