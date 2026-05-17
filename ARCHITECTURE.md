# Groundwork — Architecture

> **Last updated: 2026-05-17** (commit-aligned).
>
> **Update protocol.** Any commit that changes the data flow, adds/removes
> a top-level system component (table, API route, cron, adapter, external
> service), or rewires how subsystems talk to each other must update this
> file in the same commit. The "Update" line at the top of each section
> and the "Recent changes" list at the bottom are the cheap ledger for
> non-trivial architectural shifts.

---

## 1. System Overview

Three shells: the **Windows agent** (PyInstaller exe, one per employee
desktop), the **dashboard** (Next.js on Vercel, one tenant per business),
and **Supabase** (Postgres + RLS, one schema for everyone). External
services orbit the dashboard.

```
+-------------------------------+      +----------------------------------+      +-----------------------------+
|        WINDOWS AGENT          |      |       DASHBOARD (Vercel)         |      |         SUPABASE            |
|        PyInstaller exe        |      |       Next.js 16 / Node 24       |      |         Postgres + RLS      |
|        one per employee       |      |       middleware.ts (proxy)      |      |         multi-tenant        |
|-------------------------------|      |----------------------------------|      |-----------------------------|
|  main.py        (loop)        |      |  /api/activate                   |      |  businesses                 |
|  capture.py     (screen+i/o)  |      |  /api/intake/{chat,complete}     |      |  employees                  |
|  classify.py    (Claude API)  |      |  /api/employee/...               |      |  business_profiles          |
|  transmit.py    (REST -> db)  |      |  /api/detect-opportunities       |      |  captures (jsonb caps +     |
|  updater.py     (self-update) |      |  /api/discover-roles             |      |    capture_enrichments)     |
|  _version.py    (build stamp) |      |  /api/workflow-intelligence      |      |  opportunities              |
|                               |      |  /api/generate-{sop,intel}       |      |  employee_role_profiles     |
|  %APPDATA%\Groundwork\        |      |  /api/agent-version              |      |  integrations               |
|    config.json                |      |  /api/integrations/...           |      |  integration_events         |
|    groundwork.log             |      |  /api/settings/...               |      |  agent_releases             |
|    updater.bat (transient)    |      |                                  |      |  capability_registry        |
|    transmit_queue.json        |      |  /settings/{profile, team,       |      |  workflow_intelligence_     |
|    agent.new.exe (transient)  |      |    integrations, pricing,        |      |    cache                    |
|                               |      |    releases}                     |      |                             |
|  HKCU\...\Run\Groundwork      |      |  / (dashboard)                   |      |  RLS: owner_id chain        |
|    autostart                  |      |  /sop  /employee/[id]            |      |                             |
+--------------+----------------+      |  /install/[token]  /team-onboard |      +--------------+--------------+
               |                       +----+--------------+--------------+                     ^
               |                            |     ^        |                                    |
   POST captures (anon key)                 |     |        | callTool() + enrichment            |
   POST sessions                            |     |        | service-role writes                |
               |                            |     |        +---------> Supabase rest+pg ------- +
               |                            |     |                                             |
               v                            v     |                                             |
+-------------------------------+      +----+-----+----------------------+              (RLS bypassed
|       ANTHROPIC API           |      |    EXTERNAL OAUTH PROVIDERS     |             by service role)
|       Sonnet 4.5 / Opus       |      |---------------------------------|
|-------------------------------|      |  Slack (api.slack.com)          |
|  per-capture vision (Opus)    |      |  Microsoft Graph (login + graph)|
|  workflow clustering (Sonnet) |      |  Google APIs (Gmail/Cal/Drive)  |
|  intake chat (Sonnet, tools)  |      |  Zapier (inbound webhook only)  |
|  role discovery (Sonnet)      |      |  GitHub Releases (agent exe)    |
|  SOP / intelligence (Sonnet)  |      +---------------------------------+
+-------------------------------+
```

Everything below zooms in on one part of this picture.

---

## 2. End-to-End Data Flow

> **Update.** This is the canonical "where does a capture go" diagram.
> Touch it when any link in the chain changes.

