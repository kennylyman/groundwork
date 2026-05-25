import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Groundwork — AI agents that run home care operations",
  description:
    "Groundwork deploys a fleet of AI agents across recruiting, compliance, billing, intake, marketing, and shift fill. They run autonomously. Your team handles the exceptions.",
  robots: "noindex, nofollow",
};

const agents = [
  {
    name: "REED",
    domain: "Recruiting",
    bullets: [
      "Monitors ATS and runs contact cadences",
      "Triggers voice screens and advances pipeline",
      "Fires DocuSign offer letters",
    ],
    stat: "90-step hiring checklist, automated",
  },
  {
    name: "EMBER",
    domain: "Post-hire onboarding",
    bullets: [
      "Detects new hires and sets up payroll",
      "Enrolls in training",
      "Tracks compliance start dates",
    ],
  },
  {
    name: "SCOUT",
    domain: "Compliance",
    bullets: [
      "Monitors 1,274 records daily",
      "Sends 30-day expiration alerts",
      "Flags lapses before they become liabilities",
    ],
    stat: "1,274 records monitored daily",
  },
  {
    name: "MAXWELL",
    domain: "Billing",
    bullets: [
      "Auto-approves clean visits",
      "Flags exceptions for human review",
      "Cuts billing time from a full day to 2 hours",
    ],
    stat: "1 day → 2 hours",
  },
  {
    name: "IRIS",
    domain: "Client intake",
    bullets: [
      "Follows up on every new lead within 30 minutes",
      "Runs nurture sequences",
      "Monitors authorization expiry",
    ],
    stat: "< 30 min lead response",
  },
  {
    name: "WALTER",
    domain: "Referrals",
    bullets: [
      "Manages VA coordinators and hospital discharge planners",
      "Tracks social worker relationships",
      "Keeps the funnel warm without a human dialing",
    ],
  },
  {
    name: "FELIX",
    domain: "Shift fill",
    bullets: [
      "Matches open shifts to available caregivers",
      "Sends SMS offers",
      "Confirms fills automatically",
    ],
    stat: "Shifts recovered before they cost you",
  },
  {
    name: "ATLAS",
    domain: "Digital marketing",
    bullets: [
      "Posts to Facebook and GBP weekly",
      "Monitors reviews",
      "Sends weekly marketing pulse report",
    ],
  },
  {
    name: "BEACON",
    domain: "EVV & incidents",
    bullets: [
      "Monitors missed clock-outs",
      "Scans caregiver notes for incident keywords",
      "Escalates the moments that matter",
    ],
  },
  {
    name: "PENNY",
    domain: "Payroll prep",
    bullets: [
      "Reconciles visit data against payroll system",
      "Flags discrepancies",
      "Hands a clean file to whoever runs payroll",
    ],
  },
];

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-24 md:pt-32 md:pb-32">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95]">
            Your home care agency,
            <br />
            <span className="relative inline-block">
              run by agents.
              <span
                aria-hidden="true"
                className="absolute -bottom-2 left-0 h-3 w-full bg-bolt -z-10"
                style={{ transform: "skewX(-6deg)" }}
              />
            </span>
          </h1>

          <p className="mt-10 max-w-2xl text-lg md:text-xl text-ground/75 leading-relaxed">
            Groundwork deploys a fleet of AI agents across your operations —
            recruiting, compliance, billing, intake, marketing, and shift fill.
            They run autonomously. Your team handles the exceptions.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/about/how-it-works"
              className="inline-flex items-center bg-ground text-white px-6 py-3.5 font-medium hover:bg-ground/90 transition-colors"
            >
              See how it works →
            </Link>
            <Link
              href="/about/book"
              className="inline-flex items-center border border-ground/30 text-ground px-6 py-3.5 font-medium hover:border-ground transition-colors"
            >
              Book a conversation
            </Link>
          </div>

          <p className="mt-8 font-mono text-xs uppercase tracking-wider text-ground/55">
            Built at Comfort Keepers #974 in Olympia, WA. Running on live operations.
          </p>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            The reality
          </div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            Every home care agency
            <br />
            has the same six problems.
          </h2>

          <div className="mt-12 max-w-3xl space-y-5 text-lg leading-relaxed text-ground/80">
            <p className="font-medium text-ground">We know because we own one.</p>
            <p>
              Recruiting pipelines held together by a 90-step manual checklist.
              1,274 compliance records tracked on spreadsheets and prayer.
              Leads sitting uncontacted for over a month because intake is swamped.
              Open shifts costing $2-4K a week because fill is a manual phone tree.
              Referral sources not getting called because nobody has time on a Tuesday.
              Marketing that never happens because operations always comes first.
            </p>
            <p>
              These aren't your failures. They're the structural constraints of running
              a home care agency with a human team. We built a different kind of team.
            </p>
          </div>
        </div>
      </section>

      {/* AGENTS */}
      <section className="bg-ground text-white">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-wider text-white/60 mb-6">
            The fleet
          </div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            Ten agents. Each one owns a domain.
            <br />
            <span className="text-bolt">None of them take days off.</span>
          </h2>

          <div className="mt-16 grid gap-px bg-white/10 md:grid-cols-2">
            {agents.map((agent) => (
              <div key={agent.name} className="bg-ground p-8 flex flex-col">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-2xl font-bold tracking-tight">{agent.name}</h3>
                  <span className="font-mono text-xs uppercase tracking-wider text-bolt">
                    {agent.domain}
                  </span>
                </div>
                <ul className="mt-5 space-y-2 text-white/75 text-sm leading-relaxed">
                  {agent.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="text-bolt mt-1">—</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {agent.stat && (
                  <div className="mt-6 pt-5 border-t border-white/10 font-mono text-xs uppercase tracking-wider text-white/50">
                    {agent.stat}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/about/agents"
              className="inline-flex items-center text-bolt hover:underline font-medium"
            >
              See the full fleet →
            </Link>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            Built on real operations
          </div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            This isn't a demo environment.
          </h2>

          <div className="mt-12 grid md:grid-cols-3 gap-10 md:gap-6">
            <div className="md:col-span-2 max-w-2xl space-y-5 text-lg leading-relaxed text-ground/80">
              <p>
                Groundwork was built inside Comfort Keepers #974 in Olympia, WA —
                a home care franchise with 91 active caregivers and 62 active clients.
              </p>
              <p>
                The agents are running now. SCOUT monitors 1,274 compliance records daily.
                ATLAS posts to Facebook and sends a weekly marketing pulse every Monday.
                REED manages the recruiting pipeline. MAXWELL handles billing.
              </p>
              <p>
                We didn't build Groundwork to sell software. We built it to run our agency.
                Then we realized every agency owner we talked to had the same problems.
              </p>
            </div>

            <div className="space-y-6">
              <Stat number="91" label="active caregivers" />
              <Stat number="62" label="active clients" />
              <Stat number="1,274" label="compliance records monitored" />
              <Stat number="24/7" label="agents running" />
            </div>
          </div>
        </div>
      </section>

      {/* TIERS */}
      <section className="border-t border-ground/10 bg-bone">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            How to work with us
          </div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            Two ways in.
          </h2>

          <div className="mt-16 grid md:grid-cols-2 gap-6">
            <TierCard
              name="Done-For-You"
              price="$300–500 / month"
              body="We run the agents for you. Your team gets the outputs — compliance monitoring, lead follow-up, billing automation, recruiting support, digital marketing. No technical lift required."
            />
            <TierCard
              name="Done-With-You"
              price="~$1,000–1,500 / month"
              body="We set it up together. Includes the full implementation playbook, guided setup, and ongoing support. Your team owns the system at the end."
              accent
            />
          </div>

          <p className="mt-10 max-w-2xl text-ground/70 leading-relaxed">
            Starting with a small group of agencies — ones where we can be close to the
            implementation and make sure it works for your specific operation before we
            scale wider.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ground text-white">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.02]">
            If you recognize your agency
            <br />
            in everything above —
          </h2>

          <div className="mt-10 max-w-2xl space-y-5 text-lg text-white/75 leading-relaxed">
            <p>
              We're not running a sales process. We're having conversations with
              operators who are tired of the same problems.
            </p>
            <p>
              No demo call required. Tell us about your agency and we'll tell you
              honestly whether this is a fit.
            </p>
          </div>

          <div className="mt-10">
            <Link
              href="/about/book"
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

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div>
      <div className="text-4xl font-bold tracking-tight">{number}</div>
      <div className="mt-1 font-mono text-xs uppercase tracking-wider text-ground/55">
        {label}
      </div>
    </div>
  );
}

function TierCard({
  name,
  price,
  body,
  accent = false,
}: {
  name: string;
  price: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "border-2 border-ground p-8 md:p-10 relative bg-bone"
          : "border border-ground/20 p-8 md:p-10 bg-bone"
      }
    >
      {accent && (
        <span className="absolute -top-3 left-8 bg-bolt text-ground text-xs font-mono uppercase tracking-wider px-2 py-1">
          Implementation
        </span>
      )}
      <h3 className="text-2xl font-bold tracking-tight">{name}</h3>
      <div className="mt-2 text-xl font-mono">{price}</div>
      <p className="mt-6 text-ground/75 leading-relaxed">{body}</p>
    </div>
  );
}
