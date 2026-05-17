'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ArrowLeft,
  FileText,
  Settings as SettingsIcon,
} from 'lucide-react'

/**
 * Shared top-strip for any internal page that isn't the home dashboard.
 * Keeps Back / Logo / Settings / SOP Builder in the same place on every
 * page so navigation feels stable.
 *
 * The home page (/) and /team-onboarding have their own brand-forward
 * headers and intentionally don't use this component.
 */
export function DashboardNav({
  title,
  subtitle,
  backHref = '/',
  backLabel = 'Back',
}: {
  title?: string
  subtitle?: string
  backHref?: string
  backLabel?: string
}) {
  const pathname = usePathname()

  return (
    <div className="bg-white border-b border-gray-200 px-8 py-4 print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href={backHref}
            className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">{backLabel}</span>
          </Link>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0"
            title="Groundwork home"
          >
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">Groundwork</span>
          </Link>
          {(title || subtitle) && (
            <div className="w-px h-4 bg-gray-200 shrink-0" />
          )}
          {(title || subtitle) && (
            <div className="min-w-0">
              {title && (
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {title}
                </p>
              )}
              {subtitle && (
                <p className="text-xs text-gray-500 truncate">{subtitle}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <NavLink
            href="/sop"
            icon={FileText}
            label="SOP Builder"
            active={pathname?.startsWith('/sop')}
          />
          <NavLink
            href="/settings/integrations"
            icon={SettingsIcon}
            label="Settings"
            active={pathname?.startsWith('/settings')}
          />
        </div>
      </div>
    </div>
  )
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        active
          ? 'bg-gray-900 text-white'
          : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </Link>
  )
}
