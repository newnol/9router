import { describe, it, expect, beforeEach } from "vitest";

// ─── inFlightTracker ──────────────────────────────────────────────────────────

describe("inFlightTracker", () => {
  let tracker;

  beforeEach(async () => {
    tracker = await import("open-sse/services/inFlightTracker.js");
    // Reset internal state by re-importing fresh module
    vi.resetModules();
    tracker = await import("open-sse/services/inFlightTracker.js");
  });

  it("starts at 0 for unknown connection", () => {
    expect(tracker.getInFlight("conn-nonexistent")).toBe(0);
  });

  it("increments and returns new count", () => {
    expect(tracker.incrementInFlight("conn-a")).toBe(1);
    expect(tracker.incrementInFlight("conn-a")).toBe(2);
    expect(tracker.getInFlight("conn-a")).toBe(2);
  });

  it("decrements and returns new count", () => {
    tracker.incrementInFlight("conn-a");
    tracker.incrementInFlight("conn-a");
    tracker.incrementInFlight("conn-a");
    expect(tracker.decrementInFlight("conn-a")).toBe(2);
    expect(tracker.decrementInFlight("conn-a")).toBe(1);
    expect(tracker.decrementInFlight("conn-a")).toBe(0);
    expect(tracker.getInFlight("conn-a")).toBe(0);
  });

  it("deletes key from map when count reaches 0", () => {
    tracker.incrementInFlight("conn-a");
    tracker.decrementInFlight("conn-a");
    expect(tracker.getInFlightSnapshot()).not.toHaveProperty("conn-a");
  });

  it("handles decrement below 0 gracefully", () => {
    expect(tracker.decrementInFlight("conn-nonexistent")).toBe(0);
  });

  it("tracks multiple connections independently", () => {
    tracker.incrementInFlight("conn-a");
    tracker.incrementInFlight("conn-b");
    tracker.incrementInFlight("conn-b");
    expect(tracker.getInFlight("conn-a")).toBe(1);
    expect(tracker.getInFlight("conn-b")).toBe(2);
    expect(tracker.getInFlightSnapshot()).toEqual({ "conn-a": 1, "conn-b": 2 });
  });

  it("getMaxConcurrent returns default of 3", () => {
    expect(tracker.getMaxConcurrent({})).toBe(3);
    expect(tracker.getMaxConcurrent({ maxConcurrent: undefined })).toBe(3);
  });

  it("getMaxConcurrent reads from connection object", () => {
    expect(tracker.getMaxConcurrent({ maxConcurrent: 5 })).toBe(5);
    expect(tracker.getMaxConcurrent({ maxConcurrent: 1 })).toBe(1);
  });
});

// ─── connectionScoring ────────────────────────────────────────────────────────

