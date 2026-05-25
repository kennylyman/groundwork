import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The fleet — Groundwork",
  description:
    "Ten agents. Each one owns a specific operational domain. They run autonomously, escalate when something needs a human, and report to the agency owner every morning.",
};

type Agent = {
  name: string;
  domain: string;
  whatItDoes: string[];
  replaces: string;
  connects: string;
  number?: string;
};

const agents: Agent[] = [
  {
    name: "REED",
    domain: "Recruiting",
    whatItDoes: [
      "Monitors ATS for new applicants and stale candidates",
      "Runs structured contact cadences across email and SMS",
      "Triggers voice screens and advances candidates through pipeline stages",
      "Fires DocuSign offer letters once a candidate clears interview",
    ],
    replaces:
      "The recruiter or office manager juggling a 90-step manual hiring checklist for every new hire.",
    connects:
      "Hands off to EMBER the moment a candidate signs an offer. Escalates pipeline gaps to the agency owner each morning.",
    number: "90-step hiring checklist, automated end-to-end",
  },
  {
    name: "EMBER",
    domain: "Post-hire onboarding",
    whatItDoes: [
      "Detects new hires the moment REED closes the loop",
      "Sets up payroll, benefits enrollment, and timekeeping",
      "Enrolls each new caregiver in CareAcademy training",
      "Tracks compliance start dates so SCOUT knows what to monitor",
    ],
    replaces:
      "The 'who does the onboarding paperwork this week' bottleneck that quietly delays new caregiver starts.",
    connects:
      "Receives the handoff from REED. Hands compliance tracking off to SCOUT. Flags missing items before day one.",
  },
  {
    name: "SCOUT",
    domain: "Compliance",
    whatItDoes: [
      "Monitors 1,274 compliance records daily across the full caregiver roster",
      "Sends 30-day expiration alerts to the caregiver and the agency",
      "Flags lapses before they become liabilities or audit findings",
      "Surfaces patterns — repeat lapses, training gaps, document drift",
    ],
    replaces:
      "Spreadsheets and prayer. The manual cross-check that nobody has time to do well.",
    connects:
      "Pulls compliance start dates from EMBER. Flags BEACON when a lapse intersects with active visits.",
    number: "1,274 records monitored daily at CK-974",
  },
  {
    name: "MAXWELL",
    domain: "Billing",
    whatItDoes: [
      "Auto-approves clean visits the moment they close in EVV",
      "Flags exceptions — short visits, missed clock-outs, payer mismatches",
      "Cuts billing time from a full day to roughly 2 hours per week",
      "Hands a clean batch to whoever ultimately submits to the payer",
    ],
    replaces:
      "The bookkeeper or office manager spending a full day every week on billing.",
    connects:
      "Receives signals from BEACON on EVV exceptions. Feeds PENNY the clean visit data.",
    number: "1 day → 2 hours per week",
  },
  {
    name: "IRIS",
    domain: "Client intake",
    whatItDoes: [
      "Follows up on every new lead within 30 minutes of inquiry",
      "Runs nurture sequences for leads that aren't ready yet",
      "Monitors authorization expiry and re-auth windows",
      "Surfaces hot leads to the intake coordinator with full context",
    ],
    replaces:
      "The intake coordinator who's too swamped to call back the lead from yesterday — for 34 days running.",
    connects:
      "Hands closed-won leads to operations. Surfaces re-auth windows to WALTER and the care team.",
    number: "< 30 min response, every lead",
  },
  {
    name: "WALTER",
    domain: "Referrals",
    whatItDoes: [
      "Manages relationships with VA coordinators, hospital discharge planners, social workers",
      "Tracks last-touch by referral source, surfaces who's gone cold",
      "Sends thank-yous, updates, and check-ins on a cadence",
      "Keeps the referral funnel warm without anyone dialing on a Tuesday",
    ],
    replaces:
      "The marketing/outreach role nobody on staff actually has time to do.",
    connects:
      "Feeds qualified referrals into IRIS. Reports activity into the daily morning briefing.",
  },
  {
    name: "FELIX",
    domain: "Shift fill",
    whatItDoes: [
      "Matches open shifts to available caregivers by geography, skill, and history",
      "Sends SMS offers to ranked candidates",
      "Confirms fills automatically and updates the schedule",
      "Escalates the shifts it can't fill so a human can intervene",
    ],
    replaces:
      "The scheduler's manual phone tree that loses $2-4K a week to unfilled visits.",
    connects:
      "Reads compliance status from SCOUT before offering a shift. Reports recovered revenue to the daily briefing.",
    number: "$2-4K/week in recovered shifts",
  },
  {
    name: "ATLAS",
    domain: "Digital marketing",
    whatItDoes: [
      "Posts to Facebook and Google Business Profile weekly",
      "Monitors reviews and flags ones that need a response",
      "Sends a weekly marketing pulse report every Monday",
      "Tracks reach and engagement so the work is measurable, not vibes",
    ],
    replaces:
      "The marketing work that never happens because operations always comes first.",
    connects:
      "Pulls themes from WALTER's referral activity. Surfaces reputational signals to the agency owner.",
  },
  {
    name: "BEACON",
    domain: "EVV & incidents",
    whatItDoes: [
      "Monitors missed clock-outs in real time",
      "Scans caregiver notes for incident keywords (falls, hospital visits, behavioral changes)",
      "Escalates the moments that matter inside the day, not after the week",
      "Flags BIE-able patterns before they become formal complaints",
    ],
    replaces:
      "The end-of-week review where the small problems have already become big ones.",
    connects:
      "Feeds MAXWELL on EVV exceptions. Loops in SCOUT when an incident intersects with compliance.",
  },
  {
    name: "PENNY",
    domain: "Payroll prep",
    whatItDoes: [
      "Reconciles visit data against the payroll system",
      "Flags discrepancies — overtime, double-bookings, missing punches",
      "Hands a clean file to whoever runs payroll",
      "Reduces payroll questions and corrections after the fact",
    ],
    replaces:
      "The manual cross-check between EVV and iSolved that ate half a day.",
    connects:
      "Reads validated visits from MAXWELL. Cross-references with BEACON's incident flags.",
  },
];

