import type { Metadata } from "next";
import "./globals.css";
import { ChromeNav, ChromeFooter } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "Groundwork — AI agents that run home care operations",
  description:
    "Talk to John. He'll tell you what Groundwork's agent fleet would do for your home care operation.",
  metadataBase: new URL("https://gwork.tech"),
  openGraph: {
    title: "Groundwork — AI agents that run home care operations",
    description:
      "A fleet of AI agents that autonomously run home care agency operations. Built at Comfort Keepers #974 in Olympia, WA.",
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
