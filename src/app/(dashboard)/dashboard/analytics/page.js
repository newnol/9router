"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge } from "@/shared/components";
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";

const INTERVAL_MS = 5000; // auto-refresh every 5s

function getHealthColor(score) {
  if (score >= 0.8) return "success";
  if (score >= 0.5) return "warning";
  return "error";
}

function getCbIcon(conn) {
  if (conn.circuitBreakerActive) return "error";
  if (conn.circuitHalfOpen) return "warning";
  return "success";
}

function getCbLabel(conn) {
  if (conn.circuitBreakerActive) return "Open";
  if (conn.circuitHalfOpen) return "Half-Open";
  return "Closed";
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/stats");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchStats]);

  const summaryCards = data ? [
    { label: "Total Connections", value: data.summary.totalConnections, icon: "dns", color: "" },
    { label: "Active", value: data.summary.activeConnections, icon: "check_circle", color: "text-green-500" },
    { label: "Errored", value: data.summary.erroredConnections, icon: "warning", color: "text-orange-500" },
    { label: "Circuit Breaker", value: data.summary.circuitBreakerTripped, icon: "power_off", color: "text-red-500" },
    { label: "In-Flight", value: data.summary.totalInFlight, icon: "sync", color: "text-blue-500" },
    { label: "Requests/min", value: data.summary.totalRecentRpm, icon: "speed", color: "text-purple-500" },
  ] : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-semibold">Analytics</h1>
        {!loading && (
          <span className="text-xs text-text-muted">Refreshing every 5s</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} padding="md">
              <div className="animate-pulse space-y-2">
                <div className="h-3 w-16 bg-surface-2 rounded" />
                <div className="h-6 w-12 bg-surface-2 rounded" />
              </div>
            </Card>
          ))
        ) : (
          summaryCards.map(card => (
            <Card key={card.label} padding="md">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className={`material-symbols-outlined text-[16px] ${card.color}`}>{card.icon}</span>
                  <span className="text-[11px] text-text-muted font-medium uppercase tracking-wider">{card.label}</span>
                </div>
                <span className="text-2xl font-bold">{card.value}</span>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Connections table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[11px] text-text-muted uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">In-Flight</th>
                <th className="px-4 py-3 font-medium">RPM</th>
                <th className="px-4 py-3 font-medium">Error Rate</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Circuit Breaker</th>
                <th className="px-4 py-3 font-medium">Last Error</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle animate-pulse">
                    <td className="px-4 py-3" colSpan={8}>
                      <div className="h-4 w-48 bg-surface-2 rounded" />
                    </td>
                  </tr>
                ))
              ) : data?.connections.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-text-muted" colSpan={8}>
                    No active connections found.
                  </td>
                </tr>
              ) : (
                data?.connections.map(conn => (
                  <tr
                    key={conn.id}
                    className="border-b border-border-subtle hover:bg-surface-1/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/providers/${conn.provider}`} className="flex items-center gap-2 hover:text-primary transition-colors">
                        <ProviderIcon providerId={conn.provider} className="w-5 h-5 rounded-full" />
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{conn.name || conn.provider}</span>
                          <span className="text-[11px] text-text-muted">Priority {conn.priority}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getHealthColor(conn.healthScore)} size="sm">
                        {conn.healthScore}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{conn.inFlight}</span>
                        <span className="text-text-muted">/ {conn.maxConcurrent}</span>
                        <div className="w-16 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min((conn.inFlight / conn.maxConcurrent) * 100, 100)}%`,
                              backgroundColor: conn.inFlight >= conn.maxConcurrent ? "#ef4444" : "#3b82f6",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{conn.recentRpm}</span>
                        {conn.maxRpm > 0 && (
                          <>
                            <span className="text-text-muted">/ {conn.maxRpm}</span>
                            <div className="w-16 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min((conn.recentRpm / conn.maxRpm) * 100, 100)}%`,
                                  backgroundColor: conn.recentRpm >= conn.maxRpm ? "#ef4444" : "#8b5cf6",
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={conn.errorRate === 0 ? "success" : conn.errorRate < 20 ? "warning" : "error"}
                          size="sm"
                          dot
                        >
                          {conn.errorRate}%
                        </Badge>
                        <span className="text-[11px] text-text-muted">({conn.successCount}/{conn.totalRequests})</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {conn.avgLatencyMs > 0 ? `${conn.avgLatencyMs}ms` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`material-symbols-outlined text-[14px] ${
                          conn.circuitBreakerActive ? "text-red-500" :
                          conn.circuitHalfOpen ? "text-orange-500" : "text-green-500"
                        }`}>
                          {conn.circuitBreakerActive ? "power_off" : conn.circuitHalfOpen ? "sync_problem" : "check_circle"}
                        </span>
                        <Badge variant={getCbIcon(conn)} size="sm">
                          {getCbLabel(conn)}
                        </Badge>
                        {conn.consecutiveFailCount > 0 && (
                          <span className="text-[11px] text-text-muted">({conn.consecutiveFailCount} fails)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {conn.lastError ? (
                        <div className="flex flex-col">
                          <span className="text-[11px] text-text-muted truncate" title={conn.lastError}>
                            {conn.lastError}
                          </span>
                          {conn.lastErrorAt && (
                            <span className="text-[10px] text-text-muted">
                              {new Date(conn.lastErrorAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
