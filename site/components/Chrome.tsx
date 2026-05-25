"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";
import Footer from "./Footer";

export function ChromeNav() {
  const pathname = usePathname() ?? "/";
  if (!pathname.startsWith("/about")) return null;
  return <Nav />;
}

export function ChromeFooter() {
  const pathname = usePathname() ?? "/";
  if (!pathname.startsWith("/about")) return null;
  return <Footer />;
}
