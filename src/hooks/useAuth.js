import { useState, useEffect, useCallback } from 'react'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Mock auth — localStorage, no external services required
// ---------------------------------------------------------------------------
const MOCK_USERS_KEY   = 'acra_mock_users'
const MOCK_SESSION_KEY = 'acra_mock_session'

function getMockUsers()       { try { return JSON.parse(localStorage.getItem(MOCK_USERS_KEY)   ?? '{}')   } catch { return {} }   }
function saveMockUsers(u)     { localStorage.setItem(MOCK_USERS_KEY,   JSON.stringify(u)) }
function getMockSession()     { try { return JSON.parse(localStorage.getItem(MOCK_SESSION_KEY) ?? 'null') } catch { return null }  }
function saveMockSession(s)   { localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(s)) }

function makeMockSession(email) {
  return { access_token: 'mock-token-' + Date.now(), user: { id: 'mock-' + email, email } }
}

function useMockAuth() {
  const [session, setSession] = useState(() => getMockSession())
  const [loading]             = useState(false)

  const login = useCallback(async ({ email, password }) => {
    const users = getMockUsers()
    if (!users[email] || users[email] !== password) throw new Error('Invalid email or password')
    const s = makeMockSession(email)
    saveMockSession(s); setSession(s)
    return s
  }, [])

  const loginWithGoogle = useCallback(async () => {
    const email = 'google-user@example.com'
    const users = getMockUsers()
    if (!users[email]) { users[email] = 'google'; saveMockUsers(users) }
    const s = makeMockSession(email)
    saveMockSession(s); setSession(s)
  }, [])

  const register = useCallback(async ({ email, password }) => {
    const users = getMockUsers()
    if (users[email]) throw new Error('User already registered')
    users[email] = password; saveMockUsers(users)
    return { user: { email } }
  }, [])

  const logout = useCallback(async () => { saveMockSession(null); setSession(null) }, [])

  return { session, loading, login, loginWithGoogle, register, logout }
}

// ---------------------------------------------------------------------------
// Real Supabase auth
// ---------------------------------------------------------------------------
function useSupabaseAuth() {
  const [session, setSession] = useState(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Skip if Supabase is not configured — prevents network errors in dev
    if (!SUPABASE_CONFIGURED) { setLoading(false); return }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const login = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }, [])

  const loginWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) throw error
  }, [])

  const register = useCallback(async ({ email, password }) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    return data
  }, [])

  const logout = useCallback(async () => { await supabase.auth.signOut() }, [])

  return { session, loading, login, loginWithGoogle, register, logout }
}

// ---------------------------------------------------------------------------
// Export whichever implementation is active — determined once at module load
// so the hook identity is stable across renders (no conditional hook calls)
// ---------------------------------------------------------------------------
export function useAuth() {
  const mock = useMockAuth()
  const real = useSupabaseAuth()
  // SUPABASE_CONFIGURED is a module-level constant — safe to branch here
  return SUPABASE_CONFIGURED ? real : mock
}
