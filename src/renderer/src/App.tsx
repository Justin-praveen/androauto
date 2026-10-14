import { useEffect, useState } from 'react'
import { Circle, FolderKanban, ListChecks, Monitor, Moon, PlayCircle, Smartphone, Sun } from 'lucide-react'
import { cx, Dot } from './components/ui'
import { isMock } from './lib/api'
import { useApp, type Page } from './lib/state'
import { DevicesPage } from './pages/Devices'
import { FlowsPage } from './pages/Flows'
import { ProjectsPage } from './pages/Projects'
import { RecorderPage } from './pages/Recorder'
import { RunsPage } from './pages/Runs'

type Theme = 'system' | 'light' | 'dark'

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('androauto.theme') as Theme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    try {
      localStorage.setItem('androauto.theme', theme)
    } catch {
      // not persisted
    }
    return () => mq.removeEventListener('change', apply)
  }, [theme])
  return [theme, setTheme]
}

const NAV: { id: Page; label: string; icon: typeof Circle; needsProject?: boolean }[] = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'flows', label: 'Flows', icon: ListChecks, needsProject: true },
  { id: 'recorder', label: 'Recorder', icon: Circle, needsProject: true },
  { id: 'runs', label: 'Runs', icon: PlayCircle, needsProject: true },
  { id: 'devices', label: 'Devices', icon: Smartphone }
]

export function App() {
  const { page, go, projects, projectId, setProjectId, project, recorder, batch, openRun, toastMsg } = useApp()
  const [theme, setTheme] = useTheme()
  const recording = recorder.state === 'recording'

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <Monitor size={15} strokeWidth={2.4} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">androauto</span>
        </div>

        <div className="px-3 pb-3">
          <label className="mb-1 block px-2 text-[11px] font-medium uppercase tracking-wider text-muted">Project</label>
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            disabled={recording || batch?.state === 'running'}
            className="h-9 w-full cursor-pointer rounded-lg border border-line bg-sunken px-2.5 text-sm outline-none focus:border-accent"
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((n) => {
            const disabled = n.needsProject && !project
            const Icon = n.icon
            return (
              <button
                key={n.id}
                disabled={disabled}
                onClick={() => (n.id === 'runs' ? openRun(null) : go(n.id))}
                className={cx(
                  'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                  page === n.id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-sunken hover:text-fg'
                )}
              >
                <Icon size={16} className={n.id === 'recorder' && recording ? 'fill-rec text-rec pulse' : undefined} />
                {n.label}
                {n.id === 'recorder' && recording && <span className="ml-auto text-[11px] font-semibold text-rec">REC</span>}
                {n.id === 'runs' && batch?.state === 'running' && (
                  <span className="ml-auto text-[11px] font-semibold text-accent">
                    {Math.min(batch.current + 1, batch.runs.length)}/{batch.runs.length}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center gap-1 border-t border-line p-3">
          {(['light', 'system', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cx(
                'flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md text-xs transition',
                theme === t ? 'bg-sunken text-fg' : 'text-muted hover:text-fg'
              )}
              title={`${t} theme`}
            >
              {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : 'Auto'}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className={cx('mx-auto px-8 py-7', page === 'recorder' ? 'max-w-[1400px]' : 'max-w-6xl')}>
            {page === 'projects' && <ProjectsPage />}
            {page === 'flows' && <FlowsPage />}
            {page === 'recorder' && <RecorderPage />}
            {page === 'runs' && <RunsPage />}
            {page === 'devices' && <DevicesPage />}
          </div>
        </main>
      </div>

      {toastMsg && (
        <div
          className={cx(
            'fixed bottom-5 right-5 z-[60] max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg',
            toastMsg.kind === 'error' ? 'border-bad/30 bg-panel text-bad' : 'border-ok/30 bg-panel text-ok'
          )}
        >
          {toastMsg.msg}
        </div>
      )}
    </div>
  )
}

function TopBar() {
  const { devices, serial, setSerial, device, setup, go, recorder } = useApp()
  const online = devices.filter((d) => d.state === 'device')
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-5 border-b border-line bg-panel px-6">
      {isMock && <span className="mr-auto rounded-md bg-warn/15 px-2 py-1 text-[11px] font-medium text-warn">Preview with demo data</span>}
      <div className="flex items-center gap-2 text-[13px]">
        <Dot tone={device?.state === 'device' ? 'ok' : 'muted'} />
        {online.length > 0 ? (
          <select
            value={serial ?? ''}
            onChange={(e) => setSerial(e.target.value)}
            disabled={recorder.state === 'recording'}
            className="cursor-pointer bg-transparent font-medium outline-none"
          >
            {online.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.model}
              </option>
            ))}
          </select>
        ) : (
          <button className="cursor-pointer text-muted hover:text-fg" onClick={() => go('devices')}>
            No device connected
          </button>
        )}
      </div>
      <button className="flex cursor-pointer items-center gap-2 text-[13px]" onClick={() => go('devices')} title={setup?.appium.detail}>
        <Dot tone={setup?.appium.ok ? 'ok' : setup ? 'warn' : 'muted'} />
        <span className={setup?.appium.ok ? 'font-medium' : 'text-muted'}>Appium</span>
      </button>
    </header>
  )
}
