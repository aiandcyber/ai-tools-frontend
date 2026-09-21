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

async function headers(): Promise<HeadersInit> {
  if (!tokenGetter) return {}
  try {
    const token = await tokenGetter()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(apiUrl('/api/tools'))
  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

export async function runTool(
  id: string,
  form: FormData,
): Promise<{ message: string; downloads: Download[]; results: SearchHit[]; meta: SearchMeta }> {
  const response = await fetch(apiUrl(`/api/tools/${id}`), { method: 'POST', body: form, headers: await headers() })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Tool failed')
  return {
    message: payload.message,
    downloads: payload.downloads || [],
    results: payload.results || [],
    meta: payload.meta || {},
  }
}

export async function sendChat(form: FormData): Promise<{ reply: string; downloads: Download[] }> {
  const response = await fetch(apiUrl('/api/chat'), { method: 'POST', body: form, headers: await headers() })
  const payload = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) throw new Error(payload.detail || 'Assistant failed')
  return payload
}
