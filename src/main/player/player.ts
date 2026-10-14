// Replays one flow on a device, step by step (spec section 5).
// Elements are found in UI snapshots with the recorded locators (first match wins), actions are
// performed over adb, and a screenshot is saved after every step (plus the UI XML on failure).

import type { Flow, Run, RunStepResult, ScreenInfo, Step } from '@shared/types'
import { KEYCODES, type DeviceShell } from '../adb/adb'
import { center, locate } from '../hierarchy/locate'
import type { HierarchySource } from '../hierarchy/source'
import { descendantText, parseHierarchy, type UiNode, type UiTree } from '../hierarchy/tree'

export interface PlayerOptions {
  /** Keep going after a failed step (spec default: stop at the first failure). */
  continueOnFailure?: boolean
  /** Pause after each action so the next lookup sees the new screen. */
  settleMs?: number
  /** Delay between snapshot polls while waiting for an element. */
  pollMs?: number
}

export interface PlayerDeps {
  sh: DeviceShell
  source: HierarchySource
  screen: ScreenInfo
  /** Value of ${secret:key}. */
  secret: (key: string) => string | undefined
  /** Saves a file into the run folder. */
  writeFile: (name: string, data: Buffer | string) => void
  /** Called whenever the run changes, for live progress. */
  onProgress: (run: Run) => void
  aborted: () => boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const KEYS: Record<string, number> = { ...KEYCODES, recents: 187 }

class StepError extends Error {}

export function resolveText(text: string, flow: Flow, secret: (key: string) => string | undefined): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = flow.variables[name]
    if (v === undefined) throw new StepError(`Variable \${${name}} is not defined in this flow`)
    const sec = v.match(/^\$\{secret:([^}]+)\}$/)
    if (!sec) return v
    const value = secret(sec[1])
    if (value === undefined) throw new StepError(`Secret "${sec[1]}" for \${${name}} is not stored on this computer`)
    return value
  })
}

export class FlowPlayer {
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly settleMs: number
  private readonly pollMs: number
  private lastTree: { tree: UiTree; xml: string } | null = null

