"use client";

import type { Metadata } from "next";
import { useState } from "react";

export default function BookPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("https://2.24.115.50:8901/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setStatus("done");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <section>
        <div className="mx-auto max-w-3xl px-6 pt-20 pb-24 md:pt-28">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
            Received
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[0.95]">
            You&apos;ll hear from John<br />
            <span className="text-bolt">within 24 hours.</span>
          </h1>
          <p className="mt-8 text-lg text-ground/75 leading-relaxed max-w-2xl">
            Not a template. John will research your agency and come back with
            a specific breakdown of what this would look like for your operation.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mx-auto max-w-3xl px-6 pt-20 pb-24 md:pt-28">
        <div className="font-mono text-xs uppercase tracking-wider text-ground/60 mb-6">
          Start here
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[0.95]">
          Tell us about<br />your agency.
        </h1>
        <p className="mt-8 text-lg text-ground/75 leading-relaxed max-w-2xl">
          Fill this out and John — our operations agent — will research your agency
          and respond with a specific, relevant breakdown within 24 hours.
          No sales call. No template email.
        </p>

        <form onSubmit={handleSubmit} className="mt-12 space-y-6">
          <div className="grid sm:grid-cols-2 gap-6">
            <Field name="name" label="Your name" required />
            <Field name="email" label="Your email" type="email" required />
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <Field name="agency" label="Agency name" required />
            <Field name="state" label="State" required />
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <Field name="headcount" label="Caregiver headcount (approx)" type="number" required />
            <Field name="phone" label="Best phone number" type="tel" />
          </div>

          <div>
            <label
              htmlFor="headache"
              className="block font-mono text-xs uppercase tracking-wider text-ground/60 mb-2"
            >
              Your biggest operational headache right now
            </label>
            <textarea
              id="headache"
              name="headache"
              rows={5}
              required
              className="w-full bg-bone border border-ground/20 px-4 py-3 text-ground placeholder-ground/40 focus:outline-none focus:border-ground transition-colors resize-y"
              placeholder="Free text. What's actually broken in your operation."
            />
          </div>

          {status === "error" && (
            <p className="text-sm text-red-600 font-mono">
              Something went wrong. Try again or email hello@gwork.tech.
            </p>
          )}

          <div className="pt-4">
            <button
              type="submit"
              disabled={status === "submitting"}
              className="inline-flex items-center bg-ground text-white px-6 py-3.5 font-medium hover:bg-ground/90 transition-colors disabled:opacity-50"
            >
              {status === "submitting" ? "Sending..." : "Send it →"}
            </button>
          </div>
        </form>

        <div className="mt-16 pt-10 border-t border-ground/10 text-sm text-ground/50 font-mono">
          John responds within 24 hours. No automated sequences.
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
        {label}{required && <span className="text-bolt ml-1">*</span>}
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
