"use client";

import { useState } from "react";
import {
  PublicProfileForm,
  type PublicProfileState,
} from "./PublicProfileForm";

export function PublicEmbedPanel({
  username,
  initial,
  profileUrl,
  badgeUrl,
  costBadgeUrl,
  cardUrl,
}: {
  username: string;
  initial: PublicProfileState;
  profileUrl: string;
  badgeUrl: string;
  costBadgeUrl: string;
  cardUrl: string;
}) {
  const [profile, setProfile] = useState(initial);
  const [cacheKey, setCacheKey] = useState(0);

  function handleSaved(next: PublicProfileState) {
    setProfile(next);
    setCacheKey((current) => current + 1);
  }

  const badgePreviewUrl = withCacheKey(badgeUrl, cacheKey);
  const costBadgePreviewUrl = withCacheKey(costBadgeUrl, cacheKey);
  const cardPreviewUrl = withCacheKey(cardUrl, cacheKey);

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
          <div className="svg-preview">
            <img src={badgePreviewUrl} alt="TokSync badge preview" />
          </div>
          <div className="svg-preview">
            <img src={costBadgePreviewUrl} alt="TokSync cost badge preview" />
          </div>
          <div className="svg-preview">
            <img src={cardPreviewUrl} alt="TokSync profile card preview" />
          </div>
        </div>
      </section>
      <div className="snippet-grid">
        <div className="command" data-testid="badge-snippet">
          {`![TokSync](${badgeUrl})`}
        </div>
        <div className="command" data-testid="card-snippet">
          {`![TokSync profile](${cardUrl})`}
        </div>
      </div>
    </>
  );
}

function withCacheKey(url: string, cacheKey: number) {
  if (cacheKey === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}preview=${cacheKey}`;
}
