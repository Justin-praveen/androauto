import { useCallback } from 'react'
import { api } from './api'
import { useAction, useApp } from './state'

/** Starts running flows on the selected device and opens the Runs page. */
export function useStartRun() {
  const { project, device, go, openRun } = useApp()
  const run = useAction()
  return useCallback(
    (flowIds: string[]) =>
      run(async () => {
        if (!project) throw new Error('Pick a project first')
        if (!device || device.state !== 'device') throw new Error('Connect a phone to run flows')
        await api.invoke('runs:start', { projectId: project.id, flowIds, serial: device.serial })
        openRun(null)
        go('runs')
      }),
    [project, device, go, openRun, run]
  )
}
