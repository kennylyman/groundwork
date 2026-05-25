import Link from "next/link";
import Wordmark from "./Wordmark";

export default function Nav() {
  return (
    <header className="border-b border-ground/10">
      <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Groundwork home">
          <Wordmark size={24} />
        </Link>

        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-wider text-ground/60 hover:text-ground transition-colors"
        >
          ← Talk to John
        </Link>
      </div>
    </header>
  );
}
