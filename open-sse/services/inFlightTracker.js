/**
 * Tracks in-flight request count per connection.
 * Used by "least-concurrency" strategy and "smart" scoring.
 * In-memory only — lost on restart, which is fine for transient state.
 */

const inFlightCounts = new Map();

const DEFAULT_MAX_CONCURRENT = 3;

export function getMaxConcurrent(connection) {
  return connection.maxConcurrent || DEFAULT_MAX_CONCURRENT;
}

export function getInFlight(connectionId) {
  return inFlightCounts.get(connectionId) || 0;
}

export function incrementInFlight(connectionId) {
  const current = inFlightCounts.get(connectionId) || 0;
  inFlightCounts.set(connectionId, current + 1);
  return current + 1;
}

export function decrementInFlight(connectionId) {
  const current = inFlightCounts.get(connectionId) || 0;
  if (current <= 1) {
    inFlightCounts.delete(connectionId);
    return 0;
  }
  inFlightCounts.set(connectionId, current - 1);
  return current - 1;
}

export function getInFlightSnapshot() {
  return Object.fromEntries(inFlightCounts);
}
