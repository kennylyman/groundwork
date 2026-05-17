'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Loader2,
  Sparkles,
  Building2,
  Tag,
  Users,
  Wrench,
  Flame,
  ListTodo,
  Lock,
  ArrowRight,
  AlertCircle,
} from 'lucide-react'
import type {
  ChatMessage,
  BusinessProfileDraft,
  ToolEntry,
  PainPointEntry,
  WorkflowEntry,
} from '@/lib/intake-types'
import { isMinimumComplete } from '@/lib/intake-types'

const STORAGE_KEY = 'groundwork.intake.draft.v1'

type Props = {
  onCompleted: (businessId: string) => void
  initialOwnerName?: string
  ownerEmail?: string
}

export function IntakeChat({ onCompleted, initialOwnerName, ownerEmail }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [profile, setProfile] = useState<BusinessProfileDraft>({
    owner_name: initialOwnerName,
  })
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intakeSignalledComplete, setIntakeSignalledComplete] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Restore from localStorage on mount, then fire the first turn.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { messages: ChatMessage[]; profile: BusinessProfileDraft }
        if (saved.messages?.length) {
          setMessages(saved.messages)
          setProfile(saved.profile ?? {})
          return
        }
      }
    } catch {
      // bad payload, ignore
    }
    // No saved chat — open the conversation.
    void sendTurn([], profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on every update.
  useEffect(() => {
    if (messages.length === 0) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, profile }))
    } catch {
      // localStorage may be unavailable
    }
  }, [messages, profile])

  // Autoscroll on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  async function sendTurn(currentMessages: ChatMessage[], currentProfile: BusinessProfileDraft) {
    setThinking(true)
    setError(null)
    try {
      const r = await fetch('/api/intake/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: currentMessages, profile: currentProfile }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)

      setProfile(body.profile)
      setMessages((m) => [...m, { role: 'assistant', content: body.message }])
      if (body.is_complete) setIntakeSignalledComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the intake agent')
    } finally {
      setThinking(false)
      // Refocus the input after a brief delay so the autoscroll lands first.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || thinking || completing) return
    setInput('')
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    await sendTurn(next, profile)
  }

  async function handleComplete(skipped: boolean) {
    if (completing) return
    setCompleting(true)
    setError(null)
    try {
      const r = await fetch('/api/intake/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, transcript: messages, skipped }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
      onCompleted(body.business_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your business')
      setCompleting(false)
    }
  }

  const minimumMet = isMinimumComplete(profile)
  const canFinish = minimumMet || intakeSignalledComplete

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      {/* --- Chat column --- */}
      <div className="bg-white rounded-2xl border border-gray-200 flex flex-col h-[640px]">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gray-900 text-white flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Onboarding chat</h2>
              <p className="text-xs text-gray-500">~5 minutes · skippable any time</p>
            </div>
          </div>
          {canFinish && (
            <button
              type="button"
              onClick={() => handleComplete(false)}
              disabled={completing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {completing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {messages.length === 0 && thinking && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Warming up…
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}
          {thinking && messages.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="mx-6 mb-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSend()
          }}
          className="px-4 py-3 border-t border-gray-100"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={thinking ? 'Wait for the response…' : 'Type your answer…'}
              disabled={thinking || completing}
              className="flex-1 resize-none px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking || completing}
              className="shrink-0 w-9 h-9 bg-gray-900 text-white rounded-lg flex items-center justify-center hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          {messages.length > 0 && (
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-gray-400">
                {ownerEmail ? `Signed in as ${ownerEmail}` : ''}
              </p>
              <button
                type="button"
                onClick={() => handleComplete(true)}
                disabled={completing}
                className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-50"
              >
                Skip the rest →
              </button>
            </div>
          )}
        </form>
      </div>

      {/* --- Profile preview column --- */}
      <ProfilePreview profile={profile} />
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'bg-gray-900 text-white rounded-br-md'
            : 'bg-gray-100 text-gray-900 rounded-bl-md'
        }`}
      >
        {message.content}
      </div>
    </div>
  )
}

// ---------- Profile preview ----------

function ProfilePreview({ profile }: { profile: BusinessProfileDraft }) {
  const fc = profile.field_confidence || {}
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 self-start sticky top-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
          <Building2 className="w-3.5 h-3.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Your business</h3>
          <p className="text-[11px] text-gray-500">Filling in as you go</p>
        </div>
      </div>

      <div className="space-y-3">
        <PreviewField
          icon={Building2}
          label="Name"
          value={profile.business_name}
          confidence={fc.business_name}
        />
        <PreviewField
          icon={Tag}
          label="Industry"
          value={profile.industry}
          subValue={profile.sub_industry}
          confidence={fc.industry}
        />
        <PreviewField
          icon={Users}
          label="Size"
          value={profile.size_band}
          confidence={fc.size_band}
        />
        <PreviewList
          icon={Wrench}
          label="Tools"
          items={(profile.tool_stack ?? []).map((t: ToolEntry) =>
            t.used_for?.length ? `${t.name} — ${t.used_for.join(', ')}` : t.name
          )}
          confidence={fc.tool_stack}
        />
        <PreviewList
          icon={ListTodo}
          label="Workflows"
          items={(profile.workflows ?? []).map((w: WorkflowEntry) => w.name)}
          confidence={fc.workflows}
        />
        <PreviewList
          icon={Flame}
          label="Pain points"
          items={(profile.pain_points ?? []).map(
            (p: PainPointEntry) => p.description
          )}
          confidence={fc.pain_points}
          tone="amber"
        />
        <PreviewList
          icon={Lock}
          label="Compliance"
          items={profile.compliance_constraints ?? []}
          confidence={fc.compliance_constraints}
        />
      </div>

      <p className="mt-5 pt-4 border-t border-gray-100 text-[11px] text-gray-400 leading-relaxed">
        Used by Groundwork to classify employee work and surface automation
        opportunities. You can edit this later from settings.
      </p>
    </div>
  )
}

function PreviewField({
  icon: Icon,
  label,
  value,
  subValue,
  confidence,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string
  subValue?: string
  confidence?: number
}) {
  const filled = !!value
  return (
    <div className={`text-xs ${filled ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </span>
        {filled && typeof confidence === 'number' && (
          <ConfidenceDot value={confidence} />
        )}
      </div>
      <p className="text-sm text-gray-900 font-medium">{value || '—'}</p>
      {subValue && <p className="text-xs text-gray-500 mt-0.5">{subValue}</p>}
    </div>
  )
}

function PreviewList({
  icon: Icon,
  label,
  items,
  confidence,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  items: string[]
  confidence?: number
  tone?: 'amber'
}) {
  const filled = items.length > 0
  const pillClass =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-gray-100 text-gray-700 border-gray-200'
  return (
    <div className={`text-xs ${filled ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3 h-3 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </span>
        {filled && typeof confidence === 'number' && (
          <ConfidenceDot value={confidence} />
        )}
      </div>
      {filled ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it, i) => (
            <span
              key={i}
              className={`text-[11px] px-2 py-0.5 rounded-md border ${pillClass}`}
            >
              {it}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">—</p>
      )}
    </div>
  )
}

function ConfidenceDot({ value }: { value: number }) {
  const color =
    value >= 0.8 ? 'bg-emerald-400' : value >= 0.5 ? 'bg-amber-400' : 'bg-gray-300'
  return (
    <span
      title={`Confidence: ${(value * 100).toFixed(0)}%`}
      className={`w-1.5 h-1.5 rounded-full ${color}`}
    />
  )
}