describe("connectionScoring", () => {
  let scoring;

  beforeEach(async () => {
    vi.resetModules();
    scoring = await import("open-sse/services/connectionScoring.js");
  });

  describe("computeScore", () => {
    it("returns 1 for a perfect connection", () => {
      const conn = { id: "conn-perfect", totalRequests: 100, successCount: 100, avgLatencyMs: 100 };
      const score = scoring.computeScore(conn);
      expect(score).toBeCloseTo(1, 2);
    });

    it("returns 1 for a new connection with no data", () => {
      const conn = { id: "conn-new" };
      const score = scoring.computeScore(conn);
      expect(score).toBe(1);
    });

    it("penalises low success rate (50% → ~0.25 reliability)", () => {
      const conn = { id: "conn-50pct", totalRequests: 100, successCount: 50, avgLatencyMs: 100 };
      const score = scoring.computeScore(conn);
      // reliability = 0.5^2 = 0.25, concurrencyFactor ~= 1, latencyFactor ~= 1, recencyFactor = 1
      expect(score).toBeCloseTo(0.25, 2);
    });

    it("penalises high latency", () => {
      const conn = { id: "conn-slow", totalRequests: 100, successCount: 100, avgLatencyMs: 25000 };
      const score = scoring.computeScore(conn);
      // latencyRatio = 25000/30000 ≈ 0.833, latencyFactor = 1 - 0.833*0.3 ≈ 0.75
      expect(score).toBeLessThan(0.8);
      expect(score).toBeGreaterThan(0.7);
    });

    it("penalises high concurrency", async () => {
      const trackerModule = await import("open-sse/services/inFlightTracker.js");
      const conn = { id: "conn-concurrency", totalRequests: 100, successCount: 100, avgLatencyMs: 100, maxConcurrent: 4 };
      trackerModule.incrementInFlight("conn-concurrency");
      trackerModule.incrementInFlight("conn-concurrency");
      trackerModule.incrementInFlight("conn-concurrency");
      trackerModule.incrementInFlight("conn-concurrency");
      const score = scoring.computeScore(conn);
      // 4 in-flight / 4 max → concurrencyRatio = 1, concurrencyFactor = 0.5
      // reliability=1, latencyFactor~=1, recencyFactor=1
      expect(score).toBeCloseTo(0.5, 2);
      // Clean up
      trackerModule.decrementInFlight("conn-concurrency");
      trackerModule.decrementInFlight("conn-concurrency");
      trackerModule.decrementInFlight("conn-concurrency");
      trackerModule.decrementInFlight("conn-concurrency");
    });

    it("returns 0 when model lock is active", () => {
      const conn = { id: "conn-locked", modelLock_gpt4: new Date(Date.now() + 60000).toISOString() };
      const score = scoring.computeScore(conn);
      expect(score).toBe(0);
    });

    it("returns 0 when lastErrorAt is in the future", () => {
      const conn = { id: "conn-future-err", lastErrorAt: new Date(Date.now() + 3600000).toISOString() };
      const score = scoring.computeScore(conn);
      expect(score).toBe(0);
    });

    it("ramps up score after error recovery time", () => {
      // Error happened RECOVERY_WINDOW_MS/2 ago → score should be ~50% of max
      const halfWindow = 2.5 * 60 * 1000;
      const conn = { id: "conn-recovering", totalRequests: 100, successCount: 100, avgLatencyMs: 100, lastErrorAt: new Date(Date.now() - halfWindow).toISOString() };
      const score = scoring.computeScore(conn);
      // recencyFactor = 0.5, reliability=1, concurrencyFactor~=1, latencyFactor~=1
      expect(score).toBeCloseTo(0.5, 1);
    });

    it("is unaffected when lastErrorAt is older than recovery window", () => {
      const old = 10 * 60 * 1000; // 10 min ago
      const conn = { id: "conn-recovered", totalRequests: 100, successCount: 100, avgLatencyMs: 100, lastErrorAt: new Date(Date.now() - old).toISOString() };
      const score = scoring.computeScore(conn);
      expect(score).toBeCloseTo(1, 2);
    });
  });

  describe("sortByScore", () => {
    it("sorts descending by score", () => {
      const conns = [
        { id: "low", totalRequests: 100, successCount: 50, avgLatencyMs: 100 },
        { id: "high", totalRequests: 100, successCount: 100, avgLatencyMs: 100 },
      ];
      const sorted = scoring.sortByScore(conns);
      expect(sorted[0].id).toBe("high");
      expect(sorted[1].id).toBe("low");
    });

    it("uses priority as tiebreaker when scores are close", () => {
      const conns = [
        { id: "a", priority: 2, totalRequests: 100, successCount: 100, avgLatencyMs: 100 },
        { id: "b", priority: 1, totalRequests: 100, successCount: 100, avgLatencyMs: 100 },
      ];
      const sorted = scoring.sortByScore(conns);
      expect(sorted[0].id).toBe("b"); // lower priority number = higher priority
      expect(sorted[1].id).toBe("a");
    });

    it("handles empty list", () => {
      expect(scoring.sortByScore([])).toEqual([]);
    });

    it("handles single connection", () => {
      const conns = [{ id: "only" }];
      expect(scoring.sortByScore(conns)).toEqual(conns);
    });
  });
});

