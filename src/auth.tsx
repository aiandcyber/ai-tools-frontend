import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { useEffect, type ReactNode } from 'react'
import { setAccessTokenGetter } from './api'
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_DOMAIN, AUTH_CONFIGURED } from './config'
import { AuthActionProvider } from './useRequireAuth'

function TokenBridge() {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0()
  useEffect(() => {
    if (!isAuthenticated) {
      setAccessTokenGetter(null)
      return
    }
    setAccessTokenGetter(async () => {
      try {
        return (
          (await getAccessTokenSilently({ authorizationParams: { audience: AUTH0_AUDIENCE } })) ?? ''
        )
      } catch {
        // Consent / iframe / network failures must not block chat or tools.
        return ''
      }
    })
    return () => setAccessTokenGetter(null)
  }, [getAccessTokenSilently, isAuthenticated])
  return null
}

export function AuthShell({ children }: { children: ReactNode }) {
  if (!AUTH_CONFIGURED) {
    return <AuthActionProvider>{children}</AuthActionProvider>
  }
  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin, audience: AUTH0_AUDIENCE }}
      cacheLocation="localstorage"
    >
      <TokenBridge />
      <AuthActionProvider>{children}</AuthActionProvider>
    </Auth0Provider>
  )
}

export function useOptionalAuth() {
  if (!AUTH_CONFIGURED) {
    return { configured: false, isAuthenticated: false, login: () => {}, logout: () => {} }
  }
  const auth = useAuth0()
  return {
    configured: true,
    isAuthenticated: auth.isAuthenticated,
    login: () => auth.loginWithRedirect({
      appState: { returnTo: window.location.pathname + window.location.search },
    }),
    logout: () => auth.logout({ logoutParams: { returnTo: window.location.origin } }),
  }
}
