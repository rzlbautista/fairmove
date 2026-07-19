"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileCheck2, LayoutDashboard, Menu, PhoneCall, Plus, X } from "lucide-react";
import { useState } from "react";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs/new", label: "New move", icon: Plus },
  { href: "/calls", label: "Call logs", icon: PhoneCall },
  { href: "/results", label: "Results", icon: FileCheck2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = (
    <>
      <div className="sidebar-brand">
        <div className="brand-mark">F</div>
        <div>
          <div className="sidebar-name">FairMove</div>
          <div className="sidebar-caption">The Negotiator</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`nav-link ${active ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <span className="status-dot" />
        <span>Hackathon workspace</span>
      </div>
    </>
  );

  return (
    <div className="app-layout">
      <aside className="sidebar">{links}</aside>
      {mobileOpen && (
        <div className="mobile-drawer">
          <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
          <aside className="mobile-sidebar">
            <button className="icon-button close-menu" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X size={19} />
            </button>
            {links}
          </aside>
        </div>
      )}
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            Voice agents that call, compare, and negotiate
          </div>
          <div className="mode-pill live">ElevenLabs ready</div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
