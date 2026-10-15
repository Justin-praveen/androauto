// Minimal client for any OpenAI-compatible chat API (OmniRoute, OpenRouter, a local LLM server).

import type { AiSettings } from '@shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`
}

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }
}

async function call(fetchFn: FetchLike, url: string, init: Parameters<FetchLike>[1], timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal }).catch((e: Error) => {
      throw new Error(e.name === 'AbortError' ? `The AI did not answer within ${timeoutMs / 1000}s` : `Can't reach ${url}: ${e.message}`)
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = text.slice(0, 300)
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string }
        msg = (typeof j.error === 'string' ? j.error : j.error?.message) || msg
      } catch {
        // not JSON
      }
      if (res.status === 401 || res.status === 403) throw new Error(`The AI server rejected the API key (${res.status}): ${msg}`)
      throw new Error(`AI server error ${res.status}: ${msg}`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('The AI server did not return JSON. Check the base URL ends with /v1')
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function chat(
  s: AiSettings & { apiKey: string },
  messages: ChatMessage[],
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 180000
): Promise<string> {
  if (!s.baseUrl) throw new Error('Set the AI base URL in Settings first')
  if (!s.model) throw new Error('Pick a model in Settings first')
  const body = { model: s.model, messages, temperature: s.temperature, stream: false }
  const json = (await call(fetchFn, endpoint(s.baseUrl, 'chat/completions'), { method: 'POST', headers: headers(s.apiKey), body: JSON.stringify(body) }, timeoutMs)) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[]
  }
  const content = json.choices?.[0]?.message?.content
  const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content
  if (!text) throw new Error('The AI returned an empty answer')
  return text
}

export async function listModels(s: { baseUrl: string; apiKey: string }, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<string[]> {
  if (!s.baseUrl) throw new Error('Set the AI base URL first')
  const json = (await call(fetchFn, endpoint(s.baseUrl, 'models'), { method: 'GET', headers: headers(s.apiKey) }, 20000)) as { data?: { id: string }[] }
  return (json.data ?? []).map((m) => m.id).sort()
}

/** Pulls the first JSON object out of a reply that may be wrapped in prose or ``` fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const src = fenced ? fenced[1] : text
  const start = src.search(/[[{]/)
  if (start < 0) throw new Error('The AI answer had no JSON in it')
  const open = src[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  for (let i = start; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return JSON.parse(src.slice(start, i + 1))
  }
  throw new Error('The AI answer was cut off before the JSON ended. Try fewer test cases or a larger model')
}