```
   EMPLOYEE DESKTOP                 ANTHROPIC                    SUPABASE                         DASHBOARD
+-----------------+               +----------+               +--------------+               +-----------------+
| 30s capture     |               |          |               |              |               |                 |
| loop in main.py |               |          |               |              |               |                 |
|                 |               |          |               |              |               |                 |
|  capture.py     |               |          |               |              |               |                 |
|    screenshot   |               |          |               |              |               |                 |
|    window title |               |          |               |              |               |                 |
|    active URL   |               |          |               |              |               |                 |
|    keystrokes/  |               |          |               |              |               |                 |
|    clicks/idle  |               |          |               |              |               |                 |
|       |         |               |          |               |              |               |                 |
|       v         |  POST image+  |          |               |              |               |                 |
|  classify.py    |--system+user->| Opus     |               |              |               |                 |
|                 |               | vision   |               |              |               |                 |
|                 |<-- JSON ------|          |               |              |               |                 |
|       |         |  capabilities |          |               |              |               |                 |
|       |         |  + task +     |          |               |              |               |                 |
|       |         |  category +   |          |               |              |               |                 |
|       |         |  reasoning    |          |               |              |               |                 |
|       v         |               |          |               |              |               |                 |
|  transmit.py    |  POST /rest/v1/captures  |               |              |               |                 |
|                 |  (anon key,   |          |   row insert  |  captures    |               |                 |
|                 |   RLS gated)  +----------+-------------->|  (jsonb caps)|               |                 |
|                 |               |          |               |     |        |               |                 |
+-----------------+               +----------+               |     |        |               |                 |
                                                             |     |        |               |                 |
   VERCEL CRONS (read captures, write derived tables)        |     |        |               |                 |
   01:00 UTC   /api/detect-opportunities <-------------------+-----+        |               |                 |
                groups by (capability_id + key_params), ROI per pattern,    |               |                 |
                reads integration_events for "verified" boost, UPSERTs ---->|  opportunities|               |
                                                                            |               |               |
   02:00 UTC   /api/discover-roles <-------------------------+-----+        |               |               |
                per-employee, 30d window, Claude Sonnet clusters captures   |               |               |
                + synthesizes observed_role + workflows, UPSERTs ---------->| employee_role_|               |
                                                                            |  profiles     |               |
   04:00 UTC   /api/integrations/enrich-captures <-----------+-----+        |               |               |
                for each capture from last 24h that matches a connected     |               |               |
                native adapter, fetch live tool context, writes back ------>| captures      |               |
                                                                            | (.capture_    |               |
                                                                            |   enrichments)|               |
                                                                            |               |               |
   ON DEMAND   /api/workflow-intelligence <----------------------------------+ (read captures+integrations) |
                cache check (workflow_intelligence_cache, 1h TTL) ----------->                              |
                if miss: aggregate top tasks per emp, send to Sonnet for     |               |              |
                semantic clustering, compute connections + ROI, cache ----->|workflow_intel_|              |
                                                                            |  cache        |              |
                                                                            |               |              |
                                                                            |               |   GET / -----+--------> Dashboard renders:
                                                                            |               |                       Workflow Intelligence Map (D3)
                                                                            |               |                       OpportunitiesTable
                                                                            |               |                       Team overview
                                                                            |               |                       ConnectionPrompts
                                                                            +---------------+
```

---

## 3. Agent Subsystem

> **Update.** Touch when changing the activation handshake, the capture
> loop cadence, the auto-update mechanic, or the agent-side config
> shape.

### 3.1 Activation flow (one-time per employee install)

```
  Employee browser              Dashboard                        Agent exe
+----------------+         +------------------+               +-------------+
| /install/      |         | GET /install/    |               |             |
|   [token] page |<--------|   [token]/page   |               |             |
|                |         |                  |               |             |
| Acknowledge    |  POST   | POST /api/       |               |             |
| terms ---------+-------->| employee/        |               |             |
|                |  token  | accept-terms     |               |             |
|                |         |                  |               |             |
| Download .exe  |         | (link to GitHub  |               |             |
| (signed link)  |         |  Release asset)  |               |             |
|                |         |                  |               |             |
| Paste token    |         |                  |               |             |
| into GUI ------+-----------------------------+------token-->| Tkinter     |
| OR launch with |                              |             | setup       |
| token as arg   |                              |             | window      |
+----------------+                              |             |     |       |
                                                |             |     v       |
                                                |             | GET /api/   |
                                                +<------------+ activate?   |
                                                |              | token=...  |
                                                |              |            |
                  Dashboard returns:            |              |            |
                  - employee_id, business_id    |              |            |
                  - anthropic_api_key           +------------->| save to    |
                  - supabase_url, anon_key      |              | config.json|
                  - business_context            |              |            |
                  - role_context                |              | register   |
                  - capabilities[] (registry)   |              | HKCU\Run\  |
                                                |              | Groundwork |
                                                |              |            |
                                                |              | enter      |
                                                |              | capture    |
                                                |              | loop       |
                                                |              +------------+
```

