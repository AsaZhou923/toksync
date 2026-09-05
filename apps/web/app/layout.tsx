import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { AppNavigation } from "../components/AppNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokSync",
  description: "Metrics-only AI coding usage sync for multiple devices.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="shell">
          <aside className="sidebar" aria-label="TokSync navigation">
            <Link className="sidebar-brand" href="/">
              <span className="brand-mark">TS</span>
              <span>TokSync</span>
            </Link>
            <AppNavigation />
            <div className="sidebar-footer">
              <Link className="sidebar-help-link" href="/docs">
                <BookOpen size={16} />
                Help &amp; docs
              </Link>
              <span>Private metrics by default.</span>
            </div>
          </aside>
          <main className="main" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
