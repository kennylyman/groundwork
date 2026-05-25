import Link from "next/link";
import Wordmark from "./Wordmark";

const links = [
  { href: "/agents", label: "Agents" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export default function Nav() {
  return (
    <header className="border-b border-ground/10">
      <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Groundwork home">
          <Wordmark size={24} />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-ground/70 hover:text-ground transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/book"
            className="inline-flex items-center bg-ground text-white px-4 py-2 text-sm font-medium hover:bg-ground/90 transition-colors"
          >
            Book a conversation
          </Link>
        </nav>

        <Link
          href="/book"
          className="md:hidden inline-flex items-center bg-ground text-white px-3 py-1.5 text-sm font-medium"
        >
          Book
        </Link>
      </div>
    </header>
  );
}
