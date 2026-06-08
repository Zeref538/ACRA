import React, { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Globe } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'

export default function LoginPage() {
  const { login, loginWithGoogle, session } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (session) navigate('/dashboard', { replace: true })
  }, [session, navigate])

  useEffect(() => {
    if (params.get('expired') === '1') {
      toast('Session expired. Please sign in again.', 'warning')
    }
  }, []) // intentionally empty — only on mount

  function validate() {
    const e = {}
    if (!email) e.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email address'
    if (!password) e.password = 'Password is required'
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const msg = err.message?.toLowerCase() ?? ''
      if (msg.includes('invalid') || msg.includes('credentials')) {
        setErrors({ password: 'Invalid email or password' })
      } else {
        toast('Network error. Please try again.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    try {
      await loginWithGoogle()
    } catch {
      toast('Could not connect to Google. Please try again.', 'error')
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'rgb(var(--bg-base))' }}
    >
      {/* Ambient glow — decorative only */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(6,148,185,0.10) 0%, transparent 70%)',
        }}
      />

      <div className="w-full max-w-md relative">
        {/* Brand mark */}
        <div className="text-center mb-8 flex flex-col items-center gap-2">
          {/* Spectral dots — CVD channels ACRA works with (decorative) */}
          <div aria-hidden="true" className="flex items-center gap-1.5 mb-2">
            <span className="w-3 h-3 rounded-full" style={{ background: 'rgba(249,115,22,0.85)', filter: 'blur(0.5px)' }} />
            <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'rgba(6,148,185,0.9)' }} />
            <span className="w-3 h-3 rounded-full" style={{ background: 'rgba(245,158,11,0.85)', filter: 'blur(0.5px)' }} />
          </div>
          <h1 className="brand-logotype text-3xl text-text-primary">ACRA</h1>
          <p className="text-text-muted text-sm">Color accessibility for everyone.</p>
        </div>

        <div
          className="rounded-xl shadow-card overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, rgba(22,34,56,0.95) 0%, rgba(11,18,40,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="spectrum-line" aria-hidden="true" />
          <div className="p-8">
          <h2 className="font-heading font-semibold text-xl text-text-primary mb-6">Sign in</h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                if (!email) setErrors((p) => ({ ...p, email: 'Email is required' }))
                else if (!/\S+@\S+\.\S+/.test(email)) setErrors((p) => ({ ...p, email: 'Enter a valid email address' }))
                else setErrors((p) => { const n = { ...p }; delete n.email; return n })
              }}
              error={errors.email}
              placeholder="you@example.com"
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => {
                if (!password) setErrors((p) => ({ ...p, password: 'Password is required' }))
                else setErrors((p) => { const n = { ...p }; delete n.password; return n })
              }}
              error={errors.password}
              placeholder="••••••••"
              required
            />
            <Button type="submit" variant="primary" fullWidth loading={loading} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border-default" />
            <span className="text-xs text-text-muted">or</span>
            <div className="flex-1 h-px bg-border-default" />
          </div>

          <Button variant="secondary" fullWidth onClick={handleGoogle}>
            <Globe size={16} aria-hidden="true" />
            Continue with Google
          </Button>

          <p className="text-sm text-center text-text-muted mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary hover:text-primary-hover transition-colors">
              Register
            </Link>
          </p>
          </div>{/* end p-8 */}
        </div>{/* end glass card */}
      </div>{/* end max-w-md */}
    </div>
  )
}
