# Groundwork — Product Brief for gwork.tech

> **This file is the source of truth for everything built at gwork.tech.**
> Claude Code: read this before touching any page, component, or copy.
> John (Hermes agent): owns and maintains this file. All content changes originate here.
> Last updated: 2026-05-25

---

## What Groundwork Is

Groundwork is a fleet of AI agents that autonomously run home care agency operations.

Not a scheduling tool. Not a CRM bolt-on. A set of named autonomous agents — each owning a specific operational domain — running 24/7 so the agency team doesn't have to.

Built at Comfort Keepers #974 in Olympia, WA. Running on real operations, real caregivers, real clients.

---

## The Problem We Solve

Home care agencies are operationally complex in ways most software doesn't account for:

- Recruiting pipelines with 90-step hiring checklists — one person manages all of it
- 1,274 compliance records to track (91 caregivers × 14 required items each) — manually
- Leads sitting uncontacted for 34 days because intake is overwhelmed
- $2-4K/week in unfilled visits because shift fill is a manual phone tree
- Referral sources not being called because nobody has time
- Marketing that never happens because operations comes first
- Billing that takes a full day every week instead of 2 hours

These are not unique problems. Every home care agency in the US has the same six operational constraints. That's not a coincidence — it's a product opportunity.

---

## The Agents

Each agent owns one domain. None overlap.

| Agent | Domain | What It Does |
|-------|--------|--------------|
| **REED** | Recruiting | Monitors ATS, runs contact cadences, triggers voice screens, advances pipeline, fires DocuSign offer letters |
| **EMBER** | Post-hire onboarding | Detects new hires, sets up payroll, enrolls in training, tracks compliance start dates |
| **SCOUT** | Compliance | Monitors 1,274 records daily, sends 30-day expiration alerts, flags lapses |
| **MAXWELL** | Billing | Auto-approves clean visits, flags exceptions, cuts billing time from a full day to 2 hours |
| **IRIS** | Client intake | Follows up on every new lead within 30 minutes, runs nurture sequences, monitors authorization expiry |
| **WALTER** | Referrals | Manages referral source relationships — VA coordinators, hospital discharge planners, social workers |
| **FELIX** | Shift fill | Matches open shifts to available caregivers, sends SMS offers, confirms fills |
| **ATLAS** | Digital marketing | Posts to Facebook/GBP weekly, monitors reviews, sends weekly marketing pulse report |
| **BEACON** | EVV & incidents | Monitors missed clock-outs, scans caregiver notes for incident keywords |
| **PENNY** | Payroll prep | Reconciles visit data against payroll system, flags discrepancies |

---

## Product Tiers

**Tier 1 — Done-For-You**
$300–500/month. We run the agents for the agency. They get the outputs.

**Tier 2 — Done-With-You**
~$1,000–1,500/month. We set it up together. Includes the full playbook. Their team owns it.

---

## Target Customer

- Home care agency owners (independent + franchise)
- Home health administrators
- Geography: US-wide (home care workflows are universal)
- Pain signal: team overwhelmed by admin, leads going cold, compliance lapses, aggregator dependency

---

## Brand System

### Core Identity
- **Product name:** Groundwork
- **Domain:** gwork.tech
- **Tagline:** AI agents that run home care operations — so your team can focus on care.

### Logo / Wordmark
- Lowercase, tight tracking, stacked: `gr⚡` / `undwork`
- Custom bolt (⚡) replaces the second "o" — NOT an emoji, a custom SVG mark
- Font: **Space Grotesk Bold**
- Full brand guide: `/root/groundwork/gtm/brand-guide.html` (transfer to repo)

### Color System
| Name | Hex | Role |
|------|-----|------|
| Bone | `#F3F1EA` | Default surface — primary background |
| Ground | `#0A0A0A` | Dark emphasis — banners, hero sections |
| Bolt | `#F3F326` | Brand accent — electric yellow, used sparingly (<15% of frame) |
| Black | `#0A0A0A` | Primary text on light |
| White | `#FFFFFF` | Text on dark |

