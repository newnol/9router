import { describe, it, expect, beforeEach, vi } from "vitest";

const AUTH_PATH = "../../src/sse/services/auth.js";

// ─── Helpers: hoisted mocks for auth.js dependencies ─────────────────────────

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  sortByScore: vi.fn(),
  getInFlight: vi.fn(),
  incrementInFlight: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("open-sse/services/connectionScoring.js", () => ({
  sortByScore: mocks.sortByScore,
}));

vi.mock("open-sse/services/inFlightTracker.js", () => ({
  getInFlight: mocks.getInFlight,
  incrementInFlight: mocks.incrementInFlight,
  recordRequest: vi.fn(),
  getMaxConcurrent: vi.fn().mockReturnValue(3),
  decrementInFlight: vi.fn(),
  getInFlightSnapshot: vi.fn(),
  getRecentRequestCount: vi.fn().mockReturnValue(0),
  getRpmRatio: vi.fn().mockReturnValue(0),
}));

// ─── auth.js — strategy selection ─────────────────────────────────────────────

describe("auth.js getProviderCredentials strategy selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getInFlight.mockReturnValue(0);
    mocks.incrementInFlight.mockReturnValue(1);
  });

  it("fill-first picks the first available connection", async () => {
    // getProviderConnections returns connections sorted by priority
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "test-provider", priority: 1, isActive: true },
      { id: "conn-2", provider: "test-provider", priority: 2, isActive: true },
    ]);
    mocks.getSettings.mockResolvedValue({});

    const { getProviderCredentials } = await import(AUTH_PATH);
    const result = await getProviderCredentials("test-provider");
    expect(result.connectionId).toBe("conn-1");
    expect(mocks.incrementInFlight).toHaveBeenCalledWith("conn-1");
  });

  it("smart strategy uses sortByScore and picks the first result", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-a", provider: "test-provider", priority: 1, isActive: true },
      { id: "conn-b", provider: "test-provider", priority: 2, isActive: true },
    ]);
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { "test-provider": { fallbackStrategy: "smart" } },
    });
    mocks.sortByScore.mockImplementation((conns) => [...conns].reverse());

    const { getProviderCredentials } = await import(AUTH_PATH);
    const result = await getProviderCredentials("test-provider");
    expect(result.connectionId).toBe("conn-b");
    expect(mocks.sortByScore).toHaveBeenCalled();
  });

  it("least-concurrency picks the connection with fewest in-flight requests", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-a", provider: "test-provider", priority: 2, isActive: true },
      { id: "conn-b", provider: "test-provider", priority: 1, isActive: true },
    ]);
    mocks.getInFlight.mockImplementation((id) => (id === "conn-a" ? 0 : 5));
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { "test-provider": { fallbackStrategy: "least-concurrency" } },
    });

    const { getProviderCredentials } = await import(AUTH_PATH);
    const result = await getProviderCredentials("test-provider");
    expect(result.connectionId).toBe("conn-a");
  });

  it("least-concurrency uses priority as tiebreaker when in-flight counts match", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-a", provider: "test-provider", priority: 2, isActive: true },
      { id: "conn-b", provider: "test-provider", priority: 1, isActive: true },
    ]);
    mocks.getInFlight.mockReturnValue(0);
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { "test-provider": { fallbackStrategy: "least-concurrency" } },
    });

    const { getProviderCredentials } = await import(AUTH_PATH);
    const result = await getProviderCredentials("test-provider");
    expect(result.connectionId).toBe("conn-b");
  });

  it("weighted-round-robin distributes across weights probabilistically", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-light", provider: "test-provider", priority: 1, isActive: true, weight: 1 },
      { id: "conn-heavy", provider: "test-provider", priority: 2, isActive: true, weight: 9 },
    ]);
    mocks.getSettings.mockResolvedValue({
      providerStrategies: { "test-provider": { fallbackStrategy: "weighted-round-robin" } },
    });

    const { getProviderCredentials } = await import(AUTH_PATH);
    const picks = [];
    for (let i = 0; i < 50; i++) {
      vi.clearAllMocks();
      mocks.resolveConnectionProxyConfig.mockResolvedValue({});
      mocks.getInFlight.mockReturnValue(0);
      mocks.incrementInFlight.mockReturnValue(1);
      mocks.getProviderConnections.mockResolvedValue([
        { id: "conn-light", provider: "test-provider", priority: 1, isActive: true, weight: 1 },
        { id: "conn-heavy", provider: "test-provider", priority: 2, isActive: true, weight: 9 },
      ]);
      mocks.getSettings.mockResolvedValue({
        providerStrategies: { "test-provider": { fallbackStrategy: "weighted-round-robin" } },
      });
      const result = await getProviderCredentials("test-provider");
      picks.push(result.connectionId);
    }
    const lightCount = picks.filter((id) => id === "conn-light").length;
    const heavyCount = picks.filter((id) => id === "conn-heavy").length;
    expect(heavyCount).toBeGreaterThan(lightCount);
    expect(lightCount).toBeGreaterThan(0);
  });

  it("excludes half-open connection when cooldown is still active", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-healthy", provider: "test-provider", priority: 1, isActive: true },
      { id: "conn-locked", provider: "test-provider", priority: 2, isActive: true,
        circuitHalfOpen: true, circuitBreakerUntil: new Date(Date.now() + 60000).toISOString(),
        consecutiveFailCount: 5 },
    ]);
    mocks.getSettings.mockResolvedValue({});

    const { getProviderCredentials } = await import(AUTH_PATH);
    const result = await getProviderCredentials("test-provider");
    // conn-locked is still in cooldown → must be excluded entirely
    expect(result.connectionId).toBe("conn-healthy");
  });
});

