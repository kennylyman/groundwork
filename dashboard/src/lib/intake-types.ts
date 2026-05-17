/**
 * Shared types for the conversational business intake flow.
 *
 * The shape here mirrors the business_profiles table columns and the
 * business_context block the classifier reads. When this changes, also
 * update:
 *   - supabase/migrations/0005_business_profiles.sql
 *   - agent/src/classify.py _format_business_context()
 */

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ToolEntry = {
  name: string
  used_for?: string[]
}

export type WorkflowEntry = {
  name: string
  description?: string
}

export type PainPointEntry = {
  description: string
  severity?: 'high' | 'medium' | 'low'
}

export type RoleEntry = {
  title: string
  responsibilities?: string[]
}

export type BusinessProfileDraft = {
  // The minimum required to create a business
  business_name?: string
  owner_name?: string

  // Structured profile fields
  industry?: string
  sub_industry?: string
  size_band?: string
  operations_vocab?: Record<string, string>
  tool_stack?: ToolEntry[]
  workflows?: WorkflowEntry[]
  pain_points?: PainPointEntry[]
  roles?: RoleEntry[]
  compliance_constraints?: string[]

  // Per-field confidence (0..1) — used by the agent to know what to dig into
  field_confidence?: Record<string, number>
}

export const REQUIRED_FIELDS = ['business_name', 'industry'] as const

export function isMinimumComplete(p: BusinessProfileDraft): boolean {
  return REQUIRED_FIELDS.every((k) => {
    const v = p[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}
