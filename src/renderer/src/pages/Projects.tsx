import { useEffect, useState } from 'react'
import { FolderPlus, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import type { InstalledApp, ProjectSummary } from '@shared/types'
import { Button, Card, Checkbox, Dialog, Empty, Field, Input, PageHeader, Select } from '../components/ui'
import { api } from '../lib/api'
import { useAction, useApp } from '../lib/state'

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function ProjectsPage() {
  const { projects, setProjectId, go } = useApp()
  const [open, setOpen] = useState(false)

  const openProject = (p: ProjectSummary): void => {
    setProjectId(p.id)
    go('flows')
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="One project per app you test. Flows, devices and runs live under it."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <Empty icon={<FolderPlus size={20} />} title="Create your first project">
          Pick the app you want to test. If your phone is connected you can choose it from the installed apps.
          <div className="mt-4">
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus size={16} /> New project
            </Button>
          </div>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {projects.map((p, i) => (
            <ProjectCard key={p.id} p={p} color={COLORS[i % COLORS.length]} onOpen={() => openProject(p)} />
          ))}
          <button
            onClick={() => setOpen(true)}
            className="flex min-h-[148px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-muted transition hover:border-accent/60 hover:text-accent"
          >
            <Plus size={20} />
            <span className="text-sm font-medium">Create a project</span>
          </button>
        </div>
      )}

      <NewProjectDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function ProjectCard({ p, color, onOpen }: { p: ProjectSummary; color: string; onOpen: () => void }) {
  const { reloadProjects } = useApp()
  const run = useAction()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <Card onClick={onOpen} className="relative flex min-h-[148px] flex-col p-5">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white" style={{ background: color }}>
          {initials(p.name)}
        </div>
        <button
          className="cursor-pointer rounded-md p-1 text-muted hover:bg-sunken hover:text-fg"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
          aria-label="Project actions"
        >
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <div className="absolute right-4 top-12 z-10 w-40 rounded-lg border border-line bg-panel p-1 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-bad hover:bg-bad/10"
              onClick={() => {
                setMenu(false)
                setConfirm(true)
              }}
            >
              <Trash2 size={14} /> Delete project
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 font-semibold">{p.name}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-muted">{p.appPackage}</div>
      <div className="mt-auto pt-3 text-[13px] text-muted">
        {p.flowCount} {p.flowCount === 1 ? 'flow' : 'flows'}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Dialog
          open={confirm}
          onClose={() => setConfirm(false)}
          title={`Delete ${p.name}?`}
          description="This removes the project and all of its recorded flows from this computer."
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                variant="primary"
                className="!bg-bad !text-white"
                onClick={() =>
                  run(async () => {
                    await api.invoke('projects:delete', p.id)
                    setConfirm(false)
                    await reloadProjects()
                  })
                }
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">This can't be undone.</p>
        </Dialog>
      </div>
    </Card>
  )
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { device, reloadProjects, setProjectId, go, toast } = useApp()
  const run = useAction()
  const [name, setName] = useState('')
  const [pkg, setPkg] = useState('')
  const [activity, setActivity] = useState('')
  const [apkPath, setApkPath] = useState('')
  const [clearData, setClearData] = useState(false)
  const [grant, setGrant] = useState(true)
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [loadingApps, setLoadingApps] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setPkg('')
    setActivity('')
    setApkPath('')
    setApps(null)
    if (device?.state === 'device') {
      setLoadingApps(true)
      api
        .invoke('devices:apps', device.serial)
        .then(setApps)
        .catch(() => setApps([]))
        .finally(() => setLoadingApps(false))
    }
  }, [open, device?.serial, device?.state])

  const pick = (p: string): void => {
    const app = apps?.find((a) => a.package === p)
    setPkg(p)
    setActivity(app?.activity ?? '')
    if (!name) {
      const last = p.split('.').pop() ?? p
      setName(last.charAt(0).toUpperCase() + last.slice(1) + ' App')
    }
  }

  const create = (): Promise<unknown> =>
    run(async () => {
      const p = await api.invoke('projects:create', {
        name,
        appPackage: pkg,
        appActivity: activity,
        ...(apkPath ? { apkPath } : {}),
        launchOptions: { clearDataBeforeRun: clearData, grantPermissions: grant }
      })
      await reloadProjects()
      setProjectId(p.id)
      onClose()
      toast(`Created ${p.name}`, 'ok')
      go('recorder')
    })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      description="Choose the app under test. androauto launches it before recording and before each run."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || !pkg.trim()} onClick={() => void create()}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop App" />
        </Field>

        <Field
          label="App on the connected phone"
          hint={device ? `From ${device.model}. Picking one fills in the package and activity.` : 'Connect a phone to pick from its installed apps, or fill in the package below.'}
        >
          <Select value={apps?.some((a) => a.package === pkg) ? pkg : ''} onChange={(e) => pick(e.target.value)} disabled={!apps?.length}>
            <option value="">{loadingApps ? 'Loading installed apps…' : apps?.length ? 'Choose an app…' : 'No phone connected'}</option>
            {apps?.map((a) => (
              <option key={a.package} value={a.package}>
                {a.package}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Package">
            <Input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="com.example.shop" className="font-mono text-[13px]" />
          </Field>
          <Field label="Launch activity" hint="Optional. Uses the launcher if empty.">
            <Input value={activity} onChange={(e) => setActivity(e.target.value)} placeholder=".MainActivity" className="font-mono text-[13px]" />
          </Field>
        </div>

        <Field label="APK path" hint="Optional. Lets later runs install the app first.">
          <Input value={apkPath} onChange={(e) => setApkPath(e.target.value)} placeholder="/path/to/app.apk" className="font-mono text-[13px]" />
        </Field>

        <div className="space-y-2 rounded-lg bg-sunken p-3">
          <Checkbox checked={clearData} onChange={setClearData} label="Clear app data before each run" />
          <Checkbox checked={grant} onChange={setGrant} label="Grant runtime permissions automatically" />
        </div>
      </div>
    </Dialog>
  )
}