`activate` writes `employees.activated_at` once. The install_token
remains valid forever (no expiry); same token can re-activate if config
is wiped.

### 3.2 Capture loop (steady state, every 30s)

```
  capture_count = 0
  while True:
    if capture_count % 5 == 0:
      check_is_paused(config)   # RPC: is_employee_paused (anon-safe)

    if not paused:
      snapshot  = capture.build_context_snapshot(previous_tasks=...)
      result    = classify.classify_snapshot(snapshot, api_key,
                       business_context, role_context, capabilities)
      ok        = transmit.transmit_capture(snapshot, result, session_id, config)
      if not ok: queue locally in transmit_queue.json

      # Opportunistic soft update at idle (>60s)
      last_check = _maybe_soft_update(config, last_check, idle_seconds)

    capture_count += 1
    sleep(30)
```

**Screenshots are strictly transient.** `screenshot_b64` lives in the
snapshot dict for one classification call, is sent to Anthropic, then
GCed. Never written to disk, never POSTed to Supabase. `transmit.py`
never references the `screenshot*` field.

### 3.3 Auto-update flow

```
  Startup (after activation, before capture loop):
    updater.cleanup_update_orphans()       # delete stale .new / .failed files
    release = check_for_update(VERSION)    # GET /api/agent-version
    action  = decide_action(VERSION, release)
    if action == "hard":  perform_update(release)  # downloads + swaps + exits

  Inside capture loop, when idle_seconds > 60 and last check > 1h ago:
    release = check_for_update(VERSION)
    action  = decide_action(VERSION, release)
    if action in ("hard", "soft"):  perform_update(release)

  perform_update():
    1. _is_safe_download_url(release.download_url)  # github.com / githubusercontent.com only
    2. _download_to(agent.new.exe)                  # 100MB cap, Content-Length check
    3. sha256(downloaded) == expected_sha           # otherwise discard
    4. write updater.bat                            # see below
    5. spawn detached, sys.exit(0)

  updater.bat (NTFS-atomic copy-then-replace, no missing-exe window):
    copy <live exe>     -> <live exe>.old      # backup
    copy <new exe>      -> <live exe>.new      # stage on same volume
    move <live exe>.new -> <live exe>          # MoveFileEx + REPLACE_EXISTING (atomic)
    start <live exe>
    sleep 30s; tasklist /FI "IMAGENAME eq Groundwork.exe"
      if not running: move .old -> live, start, exit /b 1

  CI -> agent_releases:
    .github/workflows/build.yml runs on push to main
    1. Read VERSION file, write agent/src/_version.py
    2. pyinstaller agent/groundwork.spec
    3. Compute sha256
    4. Publish via softprops/action-gh-release to tag "latest"
    5. scripts/publish-release.py calls promote_agent_release RPC
       with service-role key -> agent_releases row, is_latest=true
```

---

## 4. Auth & RLS

> **Update.** Touch when changing middleware routing, RLS policies, or
> the owner-chain pattern.

### 4.1 Middleware routing (every page except /api, /install, /terms)

```
                     +----------------------+
                     |    middleware.ts     |
                     +----+-----------------+
                          |
                          | resolve user via @supabase/ssr cookies
                          v
                  +-------+--------+
                  |  user exists?  |
                  +---+--------+---+
              no /              \ yes
                /                \
   path is /login|/signup        path needs routing decision?
       \         |              (/  or auth pages)
   not auth page \              /            \
                  \            /  yes         \ no
        redirect   pass through              + look up business +
        /login                                  intake_completed_at
                                                |
                                  +-------------+--------+--+---------------+
                                  no biz   biz but no    fully set up
                                           intake done
                                  |        |             |
                                  v        v             v
                            on /login? -> redirect /        on /login or /signup -> /
                            otherwise -> /team-onboarding   on / -> stay
```

API routes are matcher-excluded from middleware. Each API route owns its
own auth via `lib/auth.ts` helpers (`resolveOwner`, `resolveEmployeeOwner`,
`resolveUser`).

### 4.2 RLS owner-chain (migration 0010)

```
  auth.uid()                                    Service role
      |                                            | (bypasses RLS)
      v                                            v
  businesses.owner_id = auth.uid()    <-----     server-side
      |                                          API routes that
      v                                          use serverSupabase()
  employees.business_id IN (subq) ---------+
      |                                    |   +-------------------+
      v                                    +-->|  Read/write       |
  captures.business_id IN (subq)               |  bypass policies  |
  business_profiles.business_id IN (subq)      |  - /api/activate  |
  employee_role_profiles.business_id IN (subq) |  - all crons      |
  opportunities.business_id IN (subq)          |  - zapier webhook |
  integrations.business_id IN (subq)           |  - oauth callback |
  integration_events.business_id IN (subq)     +-------------------+

  Special policy:
    captures_anon_insert -- the agent writes captures with the anon key.
      Currently:  business_id IN (SELECT id FROM businesses)
      ** GAP: too permissive. Any anon-key holder can insert into any
         business. See Gaps section. **
```

