import { describe, expect, it, vi } from "vitest";
import { clientApiFetch } from "./client-api";

describe("client API fetch", () => {
  it("sends hosted cookies while preserving the dev-auth username header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clientApiFetch(
      "/v1/settings/tokens",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
      "alice",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);

    expect(url).toBe("http://localhost:4000/v1/settings/tokens");
    expect(init?.credentials).toBe("include");
    expect(init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-TokSync-User")).toBe("alice");
  });
});
