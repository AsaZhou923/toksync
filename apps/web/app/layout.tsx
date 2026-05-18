import type { Metadata, Route, Viewport } from "next";
import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  Database,
  Download,
  FileCheck2,
  FolderKanban,
  Gauge,
  Monitor,
  Radar,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  Workflow,
} from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokSync",
  description: "Metrics-only AI coding usage sync for multiple devices.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const NAV_GROUPS = [
  {
    title: "Monitor",
    items: [
      { href: "/app", label: "Overview", icon: Gauge, badge: "live" },
      { href: "/app/activity", label: "Activity", icon: Activity },
      { href: "/app/sources", label: "Sources", icon: Database },
      { href: "/app/models", label: "Models", icon: Workflow },
      { href: "/app/projects", label: "Projects", icon: FolderKanban },
      {
        href: "/app/budgets",
        label: "Guardrails",
        icon: ShieldAlert,
        badge: "v0.3",
      },
    ],
  },
  {
    title: "Sync",
    items: [
      { href: "/app/devices", label: "Devices", icon: Monitor },
      { href: "/app/sync-runs", label: "Sync runs", icon: Workflow },
      {
        href: "/app/merge",
        label: "Merge Copilot",
        icon: ShieldCheck,
        badge: "v0.2",
      },
      {
        href: "/app/receipts",
        label: "Receipts",
        icon: FileCheck2,
        badge: "proof",
      },
      {
        href: "/app/health",
        label: "Health",
        icon: Radar,
        badge: "radar",
      },
      {
        href: "/app/exports",
        label: "Local viewer",
        icon: Download,
        badge: "local",
      },
    ],
  },
  {
    title: "Share",
    items: [
      { href: "/app/embed", label: "README embed", icon: BadgeCheck },
      {
        href: "/app/leaderboard",
        label: "Leaderboard",
        icon: Trophy,
        badge: "opt-in",
      },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/app/settings", label: "Settings", icon: Settings },
      { href: "/docs", label: "Docs", icon: BookOpen },
    ],
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar" aria-label="TokSync navigation">
            <Link className="sidebar-brand" href="/">
              <span className="brand-mark">TS</span>
              <span>TokSync</span>
            </Link>
            <div className="sidebar-status">
              <div className="status-line">
                <span className="muted">payload</span>
                <strong>metrics-only</strong>
              </div>
              <div className="status-line">
                <span className="muted">public data</span>
                <strong>opt-in</strong>
              </div>
            </div>
            <nav className="nav">
              {NAV_GROUPS.map((group) => (
                <div className="nav-section" key={group.title}>
                  <p className="nav-title">{group.title}</p>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const content = (
                      <>
                        <span className="nav-main">
                          <Icon size={16} />
                          {item.label}
                        </span>
                        {item.badge ? (
                          <span className="nav-badge">{item.badge}</span>
                        ) : null}
                      </>
                    );

                    return item.href ? (
                      <Link
                        className="nav-link"
                        href={item.href as Route}
                        key={item.label}
                      >
                        {content}
                      </Link>
                    ) : (
                      <span className="nav-link soon" key={item.label}>
                        {content}
                      </span>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
