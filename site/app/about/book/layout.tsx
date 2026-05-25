import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tell us about your agency — Groundwork",
  description:
    "Fill this out and John will research your agency and respond with a specific breakdown within 24 hours.",
  robots: "noindex, nofollow",
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
