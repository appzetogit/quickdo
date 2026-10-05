import { BrowserRouter, HashRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { StrictMode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { store } from './store'
import { SettingsProvider } from '../modules/Taxi/shared/context/SettingsContext'

function shouldUseHashRouter() {
  if (typeof window === 'undefined') return false

  const protocol = String(window.location?.protocol || '').toLowerCase()
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase()

  return (
    Boolean(window.flutter_inappwebview) ||
    Boolean(window.ReactNativeWebView) ||
    protocol === 'file:' ||
    userAgent.includes(' wv') ||
    userAgent.includes('; wv')
  )
}

export function AppProviders({ children }) {
  const Router = shouldUseHashRouter() ? HashRouter : BrowserRouter

  return (
    <StrictMode>
      <ReduxProvider store={store}>
        <Router>
          <SettingsProvider>
            {children}
          </SettingsProvider>
          <Toaster position="top-center" richColors offset="80px" closeButton />
        </Router>
      </ReduxProvider>
    </StrictMode>
  )
}

