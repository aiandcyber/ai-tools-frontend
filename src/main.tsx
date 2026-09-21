import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthShell } from './auth'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthShell>
      <App />
    </AuthShell>
  </StrictMode>,
)
