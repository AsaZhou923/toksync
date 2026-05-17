"use client";

import { useState } from "react";
import { Copy, Eye, MonitorCog, MoonStar, SunMedium } from "lucide-react";
import {
  PublicProfileForm,
  type PublicProfileState,
} from "./PublicProfileForm";

export function PublicEmbedPanel({
  username,
  initial,
  profileUrl,
  apiBaseUrl,
  apiReady,
}: {
  username: string;
  initial: PublicProfileState;
  profileUrl: string;
  apiBaseUrl: string;
  apiReady: boolean;
}) {
  const [profile, setProfile] = useState(initial);
  const [cacheKey, setCacheKey] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [compact, setCompact] = useState(false);

  function handleSaved(next: PublicProfileState) {
    setProfile(next);
    setCacheKey((current) => current + 1);
  }

  const encodedUsername = encodeURIComponent(username);
  const badgeUrl = `${apiBaseUrl}/v1/badge/${encodedUsername}.svg?metric=${metric}`;
  const cardUrl = `${apiBaseUrl}/v1/embed/${encodedUsername}.svg?theme=${theme}&metric=${metric}${compact ? "&compact=1" : ""}`;
  const previewBadgeUrl = withCacheKey(badgeUrl, cacheKey);
  const previewCardUrl = withCacheKey(cardUrl, cacheKey);

  return (
    <>
      <section className="grid grid-2">
        <PublicProfileForm
          initial={initial}
          username={username}
          viewPath={profileUrl}
          onSaved={handleSaved}
        />
        <div className="card grid">
          <div className="metric-row">
            <h2 className="section-title">Preview</h2>
            <span className="pill" data-testid="embed-status">
              <span
                className={profile.enabled ? "status-dot" : "status-dot off"}
              />
              {profile.enabled ? "public" : "private"}
            </span>
          </div>
          <div className="toolbar">
            <button
              className={`segmented ${theme === "dark" ? "active" : ""}`}
              type="button"
              onClick={() => setTheme("dark")}
            >
              <MoonStar size={14} />
              Dark
            </button>
            <button
              className={`segmented ${theme === "light" ? "active" : ""}`}
              type="button"
              onClick={() => setTheme("light")}
            >
              <SunMedium size={14} />
              Light
            </button>
            <button
              className={`segmented ${metric === "tokens" ? "active" : ""}`}
              type="button"
              onClick={() => setMetric("tokens")}
            >
              <Copy size={14} />
              Tokens
            </button>
            <button
              className={`segmented ${metric === "cost" ? "active" : ""}`}
              type="button"
              onClick={() => setMetric("cost")}
            >
              <MonitorCog size={14} />
              Cost
            </button>
            <button
              className={`segmented ${compact ? "active" : ""}`}
              type="button"
              onClick={() => setCompact((current) => !current)}
            >
              <Eye size={14} />
              Compact
            </button>
          </div>
          {apiReady ? (
            <>
              <div className="svg-preview">
                <img src={previewBadgeUrl} alt="TokSync badge preview" />
              </div>
              <div className="svg-preview">
                <img src={previewCardUrl} alt="TokSync profile card preview" />
              </div>
            </>
          ) : (
            <div className="empty-state">
              API preview is offline. Query controls and snippets stay ready,
              but SVG preview waits for the local API to come back.
            </div>
          )}
        </div>
      </section>
      <div className="snippet-grid">
        <div className="command" data-testid="badge-snippet">
          {`![TokSync](${badgeUrl})`}
        </div>
        <div className="command" data-testid="card-snippet">
          {`![TokSync profile](${cardUrl})`}
        </div>
        <a className="btn" href={profileUrl}>
          <Eye size={16} />
          Open public profile
        </a>
      </div>
    </>
  );
}

function withCacheKey(url: string, cacheKey: number) {
  if (cacheKey === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}preview=${cacheKey}`;
}
