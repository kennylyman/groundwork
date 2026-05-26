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

      {/* SECTION 3 — How Guided Works */}
      <section className="px-6 py-24" style={{ background: "var(--bone)" }}>
        <div className="mx-auto max-w-5xl">
          <p
            className="uppercase tracking-widest mb-4"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "rgba(10,10,10,0.45)" }}
          >
            HOW GUIDED WORKS
          </p>
          <h2
            className="font-bold leading-tight mb-16"
            style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(24px, 4vw, 36px)", color: "var(--ground)" }}
          >
            Three steps. No tech degree required.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:gap-px" style={{ background: "var(--ground)" }}>
            {/* Step 1 */}
            <div className="flex flex-col p-10" style={{ background: "var(--bone)" }}>
              <div
                className="font-bold mb-6"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "48px",
                  color: "var(--bolt)",
                  lineHeight: 1,
                  WebkitTextStroke: "2px var(--ground)",
                }}
              >
                01
              </div>
              <h3
                className="font-bold mb-4"
                style={{ fontFamily: "var(--font-sans)", fontSize: "18px", color: "var(--ground)" }}
              >
                Tell John your problem.
                <br />
                Not the solution.
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                Don&apos;t know which tool to use? Good. John doesn&apos;t need you to.
                Just describe what&apos;s eating your time or driving you crazy.
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex flex-col p-10" style={{ background: "var(--bone)" }}>
              <div
                className="font-bold mb-6"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "48px",
                  color: "var(--bolt)",
                  lineHeight: 1,
                  WebkitTextStroke: "2px var(--ground)",
                }}
              >
                02
              </div>
              <h3
                className="font-bold mb-4"
                style={{ fontFamily: "var(--font-sans)", fontSize: "18px", color: "var(--ground)" }}
              >
                John picks the tools,
                <br />
                maps the build.
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                John figures out the stack. Writes the prompts. Lays out every step
                before you touch a single button.
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex flex-col p-10" style={{ background: "var(--bone)" }}>
              <div
                className="font-bold mb-6"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "48px",
                  color: "var(--bolt)",
                  lineHeight: 1,
                  WebkitTextStroke: "2px var(--ground)",
                }}
              >
                03
              </div>
              <h3
                className="font-bold mb-4"
                style={{ fontFamily: "var(--font-sans)", fontSize: "18px", color: "var(--ground)" }}
              >
                Follow along as John
                <br />
                guides every click.
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                John watches your screen in real time. You&apos;re never stuck.
                You&apos;re never guessing. You leave with a working automation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4 — Social Proof */}
      <section className="px-6 py-24" style={{ background: "var(--ground)" }}>
        <div className="mx-auto max-w-3xl text-center">
          <div
            className="mb-8"
            style={{ color: "var(--bolt)", fontSize: "32px", letterSpacing: "-0.02em" }}
          >
            &ldquo;
          </div>
          <blockquote
            className="font-bold leading-snug mb-8"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "clamp(22px, 3.5vw, 32px)",
              color: "var(--bone)",
              letterSpacing: "-0.01em",
            }}
          >
            I set up my entire email automation in 23 minutes.
            <br />
            I&apos;ve been meaning to do it for 6 months.
          </blockquote>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "rgba(243,241,234,0.4)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            — Early user, bakery owner
          </p>
        </div>
      </section>

      {/* SECTION 5 — Who Is Guided For? */}
      <section className="px-6 py-24" style={{ background: "var(--bone)" }}>
        <div className="mx-auto max-w-5xl">
          <p
            className="uppercase tracking-widest mb-4"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "rgba(10,10,10,0.45)" }}
          >
            WHO IT&apos;S FOR
          </p>
          <h2
            className="font-bold leading-tight mb-16"
            style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(24px, 4vw, 36px)", color: "var(--ground)" }}
          >
            If you&apos;ve ever said &ldquo;there has to be a better way&rdquo; —<br />
            this is for you.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background: "var(--ground)" }}>
            <div className="p-10" style={{ background: "var(--bone)" }}>
              <div style={{ color: "var(--bolt)", fontSize: "20px", marginBottom: "12px" }}>⚡</div>
              <h3
                className="font-bold mb-3"
                style={{ fontFamily: "var(--font-sans)", fontSize: "16px", color: "var(--ground)" }}
              >
                Small business owners
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                Who answer the same questions all day, every day — and know
                there&apos;s a smarter way to run the operation.
              </p>
            </div>

            <div className="p-10" style={{ background: "var(--bone)" }}>
              <div style={{ color: "var(--bolt)", fontSize: "20px", marginBottom: "12px" }}>⚡</div>
              <h3
                className="font-bold mb-3"
                style={{ fontFamily: "var(--font-sans)", fontSize: "16px", color: "var(--ground)" }}
              >
                Freelancers
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                Who want to automate the boring parts — invoicing, follow-ups,
                scheduling — and spend more time on the work they actually get paid for.
              </p>
            </div>

            <div className="p-10" style={{ background: "var(--bone)" }}>
              <div style={{ color: "var(--bolt)", fontSize: "20px", marginBottom: "12px" }}>⚡</div>
              <h3
                className="font-bold mb-3"
                style={{ fontFamily: "var(--font-sans)", fontSize: "16px", color: "var(--ground)" }}
              >
                Creators
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.6)", lineHeight: 1.7 }}>
                Who know they need AI tools but don&apos;t know where to start —
                and don&apos;t have time to watch 12 YouTube tutorials to find out.
              </p>
            </div>

            <div className="p-10" style={{ background: "var(--bolt)" }}>
              <div style={{ fontSize: "20px", marginBottom: "12px" }}>→</div>
              <h3
                className="font-bold mb-3"
                style={{ fontFamily: "var(--font-sans)", fontSize: "16px", color: "var(--ground)" }}
              >
                Anyone who&apos;s said &ldquo;there has to be a better way&rdquo;
              </h3>
              <p style={{ fontSize: "15px", color: "rgba(10,10,10,0.7)", lineHeight: 1.7 }}>
                You don&apos;t need to know how to code. You don&apos;t need to
                understand AI. You just need 30 minutes and a problem worth solving.
              </p>
            </div>
          </div>

          <div className="mt-12 text-center">
            <a
              href="https://guided.gwork.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-bold uppercase tracking-wider transition-opacity hover:opacity-70"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
                color: "var(--ground)",
                border: "2px solid var(--ground)",
                padding: "14px 32px",
                borderRadius: 0,
              }}
            >
              Get your free guided build →
            </a>
          </div>
        </div>
      </section>

      {/* SECTION 6 — Footer */}
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