Token encryption (migration 0014):
- `integrations.access_token_encrypted` / `refresh_token_encrypted` are
  AES-256-GCM ciphertexts, base64(iv | tag | ct). Key:
  `INTEGRATION_ENCRYPTION_KEY` env var (32 bytes, base64).
- Same key signs OAuth state tokens (HMAC-SHA256, 10-min TTL).

---

## 5. Intelligence Pipeline

> **Update.** Touch when adding a new analysis pass, a new cron schedule,
> or a new derived table.

```
  CAPTURES (raw, 30s cadence, jsonb capabilities[] per row)
    +
    |
    +---- per capture (classify.py, Opus vision) ----+
    |                                                |
    |                                                v
    |                                          { task, category,
    |                                            capabilities[],
    |                                            automation_potential,
    |                                            confidence,
    |                                            reasoning }
    |
    +---- 01:00 UTC daily ---+
    |                        v
    |                +-------+-------------------------+
    |                | /api/detect-opportunities        |
    |                |                                  |
    |                |  for each (capability_id +       |
    |                |   key_params) signature with     |
    |                |   >= 3 occurrences in 7d:        |
    |                |    - compute weekly_minutes,     |
    |                |      annual_cost, savings,       |
    |                |      confidence                  |
    |                |    - boost confidence if         |
    |                |      integration_events show     |
    |                |      verified_via_zapier         |
    |                |    - UPSERT opportunities row    |
    |                +-------+--------------------------+
    |                        |
    |                        v
    |                +-------+--------+
    |                | opportunities  | -----> OpportunitiesTable (client)
    |                +----------------+
    |
    +---- 02:00 UTC daily ---+
    |                        v
    |                +-------+--------------------------+
    |                | /api/discover-roles               |
    |                |                                   |
    |                |  per employee, if needs_rerun:    |
    |                |    pull 30d / 200 captures        |
    |                |    Claude Sonnet:                 |
    |                |      cluster into 3-7 activities  |
    |                |      synthesize observed_role +   |
    |                |      primary_workflows            |
    |                |    UPSERT employee_role_profile   |
    |                |    (unacknowledged)               |
    |                +-------+---------------------------+
    |                        |
    |                        v
    |                +-------+--------------+
    |                |employee_role_profiles| --> RoleDiscoveryCard
    |                +----------------------+      on /employee/[id]
    |
    +---- on-demand (5min client poll, 1h server cache) ---+
    |                                                       v
    |                                       +---------------+----------+
    |                                       | /api/workflow-intelligence|
    |                                       |                            |
    |                                       | cache hit? -> return       |
    |                                       | miss:                      |
    |                                       |   pull 7d / 13 emps / 50   |
    |                                       |    nodes total             |
    |                                       |   Sonnet semantic cluster  |
    |                                       |    with capability registry|
    |                                       |   compute connections+ROI  |
    |                                       |   UPSERT cache row         |
    |                                       +---------------+------------+
    |                                                       |
    |                                                       v
    |                                       +---------------+------------+
    |                                       | workflow_intelligence_cache|
    |                                       +---------------+------------+
    |                                                       |
    |                                                       v
    |                                              WorkflowIntelligenceMap
    |                                              (D3 force graph, dark
    |                                               background, cluster
    |                                               hulls, polling client)
    |
    +---- on demand from /sop ---+
                                 v
                       +---------+---------------------+
                       | /api/generate-sop  + intel    |
                       |  - per employee or all        |
                       |  - Sonnet writes long-form    |
                       |    SOP (frontline) + Process  |
                       |    Intelligence (owner) docs  |
                       +-------------------------------+
                              |
                              v
                       /sop page renders both via
                       SopDocument + IntelligenceReport
```

---

## 6. Integration Layer

> **Update.** Touch when adding a new adapter, changing the token storage
> shape, or wiring a new enrichment source.

### 6.1 Three rings + the data they unlock

