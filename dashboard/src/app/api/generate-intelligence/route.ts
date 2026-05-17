import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { serverSupabase } from '@/lib/supabase'
import { resolveEmployeeOwner } from '@/lib/auth'

export const maxDuration = 60

const MODEL = 'claude-sonnet-4-20250514'

// Agent captures one sample every CAPTURE_INTERVAL_SECONDS — keep in sync
// with agent/src/main.py.
const CAPTURE_INTERVAL_SECONDS = 30
const WORKING_DAYS_PER_YEAR = 250

// Hourly rates resolved through lib/rates: per-business overrides from
// /settings/pricing first, then hardcoded defaults. Server-side computation
// is deterministic — Claude doesn't get to fudge the dollar figure.
import { loadRateOverrides, resolveRate } from '@/lib/rates'

const SYSTEM_PROMPT = `You are a process automation consultant analyzing operational data for a home care agency owner. You are given:
- An employee's role and the category of work being analyzed
- Computed time/cost statistics (already calculated server-side — DO NOT recalculate or contradict them)
- A series of captures showing what they actually did over the last 7 days

Your job: identify the SINGLE highest-leverage automation opportunity, compare this team to industry benchmarks, and estimate implementation effort. Be specific, conservative, and actionable.

Output ONLY valid JSON in this exact shape — no preamble, no markdown fences, no commentary:
{
  "top_opportunity": {
    "title": "Imperative title, 5-10 words (e.g. 'Automate caregiver shift notifications')",
    "description": "2-4 sentences. Describe what is manual today, how it could be automated, and which specific tool/approach would work. Reference specific software names and signals from the captures (e.g. 'copy-pasted 47 times', 'idle while waiting for confirmation').",
    "annual_savings_dollars": 12000,
    "annual_hours_saved": 480,
    "confidence": "high"
  },
  "benchmark": {
    "your_position": "Short label: 'Above industry average' | 'Typical' | 'Below industry average'",
    "comparison": "1-2 sentences comparing this team to typical home care agencies of similar size",
    "best_practice": "1 sentence on what high-performing agencies do for this category"
  },
  "implementation": {
    "effort": "Low",
    "estimated_days": "2-3 days",
    "summary": "1-2 sentences on what it takes — tools (Zapier, Make.com, an SDK, etc), skill level needed, rollout time"
  }
}

Rules:
- annual_hours_saved MUST NOT exceed 80% of the employee's estimated annual hours in this category (you will be given that number).
- annual_savings_dollars = annual_hours_saved × hourly_rate (you will be given the rate).
- confidence: "high" if captures clearly show repetitive patterns; "medium" if patterns are visible but inconsistent; "low" if data is sparse or ambiguous.
- effort: "Low" = no engineering, off-the-shelf tools (Zapier/Make); "Medium" = light scripting or API integration; "High" = custom development or process change requiring training.
- Be conservative. It's better to underpromise on savings.
- If the captures don't surface a clear automation opportunity, return your best guess with confidence "low" and explain candidly in the description what additional data would help. Never refuse.`

type CaptureRow = {
  task: string | null
  software: string | null
  workflow_step: string | null
  trigger: string | null
  reasoning: string | null
  active_window: string | null
  active_url: string | null
  automation_potential: string | null
  keystrokes: number | null
  mouse_clicks: number | null
  copy_paste_events: number | null
  idle_seconds: number | null
  captured_at: string
}

