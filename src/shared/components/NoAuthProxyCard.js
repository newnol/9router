diff3: invalid print range
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

