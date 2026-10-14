import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type AndroautoBridge } from '@shared/api'

const bridge: AndroautoBridge = {
  invoke: ((channel: string, ...args: unknown[]) => {
    if (!(INVOKE_CHANNELS as string[]).includes(channel)) throw new Error(`Unknown channel ${channel}`)
    return ipcRenderer.invoke(channel, ...args)
  }) as AndroautoBridge['invoke'],
  on: (channel, cb) => {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`)
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('androauto', bridge)
