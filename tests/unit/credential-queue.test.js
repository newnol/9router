import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MODULE_PATH = "open-sse/services/accountFallback.js";

const mocks = vi.hoisted(() => ({
  log: {
    warn: vi.fn(),
  },
}));

describe("waitForAvailableCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when credentials is null", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const result = await waitForAvailableCredentials(null, "p", "m", mocks.log);
    expect(result).toBeNull();
  });

  it("returns null when allRateLimited is false", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const result = await waitForAvailableCredentials(
      { allRateLimited: false }, "p", "m", mocks.log,
    );
    expect(result).toBeNull();
  });

  it("returns shouldRetry immediately when retryAfter is in the past", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() - 5000).toISOString(),
      retryAfterHuman: "reset after 0s",
    };
    const result = await waitForAvailableCredentials(credentials, "p", "m", mocks.log);
    expect(result).toEqual({ shouldRetry: true, totalWaitedMs: 0 });
    expect(mocks.log.warn).not.toHaveBeenCalled();
  });

  it("waits and returns shouldRetry when retryAfter is within budget", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 2000).toISOString(),
      retryAfterHuman: "reset after 2s",
    };
    const promise = waitForAvailableCredentials(credentials, "p", "m", mocks.log, 0, 30000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({ shouldRetry: true, totalWaitedMs: 2500 });
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "QUEUE",
      expect.stringContaining("All accounts locked"),
    );
  });

  it("waits exact retryAfter + 500ms buffer", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 1000).toISOString(),
      retryAfterHuman: "reset after 1s",
    };
    const startTotal = 5000;
    const promise = waitForAvailableCredentials(credentials, "p", "m", mocks.log, startTotal, 30000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({ shouldRetry: true, totalWaitedMs: startTotal + 1500 });
  });

  it("returns null when budget is already exhausted", async () => {
    const { waitForAvailableCredentials, MAX_CREDENTIAL_QUEUE_WAIT_MS } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 2000).toISOString(),
      retryAfterHuman: "reset after 2s",
    };
    const result = await waitForAvailableCredentials(
      credentials, "p", "m", mocks.log,
      MAX_CREDENTIAL_QUEUE_WAIT_MS + 1,
    );
    expect(result).toBeNull();
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "QUEUE",
      expect.stringContaining("budget exhausted"),
    );
  });

  it("returns null when retryAfter exceeds remaining budget", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 60000).toISOString(),
      retryAfterHuman: "reset after 60s",
    };
    const result = await waitForAvailableCredentials(
      credentials, "p", "m", mocks.log,
      0, 5000,
    );
    expect(result).toBeNull();
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "QUEUE",
      expect.stringContaining("exceeds remaining budget"),
    );
  });

  it("tracks cumulative wait time across multiple retries", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 2000).toISOString(),
      retryAfterHuman: "reset after 2s",
    };

    // First wait: already waited 1000ms in previous attempts
    const promise = waitForAvailableCredentials(credentials, "p", "m", mocks.log, 1000, 30000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({ shouldRetry: true, totalWaitedMs: 3500 });
  });

  it("respects custom maxWaitMs parameter", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 500).toISOString(),
      retryAfterHuman: "reset after 0.5s",
    };

    const promise = waitForAvailableCredentials(credentials, "p", "m", mocks.log, 0, 2000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({ shouldRetry: true, totalWaitedMs: 1000 });
  });

  it("does not exceed maxWaitMs cumulative", async () => {
    const { waitForAvailableCredentials } = await import(MODULE_PATH);
    const credentials = {
      allRateLimited: true,
      retryAfter: new Date(Date.now() + 1000).toISOString(),
      retryAfterHuman: "reset after 1s",
    };

    // budget left = 2000 - 1500 = 500, waitMs = min(1500, 500) = 500
    // but retryAfterMs (1000) > remainingBudget (500), so returns null immediately
    const result = await waitForAvailableCredentials(
      credentials, "p", "m", mocks.log,
      1500, 2000,
    );
    expect(result).toBeNull();
  });
});
