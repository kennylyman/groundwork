import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

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
  install_token: string
  is_active: boolean
  created_at: string
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
