# Groundwork — gwork.tech Marketing Site

Read GROUNDWORK.md first. That is the single source of truth for everything.

## What You're Building
A marketing website for Groundwork — an AI agent fleet for home care agencies.
This replaces the previous Windows desktop agent + SaaS dashboard (now deprecated).

## Tech Stack Decision
Build a clean, fast Next.js site. Keep it simple:
- Next.js 14+ App Router
- Tailwind CSS
- No heavy dependencies
- Deploy target: Vercel

## Brand
- Colors: Bone (#F3F1EA), Ground (#0A0A0A), Bolt (#F3F326)
- Font: Space Grotesk (Google Fonts)
- Mono: JetBrains Mono (Google Fonts)
- Logo: custom SVG wordmark with bolt replacing second "o" in groundwork
- See GROUNDWORK.md for full brand system

## Pages to Build (in priority order)
1. `/` — Homepage (most important)
2. `/agents` — The fleet breakdown
3. `/how-it-works` — Onboarding process
4. `/pricing` — Two tiers
5. `/book` — Contact form

## Key Rules
- Bone (#F3F1EA) as default background — NOT white
- Space Grotesk for all type
- Tight editorial feel — not generic SaaS
- No stock photos, no illustration libraries
- Mobile-first
- The bolt in the wordmark is a CUSTOM SVG mark — not an emoji
- All copy is in GROUNDWORK.md — do not invent copy

## What NOT to Do
- Do not touch the /agent, /supabase, or /scripts directories — deprecated
- Do not use the old dashboard code
- Build fresh in /dashboard (wipe and rebuild) or create a new /site directory
