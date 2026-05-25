import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a conversation — Groundwork",
  description:
    "Tell us about your agency. We'll follow up within one business day — no automated sequences, just a real response.",
};

export default function BookPage() {
  return (
    <section>
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24 md:pt-28">
        <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
          Start a conversation
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[0.95]">
          Tell us about your agency.
        </h1>
        <p className="mt-8 text-lg text-ground/75 leading-relaxed max-w-2xl">
          We're starting with a small group. Fill this out and we'll follow up within
          one business day — no automated sequences, just a real response.
        </p>

        <form
          action="https://formspree.io/f/placeholder"
          method="POST"
          className="mt-12 space-y-6"
        >
          <Field name="name" label="Your name" required />
          <Field name="agency" label="Agency name" required />

          <div className="grid sm:grid-cols-2 gap-6">
            <Field name="state" label="State" required />
            <Field
              name="headcount"
              label="Approximate caregiver headcount"
              type="number"
              required
            />
          </div>

          <Field name="phone" label="Best phone number" type="tel" required />

          <div>
            <label
              htmlFor="headache"
              className="block font-mono text-xs uppercase tracking-wider text-ground/60 mb-2"
            >
              Your current biggest operational headache
            </label>
            <textarea
              id="headache"
              name="headache"
              rows={5}
              required
              className="w-full bg-bone border border-ground/20 px-4 py-3 text-ground placeholder-ground/40 focus:outline-none focus:border-ground transition-colors resize-y"
              placeholder="Free text. Tell us what's actually broken."
            />
          </div>

          <div className="pt-4 flex flex-wrap items-center gap-6">
            <button
              type="submit"
              className="inline-flex items-center bg-ground text-white px-6 py-3.5 font-medium hover:bg-ground/90 transition-colors"
            >
              Send it →
            </button>
            <span className="text-sm text-ground/55 font-mono">
              We'll get back within 1 business day.
            </span>
          </div>
        </form>

        <div className="mt-16 pt-10 border-t border-ground/10 text-sm text-ground/60">
          Or email directly:{" "}
          <a
            href="mailto:hello@gwork.tech"
            className="text-ground underline underline-offset-4 decoration-bolt decoration-[3px]"
          >
            hello@gwork.tech
          </a>
        </div>
      </div>
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block font-mono text-xs uppercase tracking-wider text-ground/60 mb-2"
      >
        {label}
        {required && <span className="text-ground/40"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full bg-bone border border-ground/20 px-4 py-3 text-ground placeholder-ground/40 focus:outline-none focus:border-ground transition-colors"
      />
    </div>
  );
}
