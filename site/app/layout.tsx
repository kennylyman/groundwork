import type { Metadata } from "next";
import "./globals.css";
import { ChromeNav, ChromeFooter } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "Groundwork — AI setup wizards that build what you need",
  description: "Two products. Groundwork sets up AI agent fleets for home care agencies. Guided helps anyone build with AI — no code, no tech skills needed.",
  metadataBase: new URL("https://gwork.tech"),
  openGraph: {
    title: "Groundwork — AI setup wizards",
    description: "Two products. One purpose: make AI do the work.",
    url: "https://gwork.tech",
    siteName: "Groundwork",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-bone text-ground">
        <ChromeNav />
        <main className="flex-1">{children}</main>
        <ChromeFooter />
      </body>
    </html>
  );
}
