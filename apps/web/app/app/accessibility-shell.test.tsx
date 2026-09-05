import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "../layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/share",
}));

describe("app shell accessibility", () => {
  it("exposes skip navigation, a stable main target, and active primary navigation", () => {
    vi.stubGlobal("React", React);

    const html = renderToStaticMarkup(
      <RootLayout>
        <div />
      </RootLayout>,
    );

    expect(html).toContain('class="skip-link"');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<main class="main" id="main-content"');
    expect(countOccurrences(html, "data-primary-navigation-item")).toBe(5);
    expect(countOccurrences(html, 'aria-current="page"')).toBe(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/app\/share"/);
  });
});

function countOccurrences(value: string, token: string) {
  return value.split(token).length - 1;
}
