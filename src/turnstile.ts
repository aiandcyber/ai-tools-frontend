import { TURNSTILE_SITEKEY } from './config'

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

function loadTurnstile(): Promise<TurnstileApi> {
  const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const done = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
      if (api) resolve(api)
      else reject(new Error('CAPTCHA did not load'))
    }
    const found = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (found) {
      found.addEventListener('load', done, { once: true })
      found.addEventListener('error', () => reject(new Error('CAPTCHA did not load')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.dataset.turnstile = '1'
    script.onload = done
    script.onerror = () => reject(new Error('CAPTCHA did not load'))
    document.head.appendChild(script)
  })
}

/** Invisible Turnstile token for a named action (e.g. search). Empty when sitekey unset. */
export async function getTurnstileToken(action: string): Promise<string> {
  if (!TURNSTILE_SITEKEY) return ''
  const api = await loadTurnstile()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden'
  document.body.appendChild(host)
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (value: string, err?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      try {
        if (widgetId) api.remove(widgetId)
      } catch {
        /* ignore */
      }
      host.remove()
      if (err) reject(err)
      else resolve(value)
    }
    const timer = window.setTimeout(() => finish('', new Error('CAPTCHA timed out')), 20000)
    let widgetId = ''
    try {
      widgetId = api.render(host, {
        sitekey: TURNSTILE_SITEKEY,
        action,
        size: 'invisible',
        callback: (token: string) => finish(token || ''),
        'error-callback': () => finish('', new Error('CAPTCHA failed')),
        'expired-callback': () => finish('', new Error('CAPTCHA expired')),
      })
      try {
        api.execute(widgetId)
      } catch {
        /* some sitekeys auto-run on render */
      }
    } catch (exc) {
      finish('', exc instanceof Error ? exc : new Error('CAPTCHA failed'))
    }
  })
}
