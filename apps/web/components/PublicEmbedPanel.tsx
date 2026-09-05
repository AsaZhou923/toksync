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
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  function handleSaved(next: PublicProfileState) {
    setProfile(next);
    setCacheKey((current) => current + 1);
  }

  const encodedUsername = encodeURIComponent(username);
  const badgeUrl = `${apiBaseUrl}/v1/badge/${encodedUsername}.svg?metric=${metric}`;
  const cardUrl = `${apiBaseUrl}/v1/embed/${encodedUsername}.svg?theme=${theme}&metric=${metric}${compact ? "&compact=1" : ""}`;
  const shareUrl = `${apiBaseUrl}/v1/share/${encodedUsername}.svg?theme=${theme}&metric=${metric}`;
  const previewBadgeUrl = withCacheKey(badgeUrl, cacheKey);
  const previewCardUrl = withCacheKey(cardUrl, cacheKey);
  const previewShareUrl = withCacheKey(shareUrl, cacheKey);
  const recommendedSnippet = `![TokSync profile](${cardUrl})`;
  const badgeSnippet = `![TokSync](${badgeUrl})`;
  const shareSnippet = `![TokSync share](${shareUrl})`;

  async function copySnippet(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied`);
    } catch {
      setCopyMessage("Copy failed");
    }
  }

  return (
    <>
      <section className="grid grid-2" data-testid="recommended-share-flow">
        <PublicProfileForm
          initial={initial}
          username={username}
          onSaved={handleSaved}
          variant="profile-only"
        />
        <div className="card grid">
          <div className="metric-row">
            <div>
              <h2 className="section-title">Recommended profile card</h2>
              <p className="muted">
                One aggregate card for your README. Private events and paths
                never enter the public cache.
              </p>
            </div>
            <span className="pill" data-testid="embed-status">
              <span
                className={profile.enabled ? "status-dot" : "status-dot off"}
              />
              {profile.enabled ? "public" : "private"}
            </span>
          </div>
          {apiReady && profile.enabled ? (
            <div className="svg-preview" data-testid="recommended-profile-card">
              <img src={previewCardUrl} alt="TokSync profile card preview" />
            </div>
          ) : !profile.enabled ? (
            <div className="empty-state" data-testid="public-disabled-share">
              Enable and save the public profile before publishing this card.
            </div>
          ) : (
            <div className="empty-state">
              The API preview is offline. Try again after the local API is
              available.
            </div>
          )}
          <div className="command" data-testid="recommended-card-snippet">
            {recommendedSnippet}
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              data-share-copy-action
              data-testid="recommended-card-copy"
              disabled={!profile.enabled}
              type="button"
              onClick={() => copySnippet("Profile card", recommendedSnippet)}
            >
              <Copy size={16} />
              Copy
            </button>
            {copyMessage ? (
              <span className="pill good" role="status">
                {copyMessage}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <details className="card advanced-disclosure">
        <summary>Badge and card options</summary>
        <div className="grid advanced-disclosure-body">
          <p className="muted">
            Change theme, metric, or compact rendering only when the recommended
            profile card is not enough.
          </p>
          <div className="toolbar" aria-label="Advanced card options">
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
              Tokens
            </button>
            <button
              className={`segmented ${metric === "cost" ? "active" : ""}`}
              type="button"
              onClick={() => setMetric("cost")}
            >
              <MonitorCog size={14} />
              Cost estimate
            </button>
            <button
              className={`segmented ${compact ? "active" : ""}`}
              type="button"
              onClick={() => setCompact((current) => !current)}
            >
              Compact
            </button>
          </div>
          {apiReady && profile.enabled ? (
            <div className="grid grid-2">
              <div className="svg-preview">
                <img src={previewBadgeUrl} alt="TokSync badge preview" />
              </div>
              <div className="svg-preview">
                <img src={previewShareUrl} alt="TokSync share image preview" />
              </div>
            </div>
          ) : null}
          <div className="snippet-grid">
            <div className="command" data-testid="badge-snippet">
              {badgeSnippet}
            </div>
            <div className="command" data-testid="share-snippet">
              {shareSnippet}
            </div>
          </div>
          <div className="toolbar">
            <button
              className="btn"
              disabled={!profile.enabled}
              type="button"
              onClick={() => copySnippet("Badge", badgeSnippet)}
            >
              <Copy size={16} />
              Copy badge
            </button>
            <button
              className="btn"
              disabled={!profile.enabled}
              type="button"
              onClick={() => copySnippet("Share image", shareSnippet)}
            >
              <Copy size={16} />
              Copy share image
            </button>
            <a className="btn" href={profileUrl}>
              <Eye size={16} />
              Open public profile
            </a>
          </div>
        </div>
      </details>
    </>
  );
}

function withCacheKey(url: string, cacheKey: number) {
  return `${url}${url.includes("?") ? "&" : "?"}preview=${cacheKey}`;
}