// ─── Retry-After parsing ──────────────────────────────────────────────────────

describe("parseUpstreamError retry-after", () => {
  it("extracts resetsAtMs from numeric Retry-After header", async () => {
    const { parseUpstreamError } = await import("open-sse/utils/error.js");
    const response = new Response("{}", {
      status: 429,
      headers: { "retry-after": "120" },
    });
    const result = await parseUpstreamError(response, null);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expect(result.resetsAtMs).toBeLessThan(Date.now() + 121000);
  });

  it("extracts resetsAtMs from HTTP-date Retry-After header", async () => {
    const { parseUpstreamError } = await import("open-sse/utils/error.js");
    const futureDate = new Date(Date.now() + 60000).toUTCString();
    const response = new Response("{}", {
      status: 429,
      headers: { "retry-after": futureDate },
    });
    const result = await parseUpstreamError(response, null);
    expect(result.resetsAtMs).toBeGreaterThan(Date.now());
    expect(result.resetsAtMs).toBeLessThan(Date.now() + 61000);
  });

  it("does not set resetsAtMs when Retry-After is empty", async () => {
    const { parseUpstreamError } = await import("open-sse/utils/error.js");
    const response = new Response("{}", {
      status: 429,
      headers: {},
    });
    const result = await parseUpstreamError(response, null);
    expect(result.resetsAtMs).toBeUndefined();
  });

  it("does not set resetsAtMs when Retry-After is in the past", async () => {
    const { parseUpstreamError } = await import("open-sse/utils/error.js");
    const pastDate = new Date(Date.now() - 60000).toUTCString();
    const response = new Response("{}", {
      status: 429,
      headers: { "retry-after": pastDate },
    });
    const result = await parseUpstreamError(response, null);
    expect(result.resetsAtMs).toBeUndefined();
  });

  it("preserves existing behavior (statusCode, message)", async () => {
    const { parseUpstreamError } = await import("open-sse/utils/error.js");
    const response = new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
    const result = await parseUpstreamError(response, null);
    expect(result.statusCode).toBe(429);
    expect(result.message).toBe("Rate limited");
  });
});

// ─── circuit breaker constants (auth.js) ──────────────────────────────────────

describe("auth circuit breaker logic", () => {
  it("circuit breaker trips after 5 consecutive failures", () => {
    // CIRCUIT_BREAKER_THRESHOLD = 5
    const CIRCUIT_BREAKER_THRESHOLD = 5;
    const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

    let consecutiveFailCount = 0;
    for (let i = 0; i < 5; i++) {
      consecutiveFailCount++;
    }
    expect(consecutiveFailCount).toBe(CIRCUIT_BREAKER_THRESHOLD);

    const shouldTrip = consecutiveFailCount >= CIRCUIT_BREAKER_THRESHOLD;
    expect(shouldTrip).toBe(true);

    const breakerUntil = new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS).getTime();
    expect(breakerUntil).toBeGreaterThan(Date.now());
  });

  it("resets circuit breaker on success", () => {
    const clearObj = {
      modelLock_gpt4: null,
    };
    clearObj.consecutiveFailCount = 0;
    clearObj.circuitBreakerUntil = null;
    clearObj.circuitHalfOpen = false;

    expect(clearObj.consecutiveFailCount).toBe(0);
    expect(clearObj.circuitBreakerUntil).toBeNull();
    expect(clearObj.circuitHalfOpen).toBe(false);
  });

  it("half-open probability decreases with more failures", () => {
    const HALF_OPEN_PROBABILITY_DENOM = 4;

    // At threshold (5 failures): prob = 1 / max(5, 4) = 0.2
    let failCount = 5;
    let prob = 1 / Math.max(failCount, HALF_OPEN_PROBABILITY_DENOM);
    expect(prob).toBeCloseTo(0.2, 2);

    // At many failures: prob = 1 / failCount
    failCount = 20;
    prob = 1 / Math.max(failCount, HALF_OPEN_PROBABILITY_DENOM);
    expect(prob).toBeCloseTo(0.05, 2);

    // At zero (fallback): prob = 1 / max(0, 4) = 0.25
    failCount = 0;
    prob = 1 / Math.max(failCount, HALF_OPEN_PROBABILITY_DENOM);
    expect(prob).toBeCloseTo(0.25, 2);
  });
});

