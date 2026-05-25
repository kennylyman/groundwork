import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works — Groundwork",
  description:
    "From zero to running in weeks, not months. Intake conversation, configuration, supervised launch, handoff.",
  robots: "noindex, nofollow",
};

const steps = [
  {
    n: "01",
    title: "Intake conversation",
    body: "We talk through your operation. ATS, billing system, communication tools, compliance requirements, current team structure. No assumptions.",
  },
  {
    n: "02",
    title: "Configuration",
    body: "We configure the agents for your specific workflows. Viv, or whatever ATS you use. Your payer mix. Your compliance items. Your caregiver geography.",
  },
  {
    n: "03",
    title: "Supervised launch",
    body: "Agents go live in monitoring mode first. We watch what they surface, tune the logic, confirm the escalation paths. Nothing autonomous until we're confident in the outputs.",
  },
  {
    n: "04",
    title: "Handoff",
    body: "Your team gets a morning briefing every day. John (the orchestrating agent) surfaces what matters and filters the noise. Your people make the calls that require human judgment. Everything else runs on its own.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section>
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            The process
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95] max-w-4xl">
            From zero to running in weeks, not months.
          </h1>
        </div>
      </section>

      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <ol className="space-y-px bg-ground/10">
            {steps.map((step) => (
              <li
                key={step.n}
                className="bg-bone grid md:grid-cols-12 gap-6 p-8 md:p-12"
              >
                <div className="md:col-span-3">
                  <div className="font-mono text-sm text-ground/50">Step {step.n}</div>
                  <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                    {step.title}
                  </h2>
                </div>
                <p className="md:col-span-9 text-lg leading-relaxed text-ground/80 md:pt-1">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32 grid md:grid-cols-3 gap-10">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-3">
              What we need from you
            </div>
            <ul className="space-y-2 text-ground/80">
              <li>— Access to your ATS, EVV, and billing tools</li>
              <li>— A point person on your team to answer questions</li>
              <li>— Honesty about what's actually broken</li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-3">
              What we handle
            </div>
            <ul className="space-y-2 text-ground/80">
              <li>— Agent configuration and integration</li>
              <li>— Escalation rules and escalation paths</li>
              <li>— Daily monitoring and tuning</li>
            </ul>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-3">
              How long it takes
            </div>
            <ul className="space-y-2 text-ground/80">
              <li>— Intake: 1 conversation</li>
              <li>— Configuration: 1–2 weeks</li>
              <li>— Supervised launch: 2–4 weeks</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-ground text-white">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] max-w-3xl">
            We want to talk to you before we sell to you.
          </h2>
          <p className="mt-6 max-w-2xl text-white/70 text-lg leading-relaxed">
            If your operation isn't a fit, we'll tell you. If it is, the next conversation
            is about your specific workflow — not a pitch deck.
          </p>
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
