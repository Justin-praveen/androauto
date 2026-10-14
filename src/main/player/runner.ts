// Runs a batch of flows one after another on one device and reports live progress.

import { EventEmitter } from 'node:events'
import type { BatchStatus, Flow, Run, ScreenInfo } from '@shared/types'
import type { AppiumManager } from '../appium-manager'
import type { DeviceManager } from '../device-manager'
import { AdbDumpSource, AppiumSource, type HierarchySource } from '../hierarchy/source'
import type { RecorderService } from '../recorder/service'
import type { Store } from '../store'
import { FlowPlayer, type PlayerOptions } from './player'

export class RunService extends EventEmitter {
  private batch: BatchStatus | null = null
  private abortFlag = false

  constructor(
    private readonly devices: DeviceManager,
    private readonly appium: AppiumManager,
    private readonly recorder: RecorderService,
    private readonly store: Store,
    private readonly playerOpts: PlayerOptions = {}
  ) {
    super()
  }

  status(): BatchStatus | null {
    return this.batch
  }

  private emitStatus(): void {
    if (this.batch) this.emit('status', structuredClone(this.batch))
  }

  /** Starts running the flows in the given order. Resolves once the batch is queued. */
  start(opts: { projectId: string; flowIds: string[]; serial: string; continueOnFailure?: boolean }): BatchStatus {
    if (this.batch?.state === 'running') throw new Error('A run is already in progress')
    if (this.recorder.status().state !== 'idle') throw new Error('Finish or discard the recording first')
    if (!opts.flowIds.length) throw new Error('Pick at least one flow to run')
    const device = this.devices.get(opts.serial)
    if (!device || device.state !== 'device' || !device.screen) throw new Error('Device is not connected')

    const flows = opts.flowIds.map((id) => this.store.getFlow(opts.projectId, id))
    const batchId = `bat_${Date.now().toString(36)}`
    const runs: Run[] = flows.map((f) => ({
      id: this.store.newRunId(),
      projectId: opts.projectId,
      flowId: f.id,
      flowName: f.name,
      flowVersion: f.version,
      device: device.serial,
      deviceModel: device.model,
      status: 'queued',
      startedAt: '',
      durationMs: 0,
      steps: f.steps.map((s) => ({ stepId: s.id, status: 'pending' })),
      batchId
    }))
    // Ids made in the same millisecond still need distinct folders.
    runs.forEach((r, i) => (r.id = `${r.id}${String(i).padStart(2, '0')}`))

    this.abortFlag = false
    this.batch = { id: batchId, projectId: opts.projectId, serial: device.serial, state: 'running', startedAt: Date.now(), finishedAt: null, runs, current: 0 }
    this.emitStatus()

    const queued = structuredClone(this.batch)
    void this.execute(flows, runs, device.screen, opts.continueOnFailure ?? false)
    return queued
  }

  abort(): BatchStatus | null {
    if (this.batch?.state === 'running') this.abortFlag = true
    return this.batch
  }

  private async execute(flows: Flow[], runs: Run[], screen: ScreenInfo, continueOnFailure: boolean): Promise<void> {
    const batch = this.batch!
    const sh = this.devices.shell(batch.serial)
    let source: HierarchySource | null = null
    try {
      source = this.appium.running ? await AppiumSource.open(this.appium.url!, batch.serial).catch(() => new AdbDumpSource(sh)) : new AdbDumpSource(sh)
      for (let i = 0; i < flows.length; i++) {
        batch.current = i
        const run = runs[i]
        if (this.abortFlag) {
          run.status = 'aborted'
          run.steps.forEach((s) => (s.status = 'skipped'))
          this.store.saveRun(run)
          continue
        }
        run.startedAt = new Date().toISOString()
        const player = new FlowPlayer(
          {
            sh,
            source,
            screen,
            secret: (k) => this.store.getSecret(k),
            writeFile: (name, data) => this.store.writeRunFile(run.projectId, run.id, name, data),
            onProgress: () => this.emitStatus(),
            aborted: () => this.abortFlag
          },
          { ...this.playerOpts, continueOnFailure }
        )
        try {
          await player.run(flows[i], run)
        } catch (e) {
          run.status = 'failed'
          run.error = (e as Error).message
        }
        this.store.saveRun(run)
        this.emitStatus()
      }
    } catch (e) {
      for (const r of runs) {
        if (r.status === 'queued' || r.status === 'running') {
          r.status = 'failed'
          r.error = (e as Error).message
          this.store.saveRun(r)
        }
      }
    } finally {
      await source?.close()
      batch.state = this.abortFlag ? 'aborted' : 'done'
      batch.finishedAt = Date.now()
      this.emitStatus()
    }
  }
}