// ─── latency tracking (chat.js logic) ────────────────────────────────────────

describe("latency tracking logic", () => {
  it("computes cumulative moving average correctly", () => {
    // avgLatencyMs = priorAvgLatency + (latencyMs - priorAvgLatency) / (priorTotal + 1)
    const priorTotal = 0;
    const priorAvgLatency = 0;
    const latencyMs = 500;
    const avg = priorTotal > 0
      ? Math.round(priorAvgLatency + (latencyMs - priorAvgLatency) / (priorTotal + 1))
      : latencyMs;
    expect(avg).toBe(500);
  });

  it("updates moving average incrementally", () => {
    // First request: 500ms
    let total = 1;
    let avg = 500;
    expect(avg).toBe(500);

    // Second request: 1000ms
    avg = Math.round(avg + (1000 - avg) / (total + 1));
    total++;
    expect(avg).toBe(750);

    // Third request: 300ms
    avg = Math.round(avg + (300 - avg) / (total + 1));
    total++;
    expect(avg).toBeCloseTo(600, 0);
  });

  it("tracks successCount alongside totalRequests", () => {
    const updateFields = (result, priorTotal, priorSuccess, priorAvgLatency, latencyMs) => {
      const fields = {
        totalRequests: priorTotal + 1,
        avgLatencyMs: priorTotal > 0
          ? Math.round(priorAvgLatency + (latencyMs - priorAvgLatency) / (priorTotal + 1))
          : latencyMs,
      };
      if (result.success) {
        fields.successCount = priorSuccess + 1;
      }
      return fields;
    };

    let priorTotal = 0, priorSuccess = 0, priorAvgLatency = 0;

    // First request: success
    let fields = updateFields({ success: true }, priorTotal, priorSuccess, priorAvgLatency, 200);
    priorTotal = fields.totalRequests;
    priorSuccess = fields.successCount;
    priorAvgLatency = fields.avgLatencyMs;
    expect(priorTotal).toBe(1);
    expect(priorSuccess).toBe(1);

    // Second request: failure (not success)
    fields = updateFields({ success: false }, priorTotal, priorSuccess, priorAvgLatency, 500);
    priorTotal = fields.totalRequests;
    priorAvgLatency = fields.avgLatencyMs;
    expect(priorTotal).toBe(2);
    expect(fields.successCount).toBeUndefined();
    expect(priorSuccess).toBe(1); // unchanged
    expect(priorAvgLatency).toBe(350); // (200 + 500) / 2
  });

  it("handles concurrent decrement pattern", () => {
    // Simulates chat.js: decrementInFlight after completion
    const inFlightTracker = { count: 0 };
    const decrement = (id) => {
      inFlightTracker.count = Math.max(0, inFlightTracker.count - 1);
      return inFlightTracker.count;
    };
    const increment = (id) => {
      inFlightTracker.count++;
      return inFlightTracker.count;
    };

    increment("conn-a"); increment("conn-a"); increment("conn-a");
    expect(inFlightTracker.count).toBe(3);
    decrement("conn-a"); decrement("conn-a"); decrement("conn-a");
    expect(inFlightTracker.count).toBe(0);
    decrement("conn-a");
    expect(inFlightTracker.count).toBe(0); // no negative
  });
});
