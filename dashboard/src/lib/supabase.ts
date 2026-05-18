import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Anon client — safe for browser. RLS applies.
// Uses @supabase/ssr's cookie-backed session so middleware (and any
// future Server Component) can see the user via cookies. The API is
// identical to @supabase/supabase-js's createClient — `.auth.*` and
// `.from(...)` work the same way for all existing callers.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

// Service-role client — server-side only. Bypasses RLS.
// Never import into a Client Component: the service-role key would do nothing
// in the browser (it's not NEXT_PUBLIC_, so it's undefined client-side) but the
// import path can mask intent. Default to this for route handlers and Server
// Components that need privileged reads/writes.
let _serverClient: SupabaseClient | null = null

export function serverSupabase(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('serverSupabase() called in browser context — use the anon `supabase` export instead')
  }
  if (_serverClient) return _serverClient
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  _serverClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _serverClient
}

export type Business = {
  id: string
  name: string
  industry: string
  software_stack: string[]
  created_at: string
}

export type Employee = {
  id: string
  business_id: string
  name: string
  role: string
  email?: string | null
  install_token: string
  is_active: boolean
  is_paused: boolean
  invite_sent_at?: string | null
  created_at: string
  agent_version?: string | null
  agent_version_updated_at?: string | null
}

export type CaptureCapabilityTag = {
  id: string
  params?: Record<string, unknown>
  confidence?: number
}

export type CaptureEnrichments = {
  slack?: Record<string, unknown>
  'microsoft-365'?: Record<string, unknown>
  'google-workspace'?: Record<string, unknown>
  [tool: string]: Record<string, unknown> | undefined
}

export type Capture = {
  id: string
  employee_id: string
  business_id: string
  captured_at: string
  task: string
  category: string
  software: string
  activity_level: string
  confidence: number
  automation_potential: string
  workflow_step: string
  trigger: string
  reasoning: string
  flags: string[]
  active_window: string
  active_url: string
  keystrokes: number
  idle_seconds: number
  is_idle: boolean
  capabilities?: CaptureCapabilityTag[] | null
  capture_enrichments?: CaptureEnrichments | null
  /** mss monitor index that was captured. 1 = primary (or fallback when
   *  detection failed), 2+ = secondary monitor that contained the active
   *  window. Null for captures from agents older than v0.5.1. */
  monitor_index?: number | null
}

export type Report = {
  id: string
  business_id: string
  employee_id: string
  report_type: string
  content: string
  period_start: string
  period_end: string
  total_captures: number
  created_at: string
}
