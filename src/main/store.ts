// Files on disk (spec section 3). Flows are JSON files and are the source of truth; listing
// scans the folders. Secrets live in secrets.json next to the projects (not inside flows), so
// flows stay safe to share or commit.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Flow, FlowSummary, Project, ProjectSummary, Run, RunSummary } from '@shared/types'
import type { NewProjectInput } from '@shared/api'
import type { StepArtifacts } from './recorder/engine'

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(3).toString('hex')}`
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 60)
  return s || 'flow'
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

export class Store {
  constructor(readonly root = process.env.ANDROAUTO_HOME || join(homedir(), 'androauto')) {
    mkdirSync(join(root, 'projects'), { recursive: true })
  }

  private projectDir(id: string): string {
    if (!/^prj_[\w-]+$/.test(id)) throw new Error(`Bad project id: ${id}`)
    return join(this.root, 'projects', id)
  }

  private flowsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'flows')
  }

  // ---- projects ----------------------------------------------------------------------------

  listProjects(): ProjectSummary[] {
    const dir = join(this.root, 'projects')
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'project.json')))
      .map((d) => {
        const p = readJson<Project>(join(dir, d.name, 'project.json'))
        return { ...p, flowCount: this.flowFiles(p.id).length }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  getProject(id: string): Project {
    return readJson<Project>(join(this.projectDir(id), 'project.json'))
  }

  createProject(input: NewProjectInput): Project {
    if (!input.name.trim()) throw new Error('Project name is required')
    if (!input.appPackage.trim()) throw new Error('App package is required')
    const p: Project = {
      id: newId('prj'),
      name: input.name.trim(),
      appPackage: input.appPackage.trim(),
      appActivity: input.appActivity.trim(),
      ...(input.apkPath ? { apkPath: input.apkPath } : {}),
      launchOptions: { clearDataBeforeRun: false, grantPermissions: true, ...input.launchOptions },
      createdAt: new Date().toISOString()
    }
    mkdirSync(join(this.projectDir(p.id), 'flows'), { recursive: true })
    mkdirSync(join(this.projectDir(p.id), 'runs'), { recursive: true })
    writeJson(join(this.projectDir(p.id), 'project.json'), p)
    return p
  }

  updateProject(id: string, patch: Partial<NewProjectInput>): Project {
    const p = this.getProject(id)
    const next: Project = {
      ...p,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.appPackage !== undefined ? { appPackage: patch.appPackage.trim() } : {}),
      ...(patch.appActivity !== undefined ? { appActivity: patch.appActivity.trim() } : {}),
      ...(patch.apkPath !== undefined ? { apkPath: patch.apkPath } : {}),
      launchOptions: { ...p.launchOptions, ...patch.launchOptions }
    }
    writeJson(join(this.projectDir(id), 'project.json'), next)
    return next
  }

  deleteProject(id: string): void {
    rmSync(this.projectDir(id), { recursive: true, force: true })
  }

  // ---- flows -------------------------------------------------------------------------------

  private flowFiles(projectId: string): string[] {
    const dir = this.flowsDir(projectId)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  }

  listFlows(projectId: string): FlowSummary[] {
    const last = new Map<string, RunSummary>()
    for (const r of this.listRuns(projectId)) if (!last.has(r.flowId) && r.status !== 'running' && r.status !== 'queued') last.set(r.flowId, r)
    return this.flowFiles(projectId)
      .map((f) => readJson<Flow>(join(this.flowsDir(projectId), f)))
      .map((f) => {
        const r = last.get(f.id)
        return {
          id: f.id,
          projectId: f.projectId,
          name: f.name,
          tags: f.tags,
          version: f.version,
          updatedAt: f.updatedAt,
          stepCount: f.steps.length,
          ...(r ? { lastRun: { id: r.id, status: r.status, startedAt: r.startedAt, durationMs: r.durationMs, failedStep: r.failedStep } } : {})
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private findFlowFile(projectId: string, flowId: string): string {
    for (const f of this.flowFiles(projectId)) {
      const path = join(this.flowsDir(projectId), f)
      if (readJson<Flow>(path).id === flowId) return path
    }
    throw new Error(`Flow not found: ${flowId}`)
  }

  getFlow(projectId: string, flowId: string): Flow {
    return readJson<Flow>(this.findFlowFile(projectId, flowId))
  }

  /** Writes a new flow plus its per-step snapshots. Returns the saved flow. */
  createFlow(flow: Omit<Flow, 'id' | 'version' | 'createdAt' | 'updatedAt'>, artifacts: Map<string, StepArtifacts>): Flow {
    const dir = this.flowsDir(flow.projectId)
    mkdirSync(dir, { recursive: true })
    const taken = new Set(this.listFlows(flow.projectId).map((f) => f.name.toLowerCase()))
    if (taken.has(flow.name.toLowerCase())) throw new Error(`A flow named "${flow.name}" already exists in this project`)
    let slug = slugify(flow.name)
    for (let i = 2; existsSync(join(dir, `${slug}.json`)); i++) slug = `${slugify(flow.name)}-${i}`

    const now = new Date().toISOString()
    const saved: Flow = { ...flow, id: newId('flw'), version: 1, createdAt: now, updatedAt: now }

    const snapDir = join(dir, slug, 'snapshots')
    for (const step of saved.steps) {
      const a = artifacts.get(step.id)
      if (!a || !step.snapshot) continue
      mkdirSync(snapDir, { recursive: true })
      writeFileSync(join(snapDir, `${step.id}.xml`), a.xml)
      if (a.png) writeFileSync(join(snapDir, `${step.id}.png`), a.png)
      step.snapshot = `${slug}/snapshots/${step.id}`
    }
    writeJson(join(dir, `${slug}.json`), saved)
    return saved
  }

  deleteFlow(projectId: string, flowId: string): void {
    const file = this.findFlowFile(projectId, flowId)
    rmSync(file.replace(/\.json$/, ''), { recursive: true, force: true })
    rmSync(file)
  }

  // ---- runs --------------------------------------------------------------------------------

  /** Run ids sort by start time: run_<base36 ms><random>. */
  newRunId(): string {
    return `run_${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  }

  runDir(projectId: string, runId: string): string {
    if (!/^run_[\w-]+$/.test(runId)) throw new Error(`Bad run id: ${runId}`)
    return join(this.projectDir(projectId), 'runs', runId)
  }

  saveRun(run: Run): void {
    const dir = this.runDir(run.projectId, run.id)
    mkdirSync(dir, { recursive: true })
    writeJson(join(dir, 'report.json'), run)
  }

  writeRunFile(projectId: string, runId: string, name: string, data: Buffer | string): void {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Bad file name: ${name}`)
    const dir = this.runDir(projectId, runId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), data)
  }

  readRunFile(projectId: string, runId: string, name: string): Buffer {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Bad file name: ${name}`)
    return readFileSync(join(this.runDir(projectId, runId), name))
  }

  getRun(projectId: string, runId: string): Run {
    return readJson<Run>(join(this.runDir(projectId, runId), 'report.json'))
  }

  /** Newest first. */
  listRuns(projectId: string, limit = 200): RunSummary[] {
    const dir = join(this.projectDir(projectId), 'runs')
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((d) => d.startsWith('run_') && existsSync(join(dir, d, 'report.json')))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((d) => {
        const { steps, ...rest } = readJson<Run>(join(dir, d, 'report.json'))
        const failed = steps.findIndex((s) => s.status === 'failed')
        return { ...rest, stepCount: steps.length, failedStep: failed >= 0 ? failed + 1 : null }
      })
  }

  // ---- secrets -----------------------------------------------------------------------------

  setSecret(name: string, value: string): void {
    const path = join(this.root, 'secrets.json')
    const all = existsSync(path) ? readJson<Record<string, string>>(path) : {}
    all[name] = value
    writeJson(path, all)
    try {
      chmodSync(path, 0o600)
    } catch {
      // Not supported on every file system; best effort.
    }
  }

  getSecret(name: string): string | undefined {
    const path = join(this.root, 'secrets.json')
    return existsSync(path) ? readJson<Record<string, string>>(path)[name] : undefined
  }
}
