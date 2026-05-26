import Link from "next/link";
import Wordmark from "@/components/Wordmark";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bone)", color: "var(--ground)" }}>
      {/* SECTION 1 — Hero */}
      <section className="flex-1 flex flex-col items-center justify-center min-h-screen px-6 py-20 text-center">
        <div className="mb-10">
          <Wordmark size={48} />
        </div>

        <h1
          className="font-bold tracking-tight leading-tight mb-6"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "clamp(32px, 6vw, 48px)",
          }}
        >
          Two products. One purpose:
          <br />
          make AI do the work.
        </h1>

        <p
          className="uppercase tracking-widest text-ground/50"
          style={{ fontFamily: "var(--font-mono)", fontSize: "14px" }}
        >
          AI SETUP WIZARDS THAT ACTUALLY BUILD THINGS.
        </p>
      </section>

      {/* SECTION 2 — Product Cards */}
      <section className="px-6 pb-20">
        <div className="mx-auto max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-6 items-stretch">
          {/* Card 1 — Groundwork */}
          <div
            className="flex flex-col p-10"
            style={{
              background: "var(--ground)",
              color: "var(--bone)",
              border: "2px solid var(--ground)",
              borderRadius: 0,
            }}
          >
            <div
              className="font-bold uppercase tracking-widest mb-6"
              style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--bone)" }}
            >
              GROUNDWORK
            </div>

            <h2
              className="font-bold leading-tight mb-6"
              style={{ fontFamily: "var(--font-sans)", fontSize: "24px", color: "var(--bone)" }}
            >
              AI agent setup wizard
              <br />
              for home care agencies.
            </h2>

            <p
              className="leading-relaxed mb-6 flex-1"
              style={{ color: "rgba(243,241,234,0.65)", fontSize: "16px" }}
            >
              We map your operation,
              <br />
              build your agent fleet,
              <br />
              hand you the keys.
            </p>

            <p
              className="mb-8 leading-relaxed"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "rgba(243,241,234,0.45)",
                letterSpacing: "0.04em",
              }}
            >
              Recruiting. Compliance.
              <br />
              Billing. Intake. Scheduling.
            </p>

            <Link
              href="/groundwork"
              className="self-start font-bold uppercase tracking-wider transition-opacity hover:opacity-70"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--bolt)",
              }}
            >
              Talk to John →
            </Link>
          </div>

          {/* Card 2 — Guided */}
          <div
            className="flex flex-col p-10"
            style={{
              background: "var(--ground)",
              color: "var(--bone)",
              border: "2px solid var(--ground)",
              borderLeft: "3px solid var(--bolt)",
              borderRadius: 0,
            }}
          >
            <div
              className="flex items-center justify-between mb-6"
            >
              <span
                className="font-bold uppercase tracking-widest"
                style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--bone)" }}
              >
                GUIDED
              </span>
              <span style={{ color: "var(--bolt)", fontSize: "16px" }}>⚡</span>
            </div>

            <h2
              className="font-bold leading-tight mb-6"
              style={{ fontFamily: "var(--font-sans)", fontSize: "24px", color: "var(--bone)" }}
            >
              AI build wizard for
              <br />
              everyone else.
            </h2>

            <p
              className="leading-relaxed mb-6 flex-1"
              style={{ color: "rgba(243,241,234,0.65)", fontSize: "16px" }}
            >
              Tell John what you want.
              <br />
              He picks the tools, writes
              <br />
              the prompts, watches your
              <br />
              screen, builds it with you.
            </p>

            <p
              className="mb-8 leading-relaxed"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "rgba(243,241,234,0.45)",
                letterSpacing: "0.04em",
              }}
            >
              No code. No tech skills.
              <br />
              Just tell him the problem.
            </p>

            <a
              href="https://guided.gwork.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="self-start font-bold uppercase tracking-wider transition-opacity hover:opacity-70"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--bolt)",
              }}
            >
              Start Building →
            </a>
          </div>
        </div>
      </section>

      {/* SECTION 3 — Footer */}
      <footer className="py-8 px-6 text-center">
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "rgba(10,10,10,0.4)",
            letterSpacing: "0.04em",
          }}
        >
          gwork.tech&nbsp;&nbsp;·&nbsp;&nbsp;2026&nbsp;&nbsp;·&nbsp;&nbsp;hello@gwork.tech
        </p>
      </footer>
    </div>
  );
}
