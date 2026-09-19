// src/lib/supabase.js
// Supabase client singleton — import this everywhere you need DB or auth access.
// Credentials are read from environment variables injected by Vite at build time.
// Never hardcode keys here.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    // Persist session in localStorage — acceptable for non-sensitive session tokens.
    // The session JWT itself is not a secret; RLS enforces data access server-side.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