```
  RING 1 - Detection (zero config)
    captures.software / active_window / active_url
       |
       v
    normalizeToolName() -> canonical tool_id
       |
       v
    Settings page shows "12x detected this week"
       Opportunity detector groups by capability+params

  RING 2 - Zapier webhook (per-business secret token)
    Owner: settings/integrations -> reveal webhook URL + token
    Owner: configure Zap on zapier.com (manual, see /settings/integrations docs)
    Zap fires -> POST /api/integrations/zapier
                 X-Groundwork-Token: <secret>
                 { tool_name, event_type, data, occurred_at, employee_email }
       |
       v
    Server: lookup businesses.webhook_secret (service role)
    Server: UPSERT integrations (ring=2, status=connected)
    Server: INSERT integration_events
       |
       v
    Opportunity detector boosts confidence on patterns whose params
    reference a tool with active events ("verified_via_zapier")

  RING 3 - Native OAuth (3 adapters live: Slack, Microsoft 365, Google)
    Owner: settings/integrations -> Connect Slack/M365/Google
       |
       v
    GET /api/integrations/oauth/<tool>
       resolveOwner -> mint signed state -> redirect to provider
       |
       v
    Provider consent screen
       |
       v
    GET /api/integrations/oauth/callback?code=...&state=...
       verifyOAuthState -> getAdapter(tool).oauth.exchangeCode
       encrypt access + refresh tokens (AES-256-GCM)
       UPSERT integrations row (ring=3, status=connected)
       |
       v
    callTool(business, tool, op, args)  -- used by everything
       1. load integration row (ring 3 preferred)
       2. JIT refresh if token_expires_at < now + 5 min
       3. decrypt access token
       4. dispatch to adapter.operations[op]
       5. return tagged result

    Enrichment cron (daily 04:00 UTC):
      for each capture in last 24h with active integration where
      adapter.matchesCapture(capture):
        adapter.enrichCapture(capture, ctx) -> write to
        captures.capture_enrichments[<tool>]
```

### 6.2 Adapter registry

```
  lib/integrations/adapters/
    manifest.ts       -- client-safe { toolName, label }[]
    types.ts          -- ToolAdapter interface
    slack.ts          -- xoxb tokens, no expiry, channels.history enrichment
    microsoft365.ts   -- Graph v1.0, Outlook+Teams+SharePoint+OneDrive,
                         1h access tokens (JIT refresh critical)
    google.ts         -- Gmail+Calendar+Drive, 1h access tokens
                         (refresh_token doesn't rotate)
    index.ts          -- ADAPTERS[] + nativeToolNames(),
                         runtime-asserts manifest matches registry

  Adding a new adapter = 3 files:
    1. adapters/<tool>.ts implementing ToolAdapter
    2. manifest.ts: add { toolName, label }
    3. index.ts: import + add to ADAPTERS[]
    Module-load assert catches drift between (2) and (3).
```

### 6.3 Refresh tokens cron

```
  03:30 UTC daily   /api/integrations/refresh-tokens

  SELECT * FROM integrations
   WHERE access_token_encrypted IS NOT NULL
     AND refresh_token_encrypted IS NOT NULL
     AND token_expires_at IS NOT NULL
     AND token_expires_at <= now() + 65 min

  for row in rows:
    refresh via adapter.oauth.refresh(decryptToken(refresh_token_encrypted))
    re-encrypt + UPDATE integrations row
    on failure: status='error' (UI prompts re-auth)
```

**With Hobby-plan daily-only cron**, JIT refresh inside callTool is the
primary mechanism for 1h-expiry providers (M365, Google). This cron is a
safety net for tokens we haven't called recently.

---

## 7. Component Inventory

> **Update.** Touch when adding/removing a top-level component.

### 7.1 Database tables (Supabase Postgres)

| Table | Owner | Purpose | RLS |
|---|---|---|---|
| `businesses` | migration pre-0001 | tenant root, owner_id | owner-only |
| `employees` | migration pre-0001 | per-tenant team, install_token, agent_version | owner-only |
| `captures` | migration pre-0001 | 30s screen + behavior snapshots, jsonb capabilities[], capture_enrichments | owner SELECT; anon INSERT (gated by business_id existence) |
| `sessions` | migration pre-0001 | agent session lifecycle | owner |
| `business_profiles` | 0005 | intake transcript + structured fields (tool_stack, workflows, pain_points), role_hourly_rates, webhook_secret | owner |
| `opportunities` | 0004 | detected automation patterns with ROI | owner |
| `employee_role_profiles` | 0006 | observed role / clusters / workflows from Sonnet | owner |
| `integrations` | 0007 + 0014 | per-tool connection state + encrypted tokens (ring 2 Zapier or ring 3 native OAuth) | owner |
| `integration_events` | 0007 | Zapier webhook event log (used by opportunity-confidence boost) | owner |
| `capability_registry` | 0011 | canonical 52-row taxonomy, source of truth for classify.py + dashboard | public read |
| `agent_releases` | 0012 | version history; is_latest + is_min_supported flags; ci writes via promote_agent_release RPC | public read |
| `workflow_intelligence_cache` | 0013 | 1h cache of /api/workflow-intelligence payload | owner |