### Typography
| Role | Font | Weight |
|------|------|--------|
| Display / Headlines | Space Grotesk | 700 Bold |
| Body | Space Grotesk | 400 Regular |
| Labels / Mono | JetBrains Mono | 400 |

### Usage Rules
- Bolt color: never more than ~15% of any frame
- Ground: reserve for hero sections and moments of weight
- Bone: default surface for all marketing pages
- Never use emoji ⚡ for the bolt on pixel-controlled surfaces
- Robot mascot and wordmark: never in the same lockup

---

## Site Architecture

### Pages to Build

**1. `/` — Homepage (marketing landing page)**
The primary conversion surface. Audience: home care agency owners who arrived from LinkedIn or search.

**2. `/agents` — The Fleet**
Detailed breakdown of each agent. What it does, what problem it solves, real numbers.

**3. `/how-it-works` — The Process**
How onboarding works. What the agency needs to provide. What we handle.

**4. `/pricing` — Tiers**
Tier 1 (Done-For-You) and Tier 2 (Done-With-You). Clear, honest, no hidden fees.

**5. `/book` — Contact / Demo Request**
Simple form. Name, agency name, state, phone, current headcount. No Calendly friction.

---

## Homepage Copy (Full)

### Hero Section
**Headline:**
```
Your home care agency,
run by agents.
```

**Subheadline:**
```
Groundwork deploys a fleet of AI agents across your operations —
recruiting, compliance, billing, intake, marketing, and shift fill.
They run autonomously. Your team handles the exceptions.
```

**CTA:** `See how it works →`
**Secondary CTA:** `Book a conversation`

**Hero context line (small text below CTAs):**
```
Built at Comfort Keepers #974 in Olympia, WA. Running on live operations.
```

---

### Problem Section
**Section label:** THE REALITY

**Headline:**
```
Every home care agency
has the same six problems.
```

**Body:**
```
We know because we own one.

Recruiting pipelines held together by a 90-step manual checklist.
1,274 compliance records tracked on spreadsheets and prayer.
Leads sitting uncontacted for over a month because intake is swamped.
Open shifts costing $2-4K a week because fill is a manual phone tree.
Referral sources not getting called because nobody has time on a Tuesday.
Marketing that never happens because operations always comes first.

These aren't your failures. They're the structural constraints of running
a home care agency with a human team. We built a different kind of team.
```

---

### Agents Section
**Section label:** THE FLEET

**Headline:**
```
Ten agents. Each one owns a domain.
None of them take days off.
```

**Agent cards** — one per agent, use the table from above. Each card:
- Agent name (bold, caps)
- One-line domain description
- 2-3 bullet points of what it does
- Real number where available

---

### Social Proof Section
**Section label:** BUILT ON REAL OPERATIONS

**Headline:**
```
This isn't a demo environment.
```

**Body:**
```
Groundwork was built inside Comfort Keepers #974 in Olympia, WA —
a home care franchise with 91 active caregivers and 62 active clients.

The agents are running now. SCOUT monitors 1,274 compliance records daily.
ATLAS posts to Facebook and sends a weekly marketing pulse every Monday.
REED manages the recruiting pipeline. MAXWELL handles billing.

We didn't build Groundwork to sell software. We built it to run our agency.
Then we realized every agency owner we talked to had the same problems.
```

---

### Tiers Section
**Section label:** HOW TO WORK WITH US

**Headline:**
```
Two ways in.
```

**Tier 1 card:**
```
Done-For-You
$300–500 / month

We run the agents for you.
Your team gets the outputs — compliance monitoring, lead follow-up,
billing automation, recruiting support, digital marketing.
No technical lift required.
```

**Tier 2 card:**
```
Done-With-You
~$1,000–1,500 / month

We set it up together.
Includes the full implementation playbook, guided setup,
and ongoing support. Your team owns the system at the end.
```

