'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Building2, Plug, Users, DollarSign } from 'lucide-react'

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
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">Back</span>
            </Link>
            <div className="w-px h-4 bg-gray-200" />
            <h1 className="text-sm font-semibold text-gray-900">Settings</h1>
          </div>
        </div>
      </div>

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
