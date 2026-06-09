/**
 * Connection scoring for smart routing strategy.
 * Computes a composite health score per connection.
 *
 * Factors considered:
 *   - successRate (exponential — errors hurt more than successes help)
 *   - inFlight concurrency ratio
 *   - avgLatency relative to pool max
 *   - recency of last error (time decay)
 */

import { getInFlight, getMaxConcurrent } from "./inFlightTracker.js";

const MAX_LATENCY_MS = 30000;
const RECOVERY_WINDOW_MS = 5 * 60 * 1000; // 5 min to fully recover from last error

/**
 * Compute a composite health score for a connection.
 * Returns a float in [0, 1] — higher = better.
 */
export function computeScore(connection) {
  // --- success rate (exponential: errors dominate) ---
  const total = connection.totalRequests || 0;
  const successes = connection.successCount || 0;
  const successRate = total > 0 ? successes / total : 1;
  // Square it so a 90% success rate → 0.81, 50% → 0.25
  const reliability = successRate * successRate;

  // --- concurrency ---
  const inFlight = getInFlight(connection.id);
  const maxConn = getMaxConcurrent(connection);
  const concurrencyRatio = maxConn > 0 ? Math.min(inFlight / maxConn, 1) : 0;
  // Penalise up to 50% of score when fully loaded
  const concurrencyFactor = 1 - concurrencyRatio * 0.5;

  // --- latency ---
  const avgLatency = connection.avgLatencyMs || 0;
  const latencyRatio = MAX_LATENCY_MS > 0 ? Math.min(avgLatency / MAX_LATENCY_MS, 1) : 0;
  const latencyFactor = 1 - latencyRatio * 0.3;

  // --- recency of last error ---
  const recencyFactor = getRecencyFactor(connection);

  return reliability * concurrencyFactor * latencyFactor * recencyFactor;
}

function getRecencyFactor(connection) {
  // If connection is currently model-locked, score = 0
  const now = Date.now();
  const allLockKeys = Object.keys(connection).filter(k => k.startsWith("modelLock_"));
  for (const key of allLockKeys) {
    const expiry = connection[key];
    if (expiry && new Date(expiry).getTime() > now) return 0;
  }

  // If there's a recent error, ramp up over RECOVERY_WINDOW_MS
  if (connection.lastErrorAt) {
    const elapsed = now - new Date(connection.lastErrorAt).getTime();
    if (elapsed < 0) return 0; // future timestamp (shouldn't happen)
    if (elapsed >= RECOVERY_WINDOW_MS) return 1;
    return elapsed / RECOVERY_WINDOW_MS;
  }

  return 1;
}

/**
 * Sort available connections by score descending, then by priority as tiebreaker.
 */
export function sortByScore(connections) {
  const scored = connections.map(c => ({
    connection: c,
    score: computeScore(c),
  }));
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.001) return diff;
    return (a.connection.priority || 999) - (b.connection.priority || 999);
  });
  return scored.map(s => s.connection);
}
