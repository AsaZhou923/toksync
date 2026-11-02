import { afterEach, describe, expect, it } from "vitest";
import {
  USAGE_EVENT_MAX_COST_USD,
  USAGE_EVENT_MAX_TOKENS,
  formatCompactNumber,
  formatUsd,
  localDateFromMs,
  usageEventV1Schema,
} from "./index";

const baseEvent = {
  schemaVersion: 1,
  source: "codex",
  sourceSessionId: "session-1",
  dedupKey: "codex:session-1:message-1",
  deviceId: "device-1",
  modelId: "gpt-5.4",
  timestampMs: Date.parse("2026-02-03T12:00:00.000Z"),
  localDate: "2026-02-03",
  tokens: { input: 100, output: 40 },
};

describe("UsageEventV1 bounds", () => {
  it("accepts values at the per-event limits", () => {
    expect(
      usageEventV1Schema.safeParse({
        ...baseEvent,
        tokens: { input: USAGE_EVENT_MAX_TOKENS, output: 0 },
        costUsd: USAGE_EVENT_MAX_COST_USD,
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      "token count",
      { tokens: { input: USAGE_EVENT_MAX_TOKENS + 1, output: 0 } },
    ],
    ["unsafe token count", { tokens: { input: 1e300, output: 0 } }],
    ["cost", { costUsd: USAGE_EVENT_MAX_COST_USD + 1 }],
    ["infinite cost", { costUsd: Number.POSITIVE_INFINITY }],
    ["message count", { messageCount: 1_000_001 }],
  ])("rejects an oversized %s", (_, override) => {
    expect(
      usageEventV1Schema.safeParse({ ...baseEvent, ...override }).success,
    ).toBe(false);
  });
});

describe("UsageEventV1 local dates", () => {
  it.each(["2026-02-30", "2026-13-45", "2026-2-3", "not-a-date"])(
    "rejects invalid calendar date %s",
    (localDate) => {
      expect(
        usageEventV1Schema.safeParse({ ...baseEvent, localDate }).success,
      ).toBe(false);
    },
  );

  it.each(["2026-02-02", "2026-02-03", "2026-02-04"])(
    "accepts local date %s within one day of the timestamp",
    (localDate) => {
      expect(
        usageEventV1Schema.safeParse({ ...baseEvent, localDate }).success,
      ).toBe(true);
    },
  );

  it.each(["2026-02-01", "2026-02-05", "2020-01-01"])(
    "rejects local date %s more than one day from the timestamp",
    (localDate) => {
      expect(
        usageEventV1Schema.safeParse({ ...baseEvent, localDate }).success,
      ).toBe(false);
    },
  );
});

describe("localDateFromMs", () => {
  const previousTimezone = process.env.TZ;

  afterEach(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  it("uses the runtime timezone instead of UTC", () => {
    const timestampMs = Date.parse("2026-02-02T23:30:00.000Z");

    process.env.TZ = "Asia/Shanghai";
    expect(localDateFromMs(timestampMs)).toBe("2026-02-03");

    process.env.TZ = "America/Los_Angeles";
    expect(localDateFromMs(timestampMs)).toBe("2026-02-02");
  });
});

describe("number formatting", () => {
  it.each([Number.POSITIVE_INFINITY, Number.NaN, null as unknown as number])(
    "renders %s as unavailable",
    (value) => {
      expect(formatCompactNumber(value)).toBe("—");
      expect(formatUsd(value)).toBe("—");
    },
  );
});
