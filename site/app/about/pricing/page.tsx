import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Groundwork",
  description:
    "Straightforward pricing. No implementation fees. No annual lock-in.",
  robots: "noindex, nofollow",
};

const faqs = [
  {
    q: "What systems do you connect to?",
    a: "Viv Technologies, RingCentral, DocuSign, CareAcademy, iSolved, Microsoft Teams, Outlook, Facebook, Google Business Profile. Others on request.",
  },
  {
    q: "Do we need to change our current software?",
    a: "No. The agents layer on top of what you already use.",
  },
  {
    q: "What if it doesn't work for our operation?",
    a: "We don't take on agencies we can't serve. If we get into onboarding and it's not a fit, we'll tell you.",
  },
  {
    q: "Is there a contract?",
    a: "Month-to-month. Cancel anytime.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section>
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-12 md:pt-28">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            Pricing
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[0.95] max-w-4xl">
            Straightforward pricing.
            <br />
            <span className="text-ground/55">No implementation fees. No annual lock-in.</span>
          </h1>
        </div>
      </section>

      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-6">
            <TierCard
              name="Done-For-You"
              price="$300–500"
              period="/ month"
              body="We run the agents for you. Your team gets the outputs — compliance monitoring, lead follow-up, billing automation, recruiting support, digital marketing. No technical lift required."
              includes={[
                "All 10 agents running on your operation",
                "Daily morning briefing",
                "Monthly review of outputs",
                "We handle agent tuning and escalation logic",
              ]}
            />
            <TierCard
              name="Done-With-You"
              price="~$1,000–1,500"
              period="/ month"
              body="We set it up together. Includes the full implementation playbook, guided setup, and ongoing support. Your team owns the system at the end."
              includes={[
                "Everything in Done-For-You",
                "Full implementation playbook",
                "Guided setup with your team",
                "Knowledge transfer + ownership handoff",
              ]}
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

      <section className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            FAQ
          </div>
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
            Things people ask.
          </h2>

          <div className="mt-12 divide-y divide-ground/10 border-y border-ground/10">
            {faqs.map((faq) => (
              <div key={faq.q} className="grid md:grid-cols-12 gap-6 py-8">
                <h3 className="md:col-span-4 text-lg font-bold tracking-tight">
                  {faq.q}
                </h3>
                <p className="md:col-span-8 text-ground/80 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-ground text-white">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] max-w-3xl">
            One conversation tells us if this fits.
          </h2>
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

function TierCard({
  name,
  price,
  period,
  body,
  includes,
  accent = false,
}: {
  name: string;
  price: string;
  period: string;
  body: string;
  includes: string[];
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
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl md:text-4xl font-bold tracking-tight">{price}</span>
        <span className="text-ground/55 font-mono text-sm">{period}</span>
      </div>
      <p className="mt-6 text-ground/75 leading-relaxed">{body}</p>

      <ul className="mt-8 space-y-2 text-sm text-ground/80">
        {includes.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="text-ground/40 mt-0.5">→</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>

      <Link
        href="/about/book"
        className="mt-10 inline-flex items-center bg-ground text-white px-5 py-3 font-medium hover:bg-ground/90 transition-colors"
      >
        Start with {name} →
      </Link>
    </div>
  );
}
