"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function clientApiUrl(path: string) {
  return `${API_URL}${path}`;
}

export function clientApiFetch(
  path: string,
  init: RequestInit,
  username: string,
) {
  const headers = new Headers(init.headers);
  headers.set("X-TokSync-User", username);

  return fetch(clientApiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
}
