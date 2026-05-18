'use client'

/**
 * SignOutButton — drop-in ghost button for the nav header.
 *
 * Calls supabase.auth.signOut() and redirects to /login on success. On
 * failure it surfaces a brief inline error below the button so the user
 * isn't stuck in a confusing state; no confirmation dialog since signing
 * back in is one click away.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export function SignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOut() {
    setLoading(true)
    setError(null)
    try {
      const { error: err } = await supabase.auth.signOut()
      if (err) throw err
      // Use replace so the back button doesn't bounce them back into a
      // half-authed page that's about to redirect them anyway.
      router.replace('/login')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign out failed')
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={signOut}
        disabled={loading}
        title="Sign out"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <LogOut className="w-3.5 h-3.5" />
        )}
        Sign out
      </button>
      {error && (
        <div className="absolute right-0 top-full mt-1 z-20 px-2 py-1 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded whitespace-nowrap shadow-sm">
          {error}
        </div>
      )}
    </div>
  )
}
