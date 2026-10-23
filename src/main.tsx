import { OverlaysProvider } from '@overlastic/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { invoke, isTauri } from '@tauri-apps/api/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ToastProvider } from './components/toast-provider'
import { queryClient } from './config/client'
import { DesktopEntry } from './ui/login'
import '@/utils/logger'
import './styles/main.css'

async function bootstrap() {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (isTauri()) {
    const { resolveTheme } = await import('./hooks/use-theme-adaptive')
    const preference = await invoke<'dark' | 'light' | 'system'>('get_dsh_theme').catch(() => undefined)
    document.documentElement.dataset.theme = resolveTheme(preference, systemDark)
    await import('./i18n')
  }
  else {
    const [{ default: i18next }, { initReactI18next }, { resources }] = await Promise.all([
      import('i18next'),
      import('react-i18next'),
      import('./i18n/index.resource'),
    ])
    document.documentElement.dataset.theme = systemDark ? 'dark' : 'light'
    await i18next.use(initReactI18next).init({
      resources,
      lng: navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US',
      fallbackLng: 'zh-CN',
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    })
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <OverlaysProvider>
            <DesktopEntry />
          </OverlaysProvider>
        </ToastProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
