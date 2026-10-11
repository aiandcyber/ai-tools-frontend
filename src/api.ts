import { apiUrl } from './config'

export type Field = {
  name: string
  label: string
  kind: 'text' | 'textarea' | 'number' | 'select'
  required: boolean
  options: string[]
  default: string
}

export type Tool = {
  id: string
  category: string
  title: string
  description: string
  accept: string
  multiple: boolean
  fields: Field[]
}

export type Catalog = {
  categories: { id: string; title: string }[]
  tools: Tool[]
}

export type Download = { name: string; url: string }

export type SearchHit = {
  title: string
  url: string
  snippet: string
  category?: string
  categories?: string[]
  engine?: string
  engines?: string[]
  host?: string
  region?: string
  regional_score?: number
  relevance_score?: number
  reasons?: string[]
  published?: string
  thumbnail?: string
}

export type SearchMeta = {
  mode?: string
  region?: string
  region_label?: string
  language?: string
  categories?: string[]
  unresponsive?: { engine?: string; reason?: string; category?: string; error?: string }[]
  total_unique?: number
  profile?: { interests?: string[]; industry?: string; location?: string }
}

let tokenGetter: (() => Promise<string>) | null = null

export function setAccessTokenGetter(getter: (() => Promise<string>) | null) {
  tokenGetter = getter
}

/** True when the browser could not reach the API (down, sandbox, CORS, offline). */
export function isBackendUnreachable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    error.name === 'TypeError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('backend unreachable')
  )
}

/** User-facing message instead of the raw browser "Failed to fetch". */
export function formatApiError(error: unknown, fallback = 'Request failed'): string {
  if (isBackendUnreachable(error)) {
    return (
      'Backend unreachable (API not running or not reachable on this host). ' +
      'Start the server on port 8000, then wait — this page will reconnect automatically.'
    )
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

async function headers(): Promise<HeadersInit> {
  if (!tokenGetter) return {}
  try {
    const token = await tokenGetter()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw new Error(formatApiError(error))
  }
}

/** Retry a network call until success or abort (for catalog auto-recover). */
export async function withBackendRetry<T>(
  run: () => Promise<T>,
  options?: {
    signal?: AbortSignal
    onAttempt?: (attempt: number, error: Error) => void
    maxAttempts?: number
    baseDelayMs?: number
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? Number.POSITIVE_INFINITY
  const baseDelayMs = options?.baseDelayMs ?? 2000
  let attempt = 0
  while (true) {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    attempt += 1
    try {
      return await run()
    } catch (error) {
      if (options?.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw error
      }
      const err = error instanceof Error ? error : new Error(String(error))
      options?.onAttempt?.(attempt, err)
      if (!isBackendUnreachable(err) || attempt >= maxAttempts) throw err
      const delay = Math.min(15_000, baseDelayMs * Math.min(attempt, 5))
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          options?.signal?.removeEventListener('abort', onAbort)
          resolve()
        }, delay)
        const onAbort = () => {
          window.clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        options?.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}

export async function fetchCatalog(signal?: AbortSignal): Promise<Catalog> {
  const response = await apiFetch(apiUrl('/api/tools'), { signal })
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

export async function runTool(
  id: string,
  form: FormData,
): Promise<{ message: string; downloads: Download[]; results: SearchHit[]; meta: SearchMeta }> {
  const response = await apiFetch(apiUrl(`/api/tools/${id}`), { method: 'POST', body: form, headers: await headers() })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Tool failed')
  return {
    message: payload.message,
    downloads: payload.downloads || [],
    results: payload.results || [],
    meta: payload.meta || {},
  }
}

export async function sendChat(
  form: FormData,
  signal?: AbortSignal,
): Promise<{ reply: string; downloads: Download[]; llm_provider?: string }> {
  const response = await apiFetch(apiUrl('/api/chat'), {
    method: 'POST',
    body: form,
    headers: await headers(),
    signal,
  })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Assistant failed')
  return payload
}

export async function exportGeneratedText(
  text: string,
  format: string,
): Promise<{ message: string; downloads: Download[] }> {
  const form = new FormData()
  form.set('text', text)
  form.set('format', format)
  const response = await apiFetch(apiUrl('/api/export-text'), {
    method: 'POST',
    body: form,
    headers: await headers(),
  })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Export failed')
  return {
    message: payload.message || 'Exported',
    downloads: payload.downloads || [],
  }
}

/** edge-tts neural speech for agent replies. Returns an object URL for audio/mpeg. */
export async function synthesizeSpeech(text: string, language: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.set('text', text)
  form.set('language', language)
  const response = await apiFetch(apiUrl('/api/tts'), {
    method: 'POST',
    body: form,
    headers: await headers(),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(payload.detail || 'TTS failed')
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export type YoutubeQuality = { id: string; label: string; bytes: number | null }

export async function probeYoutube(
  url: string,
  kind: 'mp4' | 'mp3',
  signal?: AbortSignal,
): Promise<{ title: string; duration: number; kind: string; qualities: YoutubeQuality[] }> {
  const form = new FormData()
  form.set('url', url)
  form.set('kind', kind)
  const response = await apiFetch(apiUrl('/api/youtube/probe'), {
    method: 'POST',
    body: form,
    headers: await headers(),
    signal,
  })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Could not read video info')
  return payload
}
