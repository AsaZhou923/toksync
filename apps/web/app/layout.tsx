import type { Metadata } from "next";
import {
  Activity,
  BadgeCheck,
  Database,
  Gauge,
  Monitor,
  Settings,
  Workflow,
} from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokSync",
  description: "Metrics-only AI coding usage sync for multiple devices.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a className="brand" href="/">
              <span className="brand-mark">TS</span>
              <span>TokSync</span>
            </a>
            <nav className="nav">
              <a href="/app">
                <Gauge size={16} />
                App
              </a>
              <a href="/app/activity">
                <Activity size={16} />
                Activity
              </a>
              <a href="/app/devices">
                <Monitor size={16} />
                Devices
              </a>
              <a href="/app/sources">
                <Database size={16} />
                Sources
              </a>
              <a href="/app/sync-runs">
                <Workflow size={16} />
                Runs
              </a>
              <a href="/app/embed">
                <BadgeCheck size={16} />
                Embed
              </a>
              <a href="/app/settings">
                <Settings size={16} />
                Settings
              </a>
            </nav>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
