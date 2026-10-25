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

/** Shown when the service cannot be reached. Keep free of host/port/API wording. */
export const SERVICE_UNAVAILABLE =
  'This service is temporarily unavailable. Please try again in a moment.'
export const SERVICE_RECONNECTING =
  'This service is temporarily unavailable. We will keep trying.'
export const GENERIC_ERROR = 'Something went wrong. Please try again.'

function looksTechnical(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes('<!doctype') ||
    msg.includes('<html') ||
    msg.includes('traceback') ||
    msg.includes('uvicorn') ||
    msg.includes('port 8000') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('backend unreachable') ||
    msg.includes('internal server error') ||
    msg.includes('bad gateway') ||
    msg.includes('not running') ||
    msg.includes('api not') ||
    /^\s*\{/.test(message) ||
    /^\s*</.test(message)
  )
}

function asDetailText(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim()
  if (Array.isArray(detail)) {
    return detail.map((item: { msg?: string }) => item?.msg).filter(Boolean).join(' ').trim()
  }
  return ''
}

/** True when the browser could not reach the API (down, sandbox, CORS, offline). */
export function isBackendUnreachable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    error.name === 'TypeError' ||
    error.name === 'ApiUnreachableError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('backend unreachable') ||
    msg.includes('temporarily unavailable')
  )
}

/** User-facing message. Never expose host, port, stack traces, or HTML. */
export function formatApiError(error: unknown, fallback = GENERIC_ERROR): string {
  if (isBackendUnreachable(error)) return SERVICE_UNAVAILABLE
  if (error instanceof Error && error.message.trim()) {
    return looksTechnical(error.message) ? fallback : error.message.trim()
  }
  return fallback
}

export function userHttpError(status: number, detail: unknown, fallback = GENERIC_ERROR): string {
  if (status >= 500 || status === 0 || status === 408 || status === 429) return SERVICE_UNAVAILABLE
  const text = asDetailText(detail)
  if (status === 401 || status === 403) {
    if (text && !looksTechnical(text)) return text
    return 'Please sign in to continue.'
  }
  if (!text || looksTechnical(text)) return fallback
  return text
}

export const YOUTUBE_BLOCKED =
  'YouTube is blocking your connection. Try later, or send a message to us to investigate.'

export function formatYoutubeError(error: unknown): string {
  if (isBackendUnreachable(error)) return SERVICE_UNAVAILABLE
  const msg = error instanceof Error ? error.message.trim() : String(error || '')
  const lower = msg.toLowerCase()
  if (looksTechnical(msg)) return SERVICE_UNAVAILABLE
  if (lower.includes('paste a youtube') || lower.includes('must be a youtube')) return msg
  return YOUTUBE_BLOCKED
}

export async function submitFeedback(payload: {
  email: string
  topic: string
  youtube_url: string
  message: string
  'cf-turnstile-response'?: string
}): Promise<void> {
  const response = await apiFetch(apiUrl('/api/feedback'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await headers()),
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) {
    throw new Error(userHttpError(response.status, result.detail, 'Could not send the message'))
  }
}

/** Auth0 silent token can hang; never block tool/chat requests on it. */
const TOKEN_WAIT_MS = 2000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function headers(): Promise<HeadersInit> {
  if (!tokenGetter) return {}
  try {
    const token = await withTimeout(tokenGetter(), TOKEN_WAIT_MS)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    const err = new Error(formatApiError(error))
    err.name = isBackendUnreachable(error) ? 'ApiUnreachableError' : 'Error'
    throw err
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
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '' }))
    throw new Error(userHttpError(response.status, payload.detail))
  }
  return response.json()
}

export async function runTool(
  id: string,
  form: FormData,
): Promise<{ message: string; downloads: Download[]; results: SearchHit[]; meta: SearchMeta }> {
  const response = await apiFetch(apiUrl(`/api/tools/${id}`), { method: 'POST', body: form, headers: await headers() })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(userHttpError(response.status, payload.detail, 'That tool could not be completed. Please try again.'))
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
  if (!response.ok) throw new Error(userHttpError(response.status, payload.detail, 'The assistant could not reply. Please try again.'))
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
  if (!response.ok) throw new Error(userHttpError(response.status, payload.detail, 'Could not export. Please try again.'))
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
    throw new Error(userHttpError(response.status, payload.detail, 'Could not play the spoken reply.'))
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
  if (!response.ok) throw new Error(userHttpError(response.status, payload.detail, 'Could not read that video. Please try again.'))
  return payload
}
