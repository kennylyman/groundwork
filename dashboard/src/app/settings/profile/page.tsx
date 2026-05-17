'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { Sparkles, Edit3 } from 'lucide-react'
import type { BusinessProfileDraft, ToolEntry, PainPointEntry, WorkflowEntry } from '@/lib/intake-types'

type ProfileRow = BusinessProfileDraft & {
  intake_completed_at: string | null
  intake_skipped_at: string | null
}

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [businessName, setBusinessName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: biz } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('owner_id', user.id)
      .maybeSingle()
    if (!biz) {
      setLoading(false)
      return
    }
    setBusinessName(biz.name)
    const { data } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('business_id', biz.id)
      .maybeSingle()
    setProfile((data as ProfileRow) ?? null)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <div className="w-6 h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-500 mb-3">
          No profile captured yet for{' '}
          <span className="font-medium text-gray-700">{businessName}</span>.
        </p>
        <Link
          href="/team-onboarding"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Run the intake chat
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 px-7 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Business profile
            </p>
            <h2 className="text-2xl font-semibold text-gray-900">{businessName}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {profile.intake_completed_at
                ? `Intake completed ${new Date(profile.intake_completed_at).toLocaleDateString()}`
                : profile.intake_skipped_at
                ? `Intake skipped ${new Date(profile.intake_skipped_at).toLocaleDateString()}`
                : 'Intake state unknown'}
            </p>
          </div>
          <Link
            href="/team-onboarding"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            title="Re-run the intake conversation to refresh"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Re-run intake
          </Link>
        </div>
      </div>

      <ProfileSection title="Industry">
        <Field label="Industry" value={profile.industry} />
        <Field label="Sub-industry" value={profile.sub_industry} />
        <Field label="Size band" value={profile.size_band} />
      </ProfileSection>

      <ProfileSection title="Tools the team uses">
        {profile.tool_stack && profile.tool_stack.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {(profile.tool_stack as ToolEntry[]).map((t, i) => (
              <li
                key={i}
                className="text-xs px-2.5 py-1 bg-gray-100 text-gray-700 rounded-md"
              >
                <span className="font-medium">{t.name}</span>
                {t.used_for && t.used_for.length > 0 && (
                  <span className="text-gray-500">
                    {' '}
                    — {t.used_for.join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No tools recorded</p>
        )}
      </ProfileSection>

      <ProfileSection title="Pain points">
        {profile.pain_points && profile.pain_points.length > 0 ? (
          <ul className="space-y-2">
            {(profile.pain_points as PainPointEntry[]).map((p, i) => (
              <li key={i} className="text-sm text-gray-700">
                {p.description}
                {p.severity && (
                  <span className="text-xs text-amber-700 ml-2">[{p.severity}]</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No pain points recorded</p>
        )}
      </ProfileSection>

      <ProfileSection title="Workflows">
        {profile.workflows && profile.workflows.length > 0 ? (
          <ul className="space-y-2">
            {(profile.workflows as WorkflowEntry[]).map((w, i) => (
              <li key={i} className="text-sm text-gray-700">
                <span className="font-medium">{w.name}</span>
                {w.description && (
                  <span className="text-gray-500"> — {w.description}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">No workflows recorded</p>
        )}
      </ProfileSection>

      <ProfileSection title="Compliance">
        {profile.compliance_constraints && profile.compliance_constraints.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {profile.compliance_constraints.map((c, i) => (
              <li
                key={i}
                className="text-xs px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-md"
              >
                {c}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400">None recorded</p>
        )}
      </ProfileSection>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        This profile sharpens classification, opportunity ranking, and SOP
        generation. Editing inline is coming soon — for now, re-run intake to
        update.
      </p>
    </div>
  )
}

function ProfileSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h3 className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-sm">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-gray-900">{value || <span className="text-gray-400">—</span>}</span>
    </div>
  )
}
