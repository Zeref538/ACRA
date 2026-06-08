import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// Detect placeholder / unconfigured values
export const SUPABASE_CONFIGURED =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('your-project')

// Always create the client so imports never throw.
// When not configured, point at a harmless localhost URL — calls will fail
// gracefully and useAuth will route to mock mode before any call is made.
export const supabase = createClient(
  SUPABASE_CONFIGURED ? supabaseUrl : 'https://placeholder.supabase.co',
  SUPABASE_CONFIGURED ? supabaseAnonKey : 'placeholder-anon-key',
)