### 7.2 API routes

| Route | Auth | Trigger | Purpose |
|---|---|---|---|
| `/api/activate` | install_token | agent first launch | mint per-employee config bundle |
| `/api/agent-version` | none | agent (startup + idle) | latest_version + sha + download_url + heartbeat write |
| `/api/capabilities` | public | client | proxy capability_registry, 5min cache |
| `/api/intake/chat` | session cookie | onboarding | Claude tool-calling intake flow |
| `/api/intake/complete` | session cookie | onboarding | finalize, write business_profiles row |
| `/api/employee/[id]/acknowledge-role` | resolveEmployeeOwner | dashboard | accept/dismiss role discovery |
| `/api/employee/accept-terms` | install_token | install page | stamp terms_accepted_at |
| `/api/employee/set-pause` | resolveEmployeeOwner | dashboard | flip is_paused |
| `/api/send-invite` | resolveOwner | dashboard | email install link |
| `/api/detect-opportunities` | CRON_SECRET | cron 01:00 UTC | opportunity scoring |
| `/api/discover-roles` | CRON_SECRET | cron 02:00 UTC | role discovery |
| `/api/integrations/refresh-tokens` | CRON_SECRET | cron 03:30 UTC | rotate expiring OAuth tokens |
| `/api/integrations/enrich-captures` | CRON_SECRET | cron 04:00 UTC | live tool context per capture |
| `/api/workflow-intelligence` | resolveOwner | dashboard poll (5min) | Sonnet clustering, 1h cache |
| `/api/generate-sop` | resolveEmployeeOwner | /sop page | long-form SOP doc |
| `/api/generate-intelligence` | resolveEmployeeOwner | /sop page | owner intelligence doc |
| `/api/integrations/state` | resolveOwner | dashboard | unified tools view |
| `/api/integrations/secret` | resolveOwner | dashboard | reveal webhook URL + token |
| `/api/integrations/connect` | resolveOwner | dashboard | Zapier self-attest + ring 3 disconnect |
| `/api/integrations/zapier` | X-Groundwork-Token | external (Zapier) | inbound event webhook |
| `/api/integrations/oauth/slack` | resolveOwner | dashboard | start Slack OAuth |
| `/api/integrations/oauth/microsoft-365` | resolveOwner | dashboard | start M365 OAuth |
| `/api/integrations/oauth/google-workspace` | resolveOwner | dashboard | start Google OAuth |
| `/api/integrations/oauth/callback` | signed state | provider redirect | generic OAuth callback |
| `/api/settings/profile` | resolveOwner | dashboard | edit business profile |
| `/api/settings/rates` | resolveOwner | dashboard | per-role hourly rates |
| `/api/settings/releases` | resolveOwner | dashboard | list + set min_supported agent version |

### 7.3 Vercel crons (vercel.json)

| Schedule | Path | Notes |
|---|---|---|
| `0 1 * * *` | `/api/detect-opportunities` | daily, reads 7d captures |
| `0 2 * * *` | `/api/discover-roles` | daily, per-employee gating |
| `30 3 * * *` | `/api/integrations/refresh-tokens` | safety-net rotation (JIT inside callTool is primary) |
| `0 4 * * *` | `/api/integrations/enrich-captures` | last 24h enrichment pass |

All daily because Hobby plan caps cron frequency. Move to sub-daily after
Pro upgrade.

### 7.4 External services

| Service | Auth | Purpose |
|---|---|---|
| Anthropic API | `ANTHROPIC_API_KEY` env (or per-employee from /activate) | classify.py, intake chat, role discovery, workflow clustering, SOP/intel generation |
| Supabase Postgres | anon key (agent + dashboard client) + service-role key (server) | the only data store |
| GitHub Releases | unauthenticated download, service-role for `promote_agent_release` from CI | agent exe distribution |
| Upstash Redis | REST URL + token | rate limiting on LLM routes (10/min/business) |
| Slack OAuth | `SLACK_CLIENT_ID`/`_SECRET` | ring 3 native |
| Microsoft Identity | `MICROSOFT_CLIENT_ID`/`_SECRET` | ring 3 native |
| Google Identity | `GOOGLE_CLIENT_ID`/`_SECRET` | ring 3 native |
| Zapier | per-business webhook_secret | ring 2 inbound webhooks |
| Resend (email) | `RESEND_API_KEY` | invite emails |

