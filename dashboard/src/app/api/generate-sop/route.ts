import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { serverSupabase } from '@/lib/supabase'
import { resolveEmployeeOwner } from '@/lib/auth'

// Long-running LLM call. Default Vercel serverless timeout is 10s on Hobby;
// 60s should comfortably fit a sonnet generation.
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM_PROMPT = `You are an operations consultant writing Standard Operating Procedures (SOPs) for a home care agency. You are given a series of captures from an employee's screen during the last 7 days — each capture contains the active window, software in use, classified task, reasoning, and signals like keystroke/idle counts.

Your job is to synthesize these captures into a clear, professional SOP that a brand-new frontline employee could follow on day one to perform this category of work correctly.

Write in plain, direct language. Avoid corporate jargon. Each step must start with a verb, be concrete, and reference the specific software where relevant. The SOP should feel like a real operations document a business owner could hand to a new hire on their first day.

Do NOT include automation suggestions, ROI commentary, or owner-facing analysis — this document is for the person doing the work, not for the person paying for it.

Output ONLY valid JSON in this exact shape — no preamble, no markdown fences, no commentary:
{
  "title": "Short title for this SOP (5-10 words)",
  "overview": "2-3 sentences: what this procedure accomplishes and why it matters to the business",
  "trigger": "What event, schedule, or condition starts this procedure",
  "steps": ["1. Verb-first step…", "2. Verb-first step…", "…"],
  "software": ["Distinct app or tool name", "…"],
  "time_estimate": "Typical duration with a range, e.g. '15-20 minutes'"
}

If the captures are sparse, low-confidence, or don't clearly describe a procedure, still produce the best SOP you can from what's there — but in "overview", note candidly that the source data was limited and what would help (e.g. "more captures of this task type, or a recorded walkthrough"). Never refuse.`

type CaptureRow = {
  task: string | null
  software: string | null
  workflow_step: string | null
  trigger: string | null
  reasoning: string | null
  active_window: string | null
  active_url: string | null
  keystrokes: number | null
  mouse_clicks: number | null
  copy_paste_events: number | null
  idle_seconds: number | null
  captured_at: string
}

type Sop = {
  title: string
  overview: string
  trigger: string
  steps: string[]
  software: string[]
  time_estimate: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const employeeId = body?.employeeId
    const category = body?.category

    if (typeof employeeId !== 'string' || !employeeId) {
      return NextResponse.json({ error: 'employeeId (string) required' }, { status: 400 })
    }
    if (typeof category !== 'string' || !category) {
      return NextResponse.json({ error: 'category (string) required' }, { status: 400 })
    }

    // Auth: caller must own the employee's business.
    const ctx = await resolveEmployeeOwner(request, employeeId)
    if (!ctx) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Server: ANTHROPIC_API_KEY not set' }, { status: 500 })
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const supabase = serverSupabase()

    const { data: captures, error: capturesErr } = await supabase
      .from('captures')
      .select(
        'task, software, workflow_step, trigger, reasoning, active_window, active_url, keystrokes, mouse_clicks, copy_paste_events, idle_seconds, captured_at'
      )
      .eq('employee_id', employeeId)
      .eq('category', category)
      .gte('captured_at', sevenDaysAgo)
      .order('captured_at', { ascending: true })
      .limit(200)

    if (capturesErr) {
      return NextResponse.json({ error: capturesErr.message }, { status: 500 })
    }

    if (!captures || captures.length === 0) {
      return NextResponse.json(
        {
          error: 'No captures',
          detail: `No captures for this employee in category "${category}" over the last 7 days.`,
        },
        { status: 404 }
      )
    }

    const { data: employee } = await supabase
      .from('employees')
      .select('name, role')
      .eq('id', employeeId)
      .single()

    const compact = (captures as CaptureRow[]).map((c) => ({
      t: c.captured_at,
      task: c.task,
      software: c.software,
      step: c.workflow_step,
      trigger: c.trigger,
      reasoning: c.reasoning,
      window: c.active_window,
      url: c.active_url,
      kbd: c.keystrokes ?? 0,
      mouse: c.mouse_clicks ?? 0,
      paste: c.copy_paste_events ?? 0,
      idle: c.idle_seconds ?? 0,
    }))

    const userPrompt = `Employee: ${employee?.name ?? 'unknown'} (${employee?.role ?? 'unknown role'})
Category: ${category}
Time window: last 7 days
Captures (${compact.length}):

${JSON.stringify(compact, null, 2)}

Generate the SOP JSON now.`

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Claude returned no text' }, { status: 502 })
    }

    let raw = textBlock.text.trim()
    // Defensive: strip ```json fences if the model adds them despite instructions.
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let sop: Sop
    try {
      sop = JSON.parse(raw)
    } catch (e) {
      console.error('generate-sop: bad JSON from Claude', raw.slice(0, 500))
      return NextResponse.json(
        { error: 'Claude returned invalid JSON', detail: raw.slice(0, 500) },
        { status: 502 }
      )
    }

    return NextResponse.json({
      sop,
      meta: {
        employee: employee?.name,
        category,
        capture_count: compact.length,
        generated_at: new Date().toISOString(),
        model: MODEL,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('generate-sop: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
