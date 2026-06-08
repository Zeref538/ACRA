import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ToastProvider, useToast } from './components/ui/Toast'
import { BulkProvider } from './lib/BulkContext'
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

function MockModeBanner() {
  if (!MOCK_MODE) return null
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-indigo-500/10 border-t border-indigo-500/30 px-4 py-2 text-xs text-indigo-300 text-center">
      Running in local mock mode — auth and job data are stored in your browser. No backend required.
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <BulkProvider>
          <MockModeBanner />
          <AppRoutes />
        </BulkProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