### 7.5 Agent binary

| File | Role |
|---|---|
| `main.py` | activation, capture loop, pause polling, update orchestration |
| `capture.py` | screenshot (mss), keyboard/mouse counters (pynput), window/url detection (osascript/Win32 API) |
| `classify.py` | Claude Vision per-capture, capability taxonomy from registry, two-pass on low confidence |
| `transmit.py` | REST insert to Supabase, local queue on failure |
| `updater.py` | version compare, download with sha256 + domain lock + size cap, updater.bat writer, orphan cleanup |
| `_version.py` | overwritten by CI at build time, contains `VERSION = "0.4.1"` |

### 7.6 Dashboard client components

| Component | Surface |
|---|---|
| `WorkflowIntelligenceMap` | D3 force graph on `/` |
| `WorkflowClusterPanel` | cluster detail side drawer |
| `OpportunitiesTable` | `/` |
| `RoleDiscoveryCard` | `/employee/[id]` |
| `ConnectionPrompts` | `/`, dismissable |
| `PauseToggle` / `PausedBadge` | `/`, `/employee/[id]` |
| `IntakeChat` | `/team-onboarding` |
| `SopDocument` / `IntelligenceReport` | `/sop` |
| `DashboardNav` | shared header |

---

## 8. Gaps — Built But Not Fully Wired

> **Update.** This section is the honest backlog. Things that exist in
> code but aren't fully realized in product. When something lands, move
> it out of this list.

1. **`captures.capture_enrichments` is written but no UI reads it.**
   The enrichment cron stamps live Slack/M365/Google context onto
   captures, but neither the OpportunitiesTable, the
   WorkflowIntelligenceMap, the SOP/Intelligence generators, nor the
   employee detail page consume it. The data is sitting in jsonb
   columns unread.
   **Next move:** thread `capture_enrichments` into the workflow-map
   cluster tooltips (highest visibility) and into the SOP generator's
   prompt (highest leverage on document quality).

