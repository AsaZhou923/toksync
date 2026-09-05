"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  LayoutDashboard,
  RefreshCcw,
  Settings as SettingsIcon,
  Share2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/sync", label: "Sync", icon: RefreshCcw },
  { href: "/app/sources", label: "Sources", icon: Database },
  { href: "/app/share", label: "Share", icon: Share2 },
  { href: "/app/settings", label: "Settings", icon: SettingsIcon },
] as const;

export function AppNavigation() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/app" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="nav-link"
            data-active={isActive ? "true" : undefined}
            data-primary-navigation-item
            href={item.href as Route}
            key={item.label}
          >
            <span className="nav-main">
              <Icon size={16} />
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
