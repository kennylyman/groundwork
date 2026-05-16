import { notFound } from 'next/navigation'
import { serverSupabase } from '@/lib/supabase'
import { InstallView } from './InstallView'

export default async function InstallPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data: employee } = await serverSupabase()
    .from('employees')
    .select('id, name, role, terms_accepted_at, businesses(name)')
    .eq('install_token', token)
    .single()

  if (!employee) return notFound()

  const businessName =
    (employee.businesses as { name?: string } | { name?: string }[] | null)
      ? Array.isArray(employee.businesses)
        ? employee.businesses[0]?.name ?? 'your company'
        : (employee.businesses as { name?: string }).name ?? 'your company'
      : 'your company'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center text-white text-sm">
            ⚡
          </div>
          <span className="text-lg font-semibold text-gray-900">Groundwork</span>
        </div>

        <InstallView
          token={token}
          employeeName={employee.name}
          employeeRole={employee.role}
          businessName={businessName}
          initialAccepted={!!employee.terms_accepted_at}
        />
      </div>
    </div>
  )
}