2. **`integration_events` boost only fires from Zapier, not native OAuth.**
   The opportunity detector reads `integration_events` for the
   "verified_via_zapier" confidence boost. Native OAuth connections
   (Slack/M365/Google) never insert into this table. So a customer with
   only native integrations sees no verification badges, even though
   their tool data is more reliable than Zapier's.
   **Next move:** emit synthetic `integration_events` rows from the
   enrichment cron when adapters return meaningful data (e.g., a Slack
   message in the channel matches an opportunity's tool name).

3. **`integration_events.capture_id` is nullable and never populated.**
   The schema implies capture-event correlation but nothing in the
   product computes it. If we ever want to say "this Zapier event
   corresponds to that specific capture," we'd need a windowed-overlap
   join that doesn't exist yet.

4. **Agent heartbeat staleness has no alert.**
   `employees.agent_version_updated_at` is written on every
   `/api/agent-version` hit. If an agent stops checking in (crashed,
   uninstalled, machine off for a week), the dashboard surfaces nothing.
   `/settings/releases` shows fleet versions but doesn't flag stale
   ones.
   **Next move:** add a "last heartbeat" column to /settings/team and
   /settings/releases, surface a banner if any agent silent >48h.

5. **`captures_anon_insert` RLS policy is too permissive.**
   Any anon-key holder can insert captures with any `business_id`
   that exists. The install_token is supposed to be the real protection
   but the DB doesn't enforce that relationship. Audit item from May 17.
   **Next move:** route agent capture inserts through a server endpoint
   that validates the install_token before writing, then tighten the
   policy to deny anon inserts entirely.

6. **Intake can't be re-run from settings.**
   `IntakeChat` only lives at `/team-onboarding`. If an owner wants to
   correct or extend the business profile after first-time setup, they
   have to edit fields inline at `/settings/profile`; there's no path
   to re-do the conversational intake.

7. **`/settings/releases` min_supported version flag is untested in prod.**
   The schema and UI both support flipping `is_min_supported` to force
   the fleet to update. The path has unit-tested helpers (`version_lt`,
   `decide_action`) but no end-to-end prod validation that the chain
   from settings click → agent_releases update → agent hard-update
   actually works under load.

8. **Workflow Intelligence Map doesn't consume capture_enrichments
   OR integration_events.**
   Mentioned in #1 + #2 separately. Calling it out explicitly here
   because the map is the most user-visible surface and adding live
   tool context to cluster hover would be the biggest visible payoff
   from the OAuth foundation.

9. **No agent auto-update canary / soak.**
   Once a release lands in `agent_releases` with `is_latest=true`,
   every fleet agent picks it up at next startup or idle window. There's
   no `is_canary` flag, no staged rollout, no rollback channel beyond
   manual revert at the GitHub Releases asset.
   **Next move at scale:** add `is_canary` + percent-rollout fraction
   to `agent_releases`, gate agent self-update on a hash-of-employee-id
   threshold.

10. **`capabilities` field on captures is opaque in the UI.**
    Every capture row has a `jsonb capabilities[]` populated by the
    classifier. The opportunity detector groups by these; the Workflow
    Map clusters reference them indirectly. But there's no surface
    that lets an owner say "show me every capture tagged
    `data.entry.form_fill` for Sarah" — the raw tag stream is invisible
    to product users.

11. **No `tool_call_log` table.**
    `callTool` logs to Vercel function output only. When Phase 5
    automation execution starts firing real tool calls on customers'
    accounts, we'll want a durable audit trail. Mentioned in the OAuth
    foundation commit; deferred.

12. **Hobby-plan cron cadence degrades enrichment + token freshness.**
    `/api/integrations/enrich-captures` runs daily at 04:00 UTC. A
    capture taken at 04:01 UTC waits ~24h for enrichment.
    `/api/integrations/refresh-tokens` runs daily; M365 / Google
    tokens expire hourly. JIT refresh inside `callTool` covers this
    for any code path that actually calls a tool, but **the enrichment
    cron itself uses `buildContextWithRefresh`** so its refresh
    behavior is sound. Pro upgrade restores per-minute enrichment and
    hourly token refresh; until then this is the steady-state
    degradation.

---

## 9. Recent Architectural Changes

> Newest first. Trim entries older than 6 months.

- **2026-05-17** — Added Google Workspace native adapter (`adapters/google.ts`),
  third in the OAuth pattern. Closes the Microsoft-only gap.
- **2026-05-17** — Added Microsoft 365 native adapter and **just-in-time
  token refresh** inside `lib/integrations-runtime.ts`. JIT covers M365's
  1h access-token expiry independent of the daily refresh cron.
- **2026-05-17** — Built OAuth foundation: `lib/integrations/crypto.ts`
  (AES-256-GCM token encryption), `oauth-state.ts` (HMAC-signed state),
  `adapters/*` (Slack first), `/api/integrations/oauth/<tool>` initiators,
  generic `/api/integrations/oauth/callback`, refresh + enrichment crons,
  manifest-driven settings UI. Migration 0014 added token columns +
  `capture_enrichments`.
- **2026-05-17** — Identified that Hobby-plan cron limit was silently
  blocking every Vercel auto-deploy after the OAuth foundation push.
  Dropped new crons to daily cadence (`0 4 * * *`, `30 3 * * *`).
- **2026-05-17** — Workflow Intelligence Map shipped: `/api/workflow-intelligence`
  (Sonnet semantic clustering, 1h cache in `workflow_intelligence_cache`,
  migration 0013), `WorkflowIntelligenceMap` (D3 force graph),
  `WorkflowClusterPanel` (side drawer). Hero placement at top of `/`.
- **2026-05-17** — Agent auto-update infrastructure landed: migration
  0012 (`agent_releases` + RPCs), `/api/agent-version`,
  `agent/src/updater.py` with copy-then-replace + orphan cleanup,
  `/settings/releases` UI, CI publish step.
- **2026-05-17** — Multi-tenant RLS hardened (migration 0010, owner-chain
  on every per-business table), capability registry moved to DB
  (migration 0011), Upstash rate limiting wired into LLM routes.
- **2026-05-16** — Phase 4 Integration layer (Ring 1/2 detection +
  Zapier webhook). Phase 3 Role Discovery shipped. Phase 1a capability
  taxonomy + opportunity scoring.

---

## Appendix: Environment Variables

Required for full operation. Server-only unless marked `NEXT_PUBLIC_`.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# App
NEXT_PUBLIC_APP_URL                # base URL for OAuth redirects, install links

# Anthropic
ANTHROPIC_API_KEY

# Integrations
INTEGRATION_ENCRYPTION_KEY         # AES-256 key, base64-encoded 32 bytes
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# Email
RESEND_API_KEY

# Rate limiting
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN

# Cron
CRON_SECRET                        # bearer header on protected cron routes

# CI (GitHub Actions secrets, not Vercel env)
ANTHROPIC_API_KEY                  # baked into agent .env
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY          # used by publish-release.py
EMPLOYEE_ID                        # test agent identity
BUSINESS_ID                        # test agent identity
```