// ─── auth.js — markAccountUnavailable (circuit breaker) ───────────────────────

describe("auth.js markAccountUnavailable circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments consecutiveFailCount on each failure", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-test", provider: "test-provider", consecutiveFailCount: 2, backoffLevel: 0 },
    ]);
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});

    const { markAccountUnavailable } = await import(AUTH_PATH);
    await markAccountUnavailable("conn-test", 429, "Rate limited", "test-provider", "gpt-4");

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("conn-test", expect.objectContaining({
      consecutiveFailCount: 3,
    }));
  });

  it("trips circuit breaker after 5 consecutive failures", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-test", provider: "test-provider", consecutiveFailCount: 4, backoffLevel: 0 },
    ]);
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});

    const { markAccountUnavailable } = await import(AUTH_PATH);
    await markAccountUnavailable("conn-test", 429, "Rate limited", "test-provider", "gpt-4");

    const args = mocks.updateProviderConnection.mock.calls[0];
    expect(args[1].consecutiveFailCount).toBe(5);
    expect(args[1].circuitBreakerUntil).toBeTruthy();
    expect(args[1].circuitHalfOpen).toBe(true);
  });

  it("does not trip circuit breaker below threshold", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-test", provider: "test-provider", consecutiveFailCount: 1, backoffLevel: 0 },
    ]);
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});

    const { markAccountUnavailable } = await import(AUTH_PATH);
    await markAccountUnavailable("conn-test", 429, "Rate limited", "test-provider", "gpt-4");

    const args = mocks.updateProviderConnection.mock.calls[0];
    expect(args[1].consecutiveFailCount).toBe(2);
    expect(args[1].circuitBreakerUntil).toBeUndefined();
  });
});

// ─── auth.js — clearAccountError (circuit breaker reset) ──────────────────────

describe("auth.js clearAccountError circuit breaker reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets circuit breaker fields on success", async () => {
    const breakerUntil = new Date(Date.now() + 60000).toISOString();

    const { clearAccountError } = await import(AUTH_PATH);
    await clearAccountError("conn-test", {
      _connection: {
        id: "conn-test",
        consecutiveFailCount: 3,
        circuitBreakerUntil: breakerUntil,
        circuitHalfOpen: true,
      },
    });

    const args = mocks.updateProviderConnection.mock.calls[0];
    expect(args[1].consecutiveFailCount).toBe(0);
    expect(args[1].circuitBreakerUntil).toBeNull();
    expect(args[1].circuitHalfOpen).toBe(false);
  });

  it("does nothing when there is nothing to clear", async () => {
    const { clearAccountError } = await import(AUTH_PATH);
    await clearAccountError("conn-test", { _connection: { id: "conn-test" } });

    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("also clears model lock for the succeeded model", async () => {
    const futureLock = new Date(Date.now() + 60000).toISOString();

    const { clearAccountError } = await import(AUTH_PATH);
    await clearAccountError("conn-test", {
      _connection: { id: "conn-test", modelLock_gpt4: futureLock },
    }, "gpt4");

    const args = mocks.updateProviderConnection.mock.calls[0];
    expect(args[1]).toHaveProperty("modelLock_gpt4", null);
  });
});
