/**
 * Conversational business intake — one turn at a time.
 *
 * Stateless: the client owns the transcript and the in-progress profile,
 * sends both on each turn. We forward to Claude with tool-use; Claude either
 * calls `update_profile_fields` (zero or more times) + `ask_clarifying_question`,
 * or `signal_intake_complete`. We apply updates and return the next turn.
 *
 * No DB writes here — the profile only gets persisted when /api/intake/complete
 * fires. That keeps this endpoint a pure function.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage, BusinessProfileDraft } from '@/lib/intake-types'

export const maxDuration = 30

const MODEL = 'claude-sonnet-4-20250514'

// Cap transcript size sent to the model so cost stays bounded on long chats.
// Pairs with a smaller summary slot the client could send later (not in v1).
const MAX_TRANSCRIPT_MESSAGES = 30

const SYSTEM_PROMPT = `You are the Groundwork onboarding agent. Your job is to interview a business owner for ~5 minutes and build a structured profile of their business that will sharpen everything Groundwork does downstream — classifying employee work, surfacing automation opportunities, generating SOPs.

You are warm, fast, and practical. You ask one clear question at a time. You never ask the owner something you can already answer from what they've said. You build the profile incrementally — calling update_profile_fields whenever you learn something concrete, even mid-thought.

THE PROFILE you're building:
- business_name (REQUIRED)
- industry (REQUIRED, e.g. "Home Care", "Real Estate", "Legal", "Accounting")
- sub_industry (a richer description, e.g. "non-medical home care, ~50 caregivers, Medicaid + private pay, Chicago suburbs")
- size_band (rough: "solo", "small (2-10)", "small (10-50)", "medium (50-200)", "large")
- owner_name
- operations_vocab — what they CALL their things. E.g. {"customers": "clients", "contractors": "caregivers", "appointments": "shifts"}. These words show up in employees' screens — getting them right makes classification much sharper.
- tool_stack — apps + what each is used for. E.g. [{"name": "WellSky", "used_for": ["scheduling"]}, {"name": "QuickBooks", "used_for": ["billing", "payroll"]}]
- workflows — named processes they run. E.g. [{"name": "new client intake", "description": "from referral to first visit"}]
- pain_points — what frustrates them. HIGHEST-SIGNAL field for opportunity ranking. Automating something they've already complained about lands much harder than a generic recommendation.
- roles — sketch only; we'll refine with behavior data later. E.g. [{"title": "Scheduler", "responsibilities": ["building weekly caregiver schedules", "handling missed visit exceptions"]}]
- compliance_constraints — e.g. ["HIPAA", "data must stay in WellSky for client records"]

QUESTION ORDER (suggested, not rigid):
1. Business name + what the business does — open-ended.
2. Size (employees, locations).
3. Tools they use — especially "the boring ones — scheduling, billing, payroll, comms."
4. The most repetitive part of their team's day.
5. If you could wave a wand and automate one thing, what would it be?
6. Anything regulatory we should know about?

You always call update_profile_fields BEFORE asking your next question whenever you've learned anything from the most recent message. Be liberal in what you tag — partial info is better than nothing. Set confidence accordingly (high if owner stated it clearly, lower if you're inferring).

CRITICAL CONSTRAINTS:
- DO NOT call signal_intake_complete until business_name and industry are populated.
- DO NOT re-ask things already in the profile unless the owner volunteers a contradiction.
- DO NOT ask more than one question per turn.
- If the owner says "skip" / "I'm done" / "next" / similar — stop interviewing, call signal_intake_complete with a short summary.
- Match the owner's pace. Short answers → short questions. Long, detailed answers → richer follow-ups.
- The very first turn (when transcript is empty), open with a warm greeting and ask for the business name + a one-sentence description.

Pretend the owner is your smart friend who has a small business — that's the right tone.`

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

type TextBlock = {
  type: 'text'
  text: string
}

type ProfileUpdate = {
  field: string
  value: unknown
  confidence?: number
}

function applyUpdates(
  profile: BusinessProfileDraft,
  updates: ProfileUpdate[]
): BusinessProfileDraft {
  const next: BusinessProfileDraft = { ...profile }
  const fc: Record<string, number> = { ...(next.field_confidence || {}) }
  for (const u of updates) {
    if (typeof u.field !== 'string' || !u.field) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(next as any)[u.field] = u.value
    if (typeof u.confidence === 'number') fc[u.field] = u.confidence
  }
  next.field_confidence = fc
  return next
}

function profileSummaryForPrompt(profile: BusinessProfileDraft): string {
  // Compact display of what we know so far, with field_confidence noted.
  // The model uses this to decide what to ask about next.
  const fc = profile.field_confidence || {}
  const rows: string[] = []
  const fields = [
    'business_name', 'owner_name', 'industry', 'sub_industry', 'size_band',
    'operations_vocab', 'tool_stack', 'workflows', 'pain_points', 'roles',
    'compliance_constraints',
  ] as const
  for (const f of fields) {
    const v = profile[f]
    const c = fc[f] !== undefined ? ` (conf ${fc[f]})` : ''
    if (v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0)) {
      rows.push(`  ${f}: (empty)`)
    } else {
      rows.push(`  ${f}${c}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }
  return rows.join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : []
    const profile: BusinessProfileDraft = body?.profile && typeof body.profile === 'object' ? body.profile : {}

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Server: ANTHROPIC_API_KEY not set' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    // Sliding window of recent transcript for cost control.
    const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES)

    // Inject the current profile state as a synthetic system-side
    // observation. Keeps it out of the user-facing transcript but tells
    // the model where we are.
    const profileSummary = profileSummaryForPrompt(profile)
    const userPrefix = `<current_profile_state>
${profileSummary}
</current_profile_state>

The owner's transcript follows.`

    // Build messages: prefix the user prefix into the first user-side message
    // so the model sees current state alongside the conversation.
    const apiMessages: { role: 'user' | 'assistant'; content: string }[] =
      recent.length === 0
        ? [{ role: 'user', content: userPrefix + '\n\n(no messages yet — open the conversation)' }]
        : [
            { role: 'user', content: userPrefix },
            ...recent,
          ]

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'update_profile_fields',
          description:
            "Apply one or more updates to the business profile. Call this whenever you've learned something concrete from the most recent message, before asking your next question.",
          input_schema: {
            type: 'object',
            properties: {
              updates: {
                type: 'array',
                description: 'Array of field updates.',
                items: {
                  type: 'object',
                  properties: {
                    field: {
                      type: 'string',
                      description:
                        'Profile field name. One of: business_name, owner_name, industry, sub_industry, size_band, operations_vocab, tool_stack, workflows, pain_points, roles, compliance_constraints',
                    },
                    value: {
                      description:
                        'New value for the field. String for text fields, object/array for structured fields. Replaces the existing value.',
                    },
                    confidence: {
                      type: 'number',
                      description: '0-1. How sure you are about this value.',
                    },
                  },
                  required: ['field', 'value'],
                },
              },
            },
            required: ['updates'],
          },
        },
        {
          name: 'ask_clarifying_question',
          description:
            'Ask the owner the next question. Use this for every conversational turn (except the rare cases where the right move is to call signal_intake_complete instead).',
          input_schema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The next message to send to the owner. One question, warm tone.',
              },
            },
            required: ['question'],
          },
        },
        {
          name: 'signal_intake_complete',
          description:
            'Signal that you have a good enough sketch of the business and should hand off to the next step. Only call this once business_name and industry are populated, OR the owner explicitly asks to skip/end.',
          input_schema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'One-sentence summary of what you learned, e.g. "50-caregiver home care agency in Chicago suburbs, uses WellSky + QuickBooks, biggest pain is missed-visit notifications."',
              },
            },
            required: ['summary'],
          },
        },
      ],
      messages: apiMessages,
    })

    // Parse response: collect updates, find the question or completion.
    const collectedUpdates: ProfileUpdate[] = []
    let assistantMessage: string | null = null
    let isComplete = false
    let completionSummary: string | null = null

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const tu = block as unknown as ToolUseBlock
        if (tu.name === 'update_profile_fields') {
          const updates = (tu.input as { updates?: ProfileUpdate[] }).updates
          if (Array.isArray(updates)) collectedUpdates.push(...updates)
        } else if (tu.name === 'ask_clarifying_question') {
          const q = (tu.input as { question?: string }).question
          if (typeof q === 'string') assistantMessage = q
        } else if (tu.name === 'signal_intake_complete') {
          isComplete = true
          const s = (tu.input as { summary?: string }).summary
          if (typeof s === 'string') completionSummary = s
        }
      } else if (block.type === 'text') {
        // Model sometimes adds a small text comment alongside tool calls;
        // use it as a fallback message if no ask_clarifying_question fired.
        const tb = block as TextBlock
        if (!assistantMessage && tb.text.trim()) assistantMessage = tb.text.trim()
      }
    }

    const nextProfile = applyUpdates(profile, collectedUpdates)

    if (isComplete && !assistantMessage) {
      assistantMessage =
        completionSummary ||
        "Great — I've got what I need to set up your dashboard. Let's add your team."
    }

    if (!assistantMessage) {
      // Defensive: if the model returned nothing usable, prompt a retry
      // rather than silently breaking the chat.
      assistantMessage =
        "Sorry, I lost my train of thought there. Could you say that again?"
    }

    return NextResponse.json({
      message: assistantMessage,
      profile: nextProfile,
      updates: collectedUpdates,
      is_complete: isComplete,
      completion_summary: completionSummary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('intake/chat: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