  constructor(
    private readonly deps: PlayerDeps,
    private readonly opts: PlayerOptions = {}
  ) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.settleMs = opts.settleMs ?? 600
    this.pollMs = opts.pollMs ?? 300
  }

  async run(flow: Flow, run: Run): Promise<Run> {
    const t0 = this.now()
    run.status = 'running'
    run.steps = flow.steps.map((s) => ({ stepId: s.id, status: 'pending' }))
    this.deps.onProgress(run)

    let failed = false
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i]
      const res = run.steps[i]
      if (this.deps.aborted()) {
        run.status = 'aborted'
        break
      }
      if (failed && !this.opts.continueOnFailure) {
        res.status = 'skipped'
        continue
      }
      res.status = 'running'
      this.deps.onProgress(run)
      const s0 = this.now()
      try {
        if (step.waitBeforeMs) await this.sleep(step.waitBeforeMs)
        const out = await this.execute(step, flow)
        res.status = out.warning ? 'warning' : 'passed'
        if (out.locatorUsed) res.locatorUsed = out.locatorUsed
        if (out.warning) res.warning = out.warning
      } catch (e) {
        failed = true
        res.status = 'failed'
        res.error = (e as Error).message
        if (this.lastTree) {
          res.hierarchy = `${step.id}.xml`
          this.deps.writeFile(res.hierarchy, this.lastTree.xml)
        }
      }
      res.durationMs = this.now() - s0
      await this.capture(res, step)
      this.deps.onProgress(run)
    }

    if (run.status !== 'aborted') run.status = failed ? 'failed' : 'passed'
    if (run.status === 'aborted') for (const r of run.steps) if (r.status === 'pending' || r.status === 'running') r.status = 'skipped'
    if (failed) run.error = run.steps.find((r) => r.status === 'failed')?.error
    run.durationMs = this.now() - t0
    this.deps.onProgress(run)
    return run
  }

  private async capture(res: RunStepResult, step: Step): Promise<void> {
    try {
      const png = await this.deps.sh.screencap()
      res.screenshot = `${step.id}.png`
      this.deps.writeFile(res.screenshot, png)
    } catch {
      // A missing screenshot shouldn't fail the step.
    }
  }

  private async snapshot(): Promise<{ tree: UiTree; xml: string }> {
    const xml = await this.deps.source.dump()
    this.lastTree = { tree: parseHierarchy(xml), xml }
    return this.lastTree
  }

  /** Polls snapshots until a locator matches (and `accept` agrees) or the step times out. */
  private async waitFor(step: Step, accept: (n: UiNode) => boolean = () => true): Promise<{ node: UiNode; strategy: string } | null> {
    const locators = step.target?.locators ?? []
    if (!locators.length) return null
    const deadline = this.now() + step.timeoutMs
    for (;;) {
      const { tree } = await this.snapshot()
      const hit = locate(tree, locators)
      if (hit && accept(hit.node)) return { node: hit.node, strategy: hit.locator.strategy }
      if (this.now() >= deadline) return null
      await this.sleep(this.pollMs)
    }
  }

  private point(p: { xPct: number; yPct: number }): { x: number; y: number } {
    return { x: Math.round(p.xPct * this.deps.screen.w), y: Math.round(p.yPct * this.deps.screen.h) }
  }

  /** Element to act on, falling back to the recorded point (passes with a warning). */
  private async target(step: Step): Promise<{ x: number; y: number; node: UiNode | null; locatorUsed: string; warning?: string }> {
    const hit = await this.waitFor(step)
    if (hit) return { ...center(hit.node), node: hit.node, locatorUsed: hit.strategy }
    if (!step.target) throw new StepError('Step has no target')
    const tried = step.target.locators.map((l) => l.strategy)
    return {
      ...this.point(step.target.fallbackPoint),
      node: null,
      locatorUsed: 'coordinates',
      warning: tried.length
        ? `Element not found after ${step.timeoutMs / 1000}s (tried ${tried.join(', ')}); used the recorded position`
        : 'No locator was recorded; used the recorded position'
    }
  }

  private async settle(): Promise<void> {
    if (this.settleMs) await this.sleep(this.settleMs)
  }

  private async execute(step: Step, flow: Flow): Promise<{ locatorUsed?: string; warning?: string }> {
    const { sh } = this.deps
    const p = step.params ?? {}
    switch (step.action) {
      case 'launchApp': {
        const pkg = String(p.appPackage ?? '')
        if (!pkg) throw new StepError('No app package to launch')
        if (flow.startState.clearData) await sh.shell(`pm clear ${pkg}`)
        else await sh.shell(`am force-stop ${pkg}`)
        await sh.launch(pkg, String(p.appActivity ?? ''))
        await this.settle()
        return {}
      }
      case 'tap':
      case 'longPress': {
        const t = await this.target(step)
        if (step.action === 'tap') await sh.tap(t.x, t.y)
        else await sh.swipe(t.x, t.y, t.x, t.y, Math.max(600, Number(p.durationMs) || 800))
        await this.settle()
        return { locatorUsed: t.locatorUsed, warning: t.warning }
      }
      case 'type': {
        const text = resolveText(String(p.text ?? ''), flow, this.deps.secret)
        let res: { locatorUsed?: string; warning?: string } = {}
        if (step.target) {
          const t = await this.target(step)
          res = { locatorUsed: t.locatorUsed, warning: t.warning }
          await sh.tap(t.x, t.y)
          await this.sleep(250)
          // Clear what is there: jump to the end, then delete each character.
          const len = Math.min(200, Math.max(t.node?.text.length ?? 0, 0))
          if (len) await sh.shell(`input keyevent 123 ${Array(len).fill('67').join(' ')}`)
        }
        if (text) await sh.inputText(text)
        await this.settle()
        return res
      }
      case 'swipe':
      case 'scroll': {
        const from = p.from as { xPct: number; yPct: number } | undefined
        const to = p.to as { xPct: number; yPct: number } | undefined
        if (!from || !to) throw new StepError('Swipe has no start and end points')
        const a = this.point(from)
        const b = this.point(to)
        await sh.swipe(a.x, a.y, b.x, b.y, Math.max(100, Number(p.durationMs) || 300))
        await this.settle()
        return {}
      }
      case 'pressKey': {
        const code = KEYS[String(p.key)]
        if (code === undefined) throw new StepError(`Unknown key "${String(p.key)}"`)
        await sh.keyevent(code)
        await this.settle()
        return {}
      }
      case 'wait':
        await this.sleep(Number(p.ms) || 0)
        return {}
      case 'assertVisible': {
        const hit = await this.waitFor(step)
        if (!hit) throw new StepError(`Element not visible after ${step.timeoutMs / 1000}s`)
        return { locatorUsed: hit.strategy }
      }
      case 'assertText': {
        const expected = resolveText(String(p.text ?? ''), flow, this.deps.secret)
        const textOf = (n: UiNode): string => n.text || descendantText(n)
        const hit = await this.waitFor(step, (n) => textOf(n) === expected)
        if (hit) return { locatorUsed: hit.strategy }
        const seen = this.lastTree && locate(this.lastTree.tree, step.target?.locators ?? [])
        throw new StepError(
          seen ? `Expected text "${expected}" but found "${textOf(seen.node)}"` : `Element with text "${expected}" not found after ${step.timeoutMs / 1000}s`
        )
      }
    }
  }
}
