import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { getInFlight, getRecentRequestCount } from "open-sse/services/inFlightTracker.js";
import { computeScore } from "open-sse/services/connectionScoring.js";

export async function GET() {
  try {
    const connections = await getProviderConnections({ isActive: true });

    const stats = connections.map(c => {
      const inFlight = getInFlight(c.id);
      const recentRpm = getRecentRequestCount(c.id);
      const total = c.totalRequests || 0;
      const successes = c.successCount || 0;
      const errors = total - successes;
      const errorRate = total > 0 ? errors / total : 0;
      const successRate = total > 0 ? successes / total : 0;
      const score = computeScore(c);

      const circuitBreakerActive = !!(c.circuitBreakerUntil && new Date(c.circuitBreakerUntil).getTime() > Date.now());
      const modelLockActive = Object.keys(c).some(k => k.startsWith("modelLock_") && c[k] && new Date(c[k]).getTime() > Date.now());

      return {
        id: c.id,
        name: c.name || "",
        provider: c.provider,
        priority: c.priority || 999,
        isActive: c.isActive,
        healthScore: Math.round(score * 100) / 100,
        inFlight,
        recentRpm,
        maxRpm: c.maxRpm || 0,
        maxConcurrent: c.maxConcurrent || 3,
        weight: c.weight || 1,
        totalRequests: total,
        successCount: successes,
        errorCount: errors,
        errorRate: Math.round(errorRate * 100),
        successRate: Math.round(successRate * 100),
        avgLatencyMs: c.avgLatencyMs || 0,
        consecutiveFailCount: c.consecutiveFailCount || 0,
        circuitBreakerActive,
        circuitBreakerUntil: c.circuitBreakerUntil || null,
        circuitHalfOpen: !!c.circuitHalfOpen,
        modelLockActive,
        lastError: c.lastError || null,
        lastErrorAt: c.lastErrorAt || null,
        updatedAt: c.updatedAt || null,
      };
    });

    const summary = {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => !c.lastError && !c.circuitBreakerUntil).length,
      erroredConnections: stats.filter(s => s.errorRate > 0 || s.lastError).length,
      totalInFlight: stats.reduce((sum, s) => sum + s.inFlight, 0),
      totalRecentRpm: stats.reduce((sum, s) => sum + s.recentRpm, 0),
      circuitBreakerTripped: stats.filter(s => s.circuitBreakerActive).length,
    };

    return NextResponse.json({ summary, connections: stats });
  } catch (error) {
    console.log("Error fetching provider stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