export default function AgentsPage() {
  return (
    <>
      <section>
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-12 md:pt-28">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95]">
            The fleet.
          </h1>
          <p className="mt-8 max-w-2xl text-lg md:text-xl text-ground/75 leading-relaxed">
            Ten agents. Each one owns a specific operational domain. They run
            autonomously, escalate when something needs a human, and report to the
            agency owner every morning.
          </p>
        </div>
      </section>

      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="divide-y divide-ground/10">
            {agents.map((agent, i) => (
              <AgentRow key={agent.name} agent={agent} index={i + 1} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ground text-white">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] max-w-3xl">
            Ready to see them running on your operation?
          </h2>
          <div className="mt-10">
            <Link
              href="/book"
              className="inline-flex items-center bg-bolt text-ground px-6 py-3.5 font-medium hover:brightness-95 transition"
            >
              Start a conversation →
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function AgentRow({ agent, index }: { agent: Agent; index: number }) {
  return (
    <div className="grid md:grid-cols-12 gap-6 py-12">
      <div className="md:col-span-3">
        <div className="font-mono text-xs uppercase tracking-wider text-ground/50">
          {String(index).padStart(2, "0")} / {agent.domain}
        </div>
        <h2 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
          {agent.name}
        </h2>
        {agent.number && (
          <div className="mt-3 inline-block bg-bolt text-ground text-xs font-mono uppercase tracking-wider px-2 py-1">
            {agent.number}
          </div>
        )}
      </div>

      <div className="md:col-span-9 space-y-6">
        <ul className="space-y-2 text-ground/85 leading-relaxed">
          {agent.whatItDoes.map((b) => (
            <li key={b} className="flex gap-3">
              <span className="text-ground/40 mt-1.5">—</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="grid sm:grid-cols-2 gap-6 pt-4 border-t border-ground/10">
          <Detail label="What it replaces" body={agent.replaces} />
          <Detail label="How it connects" body={agent.connects} />
        </div>
      </div>
    </div>
  );
}

function Detail({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-wider text-ground/50 mb-2">
        {label}
      </div>
      <p className="text-sm text-ground/75 leading-relaxed">{body}</p>
    </div>
  );
}
