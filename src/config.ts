export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')
export const AUTH0_DOMAIN = (import.meta.env.VITE_AUTH0_DOMAIN ?? '').trim()
export const AUTH0_CLIENT_ID = (import.meta.env.VITE_AUTH0_CLIENT_ID ?? '').trim()
export const AUTH0_AUDIENCE = (import.meta.env.VITE_AUTH0_AUDIENCE ?? '').trim()
export const AUTH_CONFIGURED = Boolean(AUTH0_DOMAIN && AUTH0_CLIENT_ID && AUTH0_AUDIENCE)
export const AUTH_REQUIRED = AUTH_CONFIGURED && import.meta.env.VITE_AUTH_REQUIRED === 'true'
export const TURNSTILE_SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY ?? '').trim()

export function portalUrl(): string {
  const fromEnv = (import.meta.env.VITE_PORTAL_URL ?? '').trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return 'https://ai-forall.org'
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}