type Analysis = {
  top_opportunity: {
    title: string
    description: string
    annual_savings_dollars: number
    annual_hours_saved: number
    confidence: 'high' | 'medium' | 'low'
  }
  benchmark: {
    your_position: string
    comparison: string
    best_practice: string
  }
  implementation: {
    effort: 'Low' | 'Medium' | 'High'
    estimated_days: string
    summary: string
  }
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

    // Auth: caller must own the employee's business. Blocks anonymous abuse
    // of the Anthropic budget against arbitrary employee_ids.
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
        'task, software, workflow_step, trigger, reasoning, active_window, active_url, automation_potential, keystrokes, mouse_clicks, copy_paste_events, idle_seconds, captured_at'
      )
      .eq('employee_id', employeeId)
      .eq('category', category)
      .gte('captured_at', sevenDaysAgo)
      .order('captured_at', { ascending: true })
      .limit(500)

    if (capturesErr) {
      return NextResponse.json({ error: capturesErr.message }, { status: 500 })
    }

    if (!captures || captures.length === 0) {
      return NextResponse.json(
        {
          error: 'No captures',
          detail: `No captures for this employee in category "${category}" over the last 7 days. Nothing to analyze yet.`,
        },
        { status: 404 }
      )
    }

    const { data: employee } = await supabase
      .from('employees')
      .select('name, role, business_id')
      .eq('id', employeeId)
      .single()

    // --- Compute deterministic cost stats ---
    const captureCount = captures.length
    const totalSeconds = captureCount * CAPTURE_INTERVAL_SECONDS
    const totalHours = totalSeconds / 3600
    const dailyHours = totalHours / 7
    const annualHours = Math.round(dailyHours * WORKING_DAYS_PER_YEAR)
    const overrides = employee?.business_id
      ? await loadRateOverrides(supabase, employee.business_id).catch(() => ({}))
      : {}
    const hourlyRate = resolveRate(employee?.role, overrides)
    const annualCost = Math.round(annualHours * hourlyRate)
    const weeklyHours = Math.round(totalHours * 10) / 10 // 1 decimal

    // Roll up signal stats for the prompt
    const totals = (captures as CaptureRow[]).reduce(
      (a, c) => ({
        keystrokes: a.keystrokes + (c.keystrokes ?? 0),
        mouse_clicks: a.mouse_clicks + (c.mouse_clicks ?? 0),
        copy_paste_events: a.copy_paste_events + (c.copy_paste_events ?? 0),
        idle_seconds: a.idle_seconds + (c.idle_seconds ?? 0),
      }),
      { keystrokes: 0, mouse_clicks: 0, copy_paste_events: 0, idle_seconds: 0 }
    )

    const softwareCount: Record<string, number> = {}
    const automationLevelCount: Record<string, number> = {}
    for (const c of captures as CaptureRow[]) {
      if (c.software) softwareCount[c.software] = (softwareCount[c.software] || 0) + 1
      if (c.automation_potential)
        automationLevelCount[c.automation_potential] =
          (automationLevelCount[c.automation_potential] || 0) + 1
    }

    // Compact capture list for the prompt (drop noisy fields, cap length)
    const compact = (captures as CaptureRow[]).slice(0, 200).map((c) => ({
      t: c.captured_at,
      task: c.task,
      software: c.software,
      step: c.workflow_step,
      trigger: c.trigger,
      auto_potential: c.automation_potential,
      reasoning: c.reasoning,
      kbd: c.keystrokes ?? 0,
      mouse: c.mouse_clicks ?? 0,
      paste: c.copy_paste_events ?? 0,
      idle: c.idle_seconds ?? 0,
    }))

    const stats = {
      capture_count: captureCount,
      weekly_hours_observed: weeklyHours,
      estimated_daily_hours: Math.round(dailyHours * 10) / 10,
      estimated_annual_hours: annualHours,
      hourly_rate_dollars: hourlyRate,
      estimated_annual_cost_dollars: annualCost,
      totals,
      software_distribution: softwareCount,
      automation_potential_distribution: automationLevelCount,
    }

    const userPrompt = `Employee: ${employee?.name ?? 'unknown'} (${employee?.role ?? 'unknown role'})
Category: ${category}
Time window: last 7 days

COMPUTED STATS (use these as-is — do not recalculate):
${JSON.stringify(stats, null, 2)}

CAPTURES (${compact.length} of ${captureCount} total, chronological):
${JSON.stringify(compact, null, 2)}

Generate the analysis JSON now.`

    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Claude returned no text' }, { status: 502 })
    }

    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let analysis: Analysis
    try {
      analysis = JSON.parse(raw)
    } catch {
      console.error('generate-intelligence: bad JSON', raw.slice(0, 500))
      return NextResponse.json(
        { error: 'Claude returned invalid JSON', detail: raw.slice(0, 500) },
        { status: 502 }
      )
    }

    // Enforce the 80% cap server-side — the model may overshoot despite the prompt.
    const cappedHours = Math.min(
      analysis.top_opportunity.annual_hours_saved,
      Math.round(annualHours * 0.8)
    )
    if (cappedHours !== analysis.top_opportunity.annual_hours_saved) {
      analysis.top_opportunity.annual_hours_saved = cappedHours
      analysis.top_opportunity.annual_savings_dollars = cappedHours * hourlyRate
    }

    return NextResponse.json({
      cost: {
        annual_cost_dollars: annualCost,
        annual_hours: annualHours,
        weekly_hours: weeklyHours,
        hourly_rate_dollars: hourlyRate,
        hourly_rate_source: employee?.role
          ? `${employee.role} default rate`
          : 'admin default rate',
      },
      analysis,
      meta: {
        employee: employee?.name ?? null,
        role: employee?.role ?? null,
        category,
        capture_count: captureCount,
        generated_at: new Date().toISOString(),
        model: MODEL,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('generate-intelligence: unhandled', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
