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

// ─── sliding-window rate tracker (for remaining RPM capacity) ──────────────

const requestHistory = new Map();
const WINDOW_MS = 60000; // 1-minute sliding window

export function recordRequest(connectionId) {
  const now = Date.now();
  let timestamps = requestHistory.get(connectionId);
  if (!timestamps) {
    timestamps = [];
    requestHistory.set(connectionId, timestamps);
  }
  timestamps.push(now);
  return timestamps.length;
}

export function getRecentRequestCount(connectionId, windowMs = WINDOW_MS) {
  const timestamps = requestHistory.get(connectionId);
  if (!timestamps) return 0;
  const cutoff = Date.now() - windowMs;
  // Prune expired entries while we're at it
  const active = timestamps.filter(t => t > cutoff);
  if (active.length !== timestamps.length) {
    requestHistory.set(connectionId, active);
  }
  return active.length;
}

export function getMaxRpm(connection) {
  return connection.maxRpm || 0;
}

export function getRpmRatio(connection) {
  const maxRpm = getMaxRpm(connection);
  if (!maxRpm) return 0; // no limit configured → doesn't penalise
  const recent = getRecentRequestCount(connection.id, WINDOW_MS);
  return Math.min(recent / maxRpm, 1);
}
