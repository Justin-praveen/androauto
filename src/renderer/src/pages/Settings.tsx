import { useEffect, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import type { AiSettingsView } from '@shared/types'
import { Button, Card, Field, Input, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { cleanError, useAction, useApp } from '../lib/state'

export function SettingsPage() {
  const { toast } = useApp()
  const run = useAction()
  const [saved, setSaved] = useState<AiSettingsView | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.4)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'' | 'models' | 'test' | 'save'>('')
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    void api.invoke('ai:settings').then((s) => {
      setSaved(s)
      setBaseUrl(s.baseUrl)
      setModel(s.model)
      setTemperature(s.temperature)
    })
  }, [])

  const dirty = saved && (baseUrl !== saved.baseUrl || model !== saved.model || temperature !== saved.temperature || apiKey !== '')

  const save = async (): Promise<void> => {
    const s = await api.invoke('ai:saveSettings', { baseUrl: baseUrl.trim(), model: model.trim(), temperature, ...(apiKey ? { apiKey } : {}) })
    setSaved(s)
    setApiKey('')
  }

  const loadModels = (): Promise<unknown> =>
    run(async () => {
      setBusy('models')
      try {
        const list = await api.invoke('ai:models', { baseUrl: baseUrl.trim(), ...(apiKey ? { apiKey } : {}) })
        setModels(list)
        toast(`Found ${list.length} models`, 'ok')
      } finally {
        setBusy('')
      }
    })

  const test = async (): Promise<void> => {
    setBusy('test')
    setTestResult(null)
    try {
      if (dirty) await save()
      const reply = await api.invoke('ai:test')
      setTestResult({ ok: true, msg: `Connected. The model replied: ${reply}` })
    } catch (e) {
      setTestResult({ ok: false, msg: cleanError(e) })
    } finally {
      setBusy('')
    }
  }

  if (!saved) return null
  return (
    <>
      <PageHeader title="Settings" />
      <Card className="max-w-2xl p-6">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <Sparkles size={16} className="text-accent" /> AI provider
        </div>
        <p className="mb-5 text-[13px] text-muted">
          Any OpenAI-compatible API works: OmniRoute, OpenRouter, or a local model server. It is used to suggest test cases from your recorded flows.
        </p>
        <div className="space-y-4">
          <Field label="Base URL" hint="OmniRoute's default is http://localhost:20128/v1. Use your server's address if it runs elsewhere.">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:20128/v1" className="font-mono text-[13px]" />
          </Field>
          <Field label="API key" hint={saved.hasApiKey ? 'A key is saved. Type a new one to replace it.' : 'Create one in your OmniRoute dashboard. Stored only on this computer.'}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={saved.hasApiKey ? '••••••••••••' : 'sk-…'} className="font-mono text-[13px]" />
          </Field>
          <Field label="Model" hint="A model or combo name your gateway knows. Load the list to pick one.">
            <div className="flex gap-2">
              <Input list="ai-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. cc/claude-sonnet-4 or your combo name" className="font-mono text-[13px]" />
              <datalist id="ai-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Button onClick={() => void loadModels()} disabled={!baseUrl || busy !== ''} className="shrink-0">
                {busy === 'models' && <Loader2 size={14} className="animate-spin" />} Load models
              </Button>
            </div>
          </Field>
          <Field label={`Creativity: ${temperature.toFixed(1)}`} hint="Lower gives more predictable test cases, higher gives more unusual ones.">
            <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </Field>
        </div>

        {testResult && (
          <div className={`mt-5 rounded-lg border px-4 py-2.5 text-[13px] ${testResult.ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad'}`}>{testResult.msg}</div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => void test()} disabled={busy !== '' || !baseUrl || !model}>
            {busy === 'test' && <Loader2 size={14} className="animate-spin" />} Test connection
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || busy !== ''}
            onClick={() =>
              run(async () => {
                await save()
                toast('Settings saved', 'ok')
              })
            }
          >
            <Check size={14} /> Save
          </Button>
        </div>
      </Card>
    </>
  )
}
