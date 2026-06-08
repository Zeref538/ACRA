import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const ToastContext = createContext(null)

const icons = {
  success: <CheckCircle size={16} className="text-sky-400 shrink-0" />,
  error: <AlertCircle size={16} className="text-orange-400 shrink-0" />,
  warning: <AlertTriangle size={16} className="text-amber-400 shrink-0" />,
  info: <Info size={16} className="text-indigo-400 shrink-0" />,
}

const styles = {
  success: 'border-sky-500/30 bg-sky-500/10',
  error: 'border-orange-500/30 bg-orange-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  info: 'border-indigo-500/30 bg-indigo-500/10',
}

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-card text-text-primary text-sm max-w-sm w-full animate-slide-up',
        styles[toast.type] ?? styles.info,
      ].join(' ')}
    >
      {icons[toast.type]}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-text-muted hover:text-text-primary transition-colors shrink-0 mt-0.5"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message, type = 'info') => {
    const id = ++idRef.current
    setToasts((prev) => {
      const next = [...prev, { id, message, type }]
      return next.slice(-3)
    })
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 pointer-events-none"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
