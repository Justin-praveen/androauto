import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Device, ProjectSummary, RecorderStatus, SetupCheck } from '@shared/types'
import { api } from './api'

export type Page = 'projects' | 'flows' | 'recorder' | 'devices'

interface AppState {
  page: Page
  go: (p: Page) => void
  projects: ProjectSummary[]
  reloadProjects: () => Promise<void>
  projectId: string | null
  setProjectId: (id: string | null) => void
  project: ProjectSummary | null
  devices: Device[]
  serial: string | null
  setSerial: (s: string | null) => void
  device: Device | null
  recorder: RecorderStatus
  setup: SetupCheck | null
  refreshSetup: () => Promise<void>
  toast: (msg: string, kind?: 'error' | 'ok') => void
  toastMsg: { msg: string; kind: 'error' | 'ok' } | null
}

const Ctx = createContext<AppState | null>(null)

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    // storage unavailable: preference just isn't remembered
  }
}

const IDLE: RecorderStatus = { state: 'idle', mode: 'phone', serial: null, projectId: null, startedAt: null, steps: [], hierarchySource: null }

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<Page>('projects')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectIdRaw] = useState<string | null>(load('androauto.project'))
  const [devices, setDevices] = useState<Device[]>([])
  const [serial, setSerialRaw] = useState<string | null>(load('androauto.serial'))
  const [recorder, setRecorder] = useState<RecorderStatus>(IDLE)
  const [setup, setSetup] = useState<SetupCheck | null>(null)
  const [toastMsg, setToast] = useState<AppState['toastMsg']>(null)

  const toast = useCallback((msg: string, kind: 'error' | 'ok' = 'error') => {
    setToast({ msg, kind })
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 5000)
  }, [])

  const reloadProjects = useCallback(async () => {
    setProjects(await api.invoke('projects:list'))
  }, [])

  const refreshSetup = useCallback(async () => {
    setSetup(await api.invoke('devices:setup'))
  }, [])

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdRaw(id)
    save('androauto.project', id)
  }, [])
  const setSerial = useCallback((s: string | null) => {
    setSerialRaw(s)
    save('androauto.serial', s)
  }, [])

  useEffect(() => {
    void reloadProjects()
    void refreshSetup()
    void api.invoke('devices:list').then(setDevices)
    void api.invoke('recorder:status').then(setRecorder)
    const offs = [api.on('devices:changed', setDevices), api.on('recorder:status', setRecorder)]
    return () => offs.forEach((off) => off())
  }, [reloadProjects, refreshSetup])

  // Default to the first online device when none is chosen or the chosen one went away.
  useEffect(() => {
    const online = devices.filter((d) => d.state === 'device')
    if ((!serial || !devices.some((d) => d.serial === serial)) && online[0]) setSerial(online[0].serial)
  }, [devices, serial, setSerial])

  useEffect(() => {
    if (projects.length && (!projectId || !projects.some((p) => p.id === projectId))) setProjectId(projects[0].id)
  }, [projects, projectId, setProjectId])

  const value = useMemo<AppState>(
    () => ({
      page,
      go: setPage,
      projects,
      reloadProjects,
      projectId,
      setProjectId,
      project: projects.find((p) => p.id === projectId) ?? null,
      devices,
      serial,
      setSerial,
      device: devices.find((d) => d.serial === serial) ?? null,
      recorder,
      setup,
      refreshSetup,
      toast,
      toastMsg
    }),
    [page, projects, reloadProjects, projectId, setProjectId, devices, serial, setSerial, recorder, setup, refreshSetup, toast, toastMsg]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

/** Runs an async action and reports failures as a toast. */
export function useAction() {
  const { toast } = useApp()
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (e) {
        toast(cleanError(e))
        return undefined
      }
    },
    [toast]
  )
}

export function cleanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