**Below tiers:**
```
Starting with a small group of agencies — ones where we can
be close to the implementation and make sure it works for your
specific operation before we scale wider.
```

---

### CTA Section
**Headline:**
```
If you recognize your agency
in everything above —
```

**Body:**
```
We're not running a sales process. We're having conversations with
operators who are tired of the same problems.

No demo call required. Tell us about your agency and we'll tell you
honestly whether this is a fit.
```

**CTA:** `Start a conversation →`

---

## /agents Page Copy

**Page headline:**
```
The fleet.
```

**Intro:**
```
Ten agents. Each one owns a specific operational domain.
They run autonomously, escalate when something needs a human,
and report to the agency owner every morning.
```

Then one section per agent using the table above, expanded with:
- What it replaces
- How it connects to other agents
- Real number from CK-974 where available

---

## /how-it-works Page Copy

**Headline:**
```
From zero to running in weeks, not months.
```

**Steps:**

**Step 1 — Intake conversation**
```
We talk through your operation. ATS, billing system, communication tools,
compliance requirements, current team structure. No assumptions.
```

**Step 2 — Configuration**
```
We configure the agents for your specific workflows. Viv, or whatever ATS
you use. Your payer mix. Your compliance items. Your caregiver geography.
```

**Step 3 — Supervised launch**
```
Agents go live in monitoring mode first. We watch what they surface,
tune the logic, confirm the escalation paths. Nothing autonomous until
we're confident in the outputs.
```

**Step 4 — Handoff**
```
Your team gets a morning briefing every day. John (the orchestrating agent)
surfaces what matters and filters the noise. Your people make the calls
that require human judgment. Everything else runs on its own.
```

---

## /pricing Page Copy

**Headline:**
```
Straightforward pricing.
No implementation fees. No annual lock-in.
```

Use the tier cards from the homepage.

**FAQ:**
- What systems do you connect to? Viv Technologies, RingCentral, DocuSign, CareAcademy, iSolved, Microsoft Teams, Outlook, Facebook, Google Business Profile. Others on request.
- Do we need to change our current software? No. The agents layer on top of what you already use.
- What if it doesn't work for our operation? We don't take on agencies we can't serve. If we get into onboarding and it's not a fit, we'll tell you.
- Is there a contract? Month-to-month. Cancel anytime.

---

## /book Page Copy

**Headline:**
```
Tell us about your agency.
```

**Body:**
```
We're starting with a small group. Fill this out and we'll follow up
within one business day — no automated sequences, just a real response.
```

**Form fields:**
- Your name
- Agency name
- State
- Approximate caregiver headcount
- Your current biggest operational headache (free text)
- Best phone number

**Submit button:** `Send it →`

**Below form:**
```
Or email directly: [email to be added]
```

---

## Design Direction for Claude Code

- Bone (#F3F1EA) as default background — not white, not gray
- Space Grotesk for all type
- Tight, editorial feel — not a generic SaaS landing page
- No stock photos, no illustration libraries, no generic feature grids
- The wordmark bolt is custom SVG — do not use emoji
- Mobile-first, fast, no heavy animations
- The brand guide HTML file has exact specs — use it as the design reference
- Tone: direct, specific, operator-to-operator — not startup marketing speak

---

## File Locations (John's VPS)

- Brand guide: `/root/groundwork/gtm/brand-guide.html`
- LinkedIn content package: `/root/groundwork/gtm/linkedin_content_package.md`
- ATLAS scripts: `/root/groundwork/atlas/`
- Agent architecture: `/root/groundwork/architecture/agent_architecture.md`

---

## Questions for Kenny (open items)

- [ ] Contact email for the /book form
- [ ] Whether to show pricing publicly or gate it behind the form
- [ ] Domain DNS — is gwork.tech currently pointing anywhere?

---

*Maintained by John Hermes. Update this file when product, pricing, copy, or brand changes.*
