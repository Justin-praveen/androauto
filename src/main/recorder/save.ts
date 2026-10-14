// Builds the Flow written on "Stop & save": applies variables and secrets (spec 4.5).

import type { Device, Flow, Project, SaveFlowRequest, Step } from '@shared/types'
import { slugify } from '../store'

export interface BuiltFlow {
  flow: Omit<Flow, 'id' | 'version' | 'createdAt' | 'updatedAt'>
  /** secret key -> value, to store outside the flow file. */
  secrets: Record<string, string>
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function buildFlow(project: Project, device: Device | null, steps: Step[], req: SaveFlowRequest): BuiltFlow {
  const name = req.name.trim()
  if (!name) throw new Error('Flow name is required')
  if (!steps.length) throw new Error('Nothing was recorded')

  const variables: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  const used = new Set<string>()
  const unique = (base: string): string => {
    let n = base
    for (let i = 2; used.has(n); i++) n = `${base}${i}`
    used.add(n)
    return n
  }

  const out: Step[] = steps.map((s) => structuredClone(s))
  for (const step of out) {
    if (step.action !== 'type') continue
    const requested = req.variables[step.id]?.trim()
    if (requested && !VAR_NAME.test(requested))
      throw new Error(`"${requested}" is not a valid variable name (letters, digits and _ only)`)

    if (step.secret) {
      const value = req.secretValues[step.id]
      if (value === undefined || value === '') throw new Error(`Enter the value typed in step ${step.id} (password field)`)
      const varName = unique(requested || 'password')
      const key = `${slugify(project.name).replace(/-/g, '_')}_${varName}`
      secrets[key] = value
      variables[varName] = `\${secret:${key}}`
      step.params = { text: `\${${varName}}` }
    } else if (requested) {
      const varName = unique(requested)
      variables[varName] = String(step.params?.text ?? '')
      step.params = { ...step.params, text: `\${${varName}}` }
    }
  }

  return {
    flow: {
      projectId: project.id,
      name,
      description: req.description.trim(),
      tags: [...new Set(req.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
      recordedOn: device?.screen
        ? { serial: device.serial, model: device.model, screen: { w: device.screen.w, h: device.screen.h } }
        : null,
      startState: { launchApp: out[0]?.action === 'launchApp', clearData: project.launchOptions.clearDataBeforeRun },
      variables,
      steps: out
    },
    secrets
  }
}
