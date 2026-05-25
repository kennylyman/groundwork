import Link from "next/link";
import Wordmark from "./Wordmark";

export default function Footer() {
  return (
    <footer className="border-t border-ground/10 mt-24">
      <div className="mx-auto max-w-6xl px-6 py-12 grid gap-10 md:grid-cols-3">
        <div>
          <Wordmark size={22} />
          <p className="mt-4 text-sm text-ground/60 max-w-xs leading-relaxed">
            AI agents that run home care operations — so your team can focus on care.
          </p>
        </div>

        <div className="text-sm">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/50 mb-3">
            Groundwork
          </div>
          <ul className="space-y-2">
            <li><Link href="/agents" className="hover:underline">Agents</Link></li>
            <li><Link href="/how-it-works" className="hover:underline">How it works</Link></li>
            <li><Link href="/pricing" className="hover:underline">Pricing</Link></li>
            <li><Link href="/book" className="hover:underline">Book a conversation</Link></li>
          </ul>
        </div>

        <div className="text-sm">
          <div className="font-mono text-xs uppercase tracking-wider text-ground/50 mb-3">
            Built where
          </div>
          <p className="text-ground/70 leading-relaxed">
            Comfort Keepers #974<br />
            Olympia, WA
          </p>
        </div>
      </div>

      <div className="border-t border-ground/10">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row justify-between gap-2 text-xs text-ground/50 font-mono">
          <span>© {new Date().getFullYear()} Groundwork</span>
          <span>gwork.tech</span>
        </div>
      </div>
    </footer>
  );
}
