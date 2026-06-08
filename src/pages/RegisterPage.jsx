import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { CheckCircle } from 'lucide-react'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function validate() {
    const e = {}
    if (!email) e.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Enter a valid email address'
    if (!password) e.password = 'Password is required'
    else if (password.length < 8) e.password = 'Password must be at least 8 characters'
    if (!confirm) e.confirm = 'Please confirm your password'
    else if (confirm !== password) e.confirm = 'Passwords do not match'
    return e
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    try {
      await register({ email, password })
      setSuccess(true)
    } catch (err) {
      const msg = err.message?.toLowerCase() ?? ''
      if (msg.includes('already')) {
        setErrors({ email: 'An account with this email already exists' })
      } else {
        toast('Registration failed. Please try again.', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
        style={{ background: 'rgb(var(--bg-base))' }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(6,148,185,0.10) 0%, transparent 70%)',
          }}
        />
        <div className="w-full max-w-md relative">
          <div className="text-center mb-8 flex flex-col items-center gap-2">
            <div aria-hidden="true" className="flex items-center gap-1.5 mb-2">
              <span className="w-3 h-3 rounded-full" style={{ background: 'rgba(249,115,22,0.85)', filter: 'blur(0.5px)' }} />
              <span className="w-3.5 h-3.5 rounded-full" style={{ background: 'rgba(6,148,185,0.9)' }} />
              <span className="w-3 h-3 rounded-full" style={{ background: 'rgba(245,158,11,0.85)', filter: 'blur(0.5px)' }} />
            </div>
            <h1 className="brand-logotype text-3xl text-text-primary">ACRA</h1>
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
            <div className="p-8 flex flex-col items-center gap-4 text-center">
              <CheckCircle size={48} className="text-pass" aria-hidden="true" />
              <h2 className="font-heading font-semibold text-xl text-text-primary">Check your email</h2>
              <p className="text-text-secondary text-sm leading-relaxed">
                We sent a verification link to <strong className="text-text-primary">{email}</strong>.
                Click the link to activate your account, then sign in.
              </p>
              <Button variant="secondary" onClick={() => navigate('/')} className="mt-2">
                Back to sign in
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
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
          <h2 className="font-heading font-semibold text-xl text-text-primary mb-6">Create account</h2>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                if (!email) setErrors((p) => ({ ...p, email: 'Email is required' }))
                else if (!/\S+@\S+\.\S+/.test(email)) setErrors((p) => ({ ...p, email: 'Enter a valid email' }))
                else setErrors((p) => { const n = { ...p }; delete n.email; return n })
              }}
              error={errors.email}
              placeholder="you@example.com"
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => {
                if (!password) setErrors((p) => ({ ...p, password: 'Password is required' }))
                else if (password.length < 8) setErrors((p) => ({ ...p, password: 'Must be at least 8 characters' }))
                else setErrors((p) => { const n = { ...p }; delete n.password; return n })
              }}
              error={errors.password}
              placeholder="Min. 8 characters"
              required
            />
            <Input
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => {
                if (confirm !== password) setErrors((p) => ({ ...p, confirm: 'Passwords do not match' }))
                else setErrors((p) => { const n = { ...p }; delete n.confirm; return n })
              }}
              error={errors.confirm}
              placeholder="••••••••"
              required
            />
            <Button type="submit" variant="primary" fullWidth loading={loading} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
          </form>

          <p className="text-sm text-center text-text-muted mt-6">
            Already have an account?{' '}
            <Link to="/" className="text-primary hover:text-primary-hover transition-colors">
              Sign in
            </Link>
          </p>
          </div>{/* end p-8 */}
        </div>{/* end glass card */}
      </div>{/* end max-w-md */}
    </div>
  )
}
