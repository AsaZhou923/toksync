const API_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000";
const USER = process.env.TOKSYNC_DEV_USER || "demo";

export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      headers: { "X-TokSync-User": USER },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export { USER };
