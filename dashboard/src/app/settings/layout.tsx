'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Plug, Users, DollarSign } from 'lucide-react'
import { DashboardNav } from '@/components/DashboardNav'

const TABS = [
  { href: '/settings/profile', label: 'Business profile', icon: Building2 },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings/team', label: 'Team', icon: Users },
  { href: '/settings/pricing', label: 'Rates', icon: DollarSign },
] as const

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav title="Settings" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Tabs */}
        <nav className="flex items-center gap-1 mb-8 border-b border-gray-200">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center gap-2 px-4 py-2.5 -mb-px text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </Link>
            )
          })}
        </nav>

        {children}
      </div>
    </div>
  )
}
