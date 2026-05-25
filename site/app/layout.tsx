import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Groundwork — AI agents that run home care operations",
  description:
    "Groundwork deploys a fleet of AI agents across recruiting, compliance, billing, intake, marketing, and shift fill. They run autonomously. Your team handles the exceptions.",
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
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
