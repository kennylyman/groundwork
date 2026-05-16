import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Routes the auth check applies to. Anything under /install/[token] is
// intentionally public (the install page is reached by an unauthenticated
// employee via a per-employee token).
const AUTH_PAGES = new Set(['/login', '/signup'])

// When an authed user without a business hits these, send them to /onboarding.
// /onboarding itself is allowed for any authed user — the page handles the
// no-business UI inline.
const REQUIRES_BUSINESS = new Set(['/'])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public token-based install pages — no auth at all.
  if (pathname.startsWith('/install')) {
    return NextResponse.next()
  }

  // Build a mutable response and a Supabase client that reads/writes auth
  // cookies on it. This pattern (from the official @supabase/ssr docs) lets
  // the access token auto-refresh on every middleware hit and carries the
  // refreshed cookies through redirects.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthPage = AUTH_PAGES.has(pathname)

  // --- Unauthenticated visitor ---
  if (!user) {
    if (isAuthPage) {
      return response
    }
    // Every other route requires auth — push to /login.
    return redirectKeepingCookies(request, '/login', response)
  }

  // --- Authenticated visitor ---
  // We only need to know about the business for routes where it affects
  // routing: the auth pages (redirect away from them) and routes that
  // require a business (root dashboard).
  const needsBusinessCheck = isAuthPage || REQUIRES_BUSINESS.has(pathname)
  if (needsBusinessCheck) {
    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()

    const hasBusiness = !!business

    // Authed user shouldn't see /login or /signup — route by business state.
    if (isAuthPage) {
      return redirectKeepingCookies(
        request,
        hasBusiness ? '/' : '/onboarding',
        response
      )
    }

    // Authed user on / without a business → finish setup first.
    if (REQUIRES_BUSINESS.has(pathname) && !hasBusiness) {
      return redirectKeepingCookies(request, '/onboarding', response)
    }
  }

  return response
}

function redirectKeepingCookies(
  request: NextRequest,
  pathname: string,
  source: NextResponse
): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  const redirect = NextResponse.redirect(url)
  // Forward any Supabase token-refresh cookies that getUser() may have written
  // onto `source` so the user isn't logged out across the redirect.
  source.cookies.getAll().forEach((c) => {
    redirect.cookies.set(c.name, c.value)
  })
  return redirect
}

export const config = {
  // Run on all routes EXCEPT:
  //   - /api/*           (the routes own their own auth — service role, etc)
  //   - /_next/*         (static and image optimization endpoints)
  //   - favicon.ico
  //   - any path containing a "."  (static assets like /file.png)
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
