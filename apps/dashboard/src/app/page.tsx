"use client";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function DashboardPage() {
  const [health, setHealth] = useState<Record<string, string> | null>(null);
  const [botState, setBotState] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`${API}/health`).then(r => r.json()).then(setHealth).catch(() => {});
    fetch(`${API}/api/v1/bot/state`).then(r => r.json()).then(d => setBotState(d.botState)).catch(() => {});
    const iv = setInterval(() => {
      fetch(`${API}/api/v1/bot/state`).then(r => r.json()).then(d => setBotState(d.botState)).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  const s: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace", background: "#080c14", color: "#e8edf5", minHeight: "100vh", padding: "2rem" };
  const card: React.CSSProperties = { background: "#0d1421", border: "1px solid #1e2d42", borderRadius: "8px", padding: "1.5rem", marginBottom: "1rem" };

  return (
    <div style={s}>
      <h1 style={{ fontSize: "1.5rem", color: "#3b82f6", marginBottom: "1.5rem" }}>⚡ Lighter Trading Bot</h1>

      <div style={card}>
        <h2 style={{ color: "#8ea3be", marginBottom: "0.75rem", fontSize: "0.875rem", textTransform: "uppercase" }}>API Health</h2>
        {health ? (
          <div style={{ display: "flex", gap: "2rem" }}>
            <Stat label="Status" value={health.status} color={health.status === "ok" ? "#22c55e" : "#ef4444"} />
            <Stat label="Mode" value={health.mode} color="#f59e0b" />
            <Stat label="Bot" value={health.botStatus} color="#8ea3be" />
          </div>
        ) : <p style={{ color: "#4f6785" }}>Connecting...</p>}
      </div>

      <div style={card}>
        <h2 style={{ color: "#8ea3be", marginBottom: "0.75rem", fontSize: "0.875rem", textTransform: "uppercase" }}>Bot State</h2>
        {botState ? (
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            <Stat label="Status" value={String(botState.status)} color="#22c55e" />
            <Stat label="Mode" value={String(botState.mode)} color="#f59e0b" />
            <Stat label="Positions" value={String(botState.activePositions)} color="#3b82f6" />
            <Stat label="Daily Trades" value={String(botState.dailyTrades)} color="#8ea3be" />
            <Stat label="Kill Switch" value={botState.killSwitchActive ? "ACTIVE" : "Off"} color={botState.killSwitchActive ? "#ef4444" : "#22c55e"} />
          </div>
        ) : <p style={{ color: "#4f6785" }}>Loading...</p>}
      </div>

      <div style={card}>
        <h2 style={{ color: "#8ea3be", marginBottom: "0.75rem", fontSize: "0.875rem", textTransform: "uppercase" }}>API Explorer</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {["/health", "/api/v1/bot/state", "/api/v1/markets", "/api/v1/trades", "/api/v1/risk/state"].map(path => (
            <a key={path} href={`${API}${path}`} target="_blank" rel="noreferrer"
              style={{ color: "#3b82f6", padding: "0.4rem 0.8rem", border: "1px solid #243650", borderRadius: "4px", textDecoration: "none", fontSize: "0.8rem" }}>
              {path}
            </a>
          ))}
        </div>
      </div>

      <p style={{ color: "#4f6785", fontSize: "0.75rem" }}>API: {API} | Dashboard v1.0</p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "#4f6785", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
