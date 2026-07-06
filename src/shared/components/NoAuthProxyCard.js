"use client";

import { useEffect, useState, useCallback } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Button from "./Button";
import Badge from "./Badge";
import Select from "./Select";

export default function NoAuthProxyCard({ providerId }) {
  const [connections, setConnections] = useState([]);
  const [proxyPools, setProxyPools] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPoolId, setNewPoolId] = useState("__none__");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const fetchData = useCallback(async () => {
    const [connRes, poolRes] = await Promise.all([
      fetch(`/api/providers`, { cache: "no-store" }),
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
    ]);
    if (connRes.ok) {
      const data = await connRes.json();
      setConnections((data.connections || []).filter(c => c.provider === providerId));
    }
    if (poolRes.ok) {
      const data = await poolRes.json();
      setProxyPools(data.proxyPools || []);
    }
  }, [providerId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = async () => {
    if (!newName || newPoolId === "__none__") return;
    setSaving(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          name: newName,
          proxyPoolId: newPoolId,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setNewName("");
        setNewPoolId("__none__");
        await fetchData();
      }
    } catch (e) {
      console.log("Error adding proxy connection:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (connId) => {
    setDeleting(connId);
    try {
      const res = await fetch(`/api/providers/${connId}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) {
      console.log("Error deleting proxy connection:", e);
    } finally {
      setDeleting(null);
    }
  };

  const poolName = (poolId) => {
    const pool = proxyPools.find(p => p.id === poolId);
    return pool ? pool.name : poolId?.slice(0, 8) || "None";
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">No authentication required</p>
          <p className="text-xs text-text-muted">
            Create multiple proxy connections to multiply rate limits. Each connection routes through a different proxy pool.
          </p>
        </div>
      </div>

      {/* Existing proxy connections */}
      {connections.length > 0 && (
        <div className="mb-4 space-y-2">
          {connections.map(conn => {
            const poolId = conn.providerSpecificData?.proxyPoolId;
            return (
              <div key={conn.id} className="flex items-center justify-between gap-3 p-3 bg-sidebar/50 rounded-lg border border-border-subtle">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-[16px] text-text-muted">lan</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{conn.name}</span>
                    <span className="text-[11px] text-text-muted">
                      Proxy: {poolId ? poolName(poolId) : "Direct"}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="close"
                  onClick={() => handleDelete(conn.id)}
                  disabled={deleting === conn.id}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showForm ? (
        <div className="p-3 bg-sidebar/50 rounded-lg border border-accent/20 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Connection name (e.g., Proxy #1)"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:border-primary"
          />
          <Select
            value={newPoolId}
            onChange={(e) => setNewPoolId(e.target.value)}
            options={[
              { value: "__none__", label: "Select a proxy pool..." },
              ...proxyPools.map(p => ({ value: p.id, label: p.name })),
            ]}
          />
          <div className="flex gap-2">
            <Button onClick={handleAdd} disabled={!newName || newPoolId === "__none__" || saving}>
              {saving ? "Adding..." : "Add"}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          icon="add"
          variant="secondary"
          onClick={() => setShowForm(true)}
        >
          Add Proxy Connection
        </Button>
      )}

      {connections.length > 1 && (
        <div className="mt-3">
          <Badge variant="info" size="sm">
            {connections.length} proxy connections — routing will distribute across all
          </Badge>
        </div>
      )}
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};
