import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ToastProvider, useToast } from './components/ui/Toast'
import { BulkProvider } from './lib/BulkContext'
import { isApiConfigured } from './lib/api'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import SinglePage from './pages/SinglePage'
import BulkPage from './pages/BulkPage'
import ResultsPage from './pages/ResultsPage'
import HistoryPage from './pages/HistoryPage'
import TestLabPage from './pages/TestLabPage'
import DemoPage from './pages/DemoPage'

function AuthGuard({ children }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center" aria-busy="true">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <p className="text-text-muted text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/" replace />
  return children
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const MOCK_MODE = !SUPABASE_URL || SUPABASE_URL.includes('your-project')

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<AuthGuard><DashboardPage /></AuthGuard>} />
      <Route path="/single"    element={<AuthGuard><SinglePage /></AuthGuard>} />
      <Route path="/bulk"      element={<AuthGuard><BulkPage /></AuthGuard>} />
      <Route path="/results/:jobId" element={<AuthGuard><ResultsPage /></AuthGuard>} />
      <Route path="/history"   element={<AuthGuard><HistoryPage /></AuthGuard>} />
      <Route path="/test"      element={<AuthGuard><TestLabPage /></AuthGuard>} />
      <Route path="/demo"      element={<AuthGuard><DemoPage /></AuthGuard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function DevModeBanner() {
  const authMock = MOCK_MODE
  const apiMock = !isApiConfigured
  if (!authMock && !apiMock) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-4 py-2 text-xs text-center border-t">
      {apiMock && (
        <div className="bg-orange-500/15 border-orange-500/40 text-orange-200 py-1.5 px-3 rounded mb-1">
          Pipeline offline — uploads are not processed. Add{' '}
          <code className="font-mono">VITE_API_URL=http://localhost:8000</code> to{' '}
          <code className="font-mono">.env.local</code>, run the backend, then restart Vite.
        </div>
      )}
      {authMock && (
        <div className="bg-indigo-500/10 border-indigo-500/30 text-indigo-300 py-1.5">
          Auth mock mode — accounts are stored in this browser only.
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <BulkProvider>
          <DevModeBanner />
          <AppRoutes />
        </BulkProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
