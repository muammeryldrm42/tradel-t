"use client";
import useSWR from "swr";
import { Shield, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { Sidebar } from "../../components/layout/Sidebar.js";
import { TopBar } from "../../components/layout/TopBar.js";
import { useDashboardStore } from "../../store/index.js";
import { useLiveUpdates } from "../../hooks/useLiveUpdates.js";

export default function RiskPage() {
  useLiveUpdates();
  const wsConnected = useDashboardStore((s) => s.wsConnected);

  const { data, mutate } = useSWR("/api/v1/risk/state", () => api.getRiskState(), {
    refreshInterval: 10_000,
  });

  const riskState = data?.riskState;
  const leveragePolicy = data?.leveragePolicy as Record<string, { hardCap: number; recommendedDefault: number }> | undefined;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="Risk Management" wsConnected={wsConnected} />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Status row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatusCard
              label="Kill Switch"
              value={riskState?.killSwitchActive ? "ACTIVE" : "Inactive"}
              danger={riskState?.killSwitchActive}
            />
            <StatusCard
              label="Circuit Breaker"
              value={riskState?.circuitBreakerTripped ? "TRIPPED" : "Normal"}
              danger={riskState?.circuitBreakerTripped}
              detail={riskState?.circuitBreakerReason ?? undefined}
            />
            <StatusCard label="Peak Equity" value={`$${parseFloat(riskState?.peakEquity ?? "0").toFixed(2)}`} />
            <div className="card p-4 flex items-center justify-between">
              <span className="text-xs text-[--text-muted] uppercase tracking-wider">Actions</span>
              <button
                onClick={() => api.resetCircuitBreaker().then(() => mutate())}
                className="flex items-center gap-1.5 text-xs text-[--accent-primary] hover:underline"
              >
                <RefreshCw size={12} /> Reset CB
              </button>
            </div>
          </div>

          {/* Daily Loss */}
          <div className="card p-5">
            <h2 className="text-sm font-medium text-[--text-secondary] mb-4 flex items-center gap-2">
              <AlertTriangle size={14} /> Daily Loss Tracker
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {riskState && Object.entries(riskState.dailyLoss).map(([sym, loss]) => (
                <div key={sym} className="text-center">
                  <div className="text-xs text-[--text-muted] mb-1">{sym}</div>
                  <div className={`text-xl font-mono font-semibold ${parseFloat(loss) > 0 ? "text-[--red]" : "text-[--text-secondary]"}`}>
                    ${parseFloat(loss).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leverage Policy */}
          <div className="card p-5">
            <h2 className="text-sm font-medium text-[--text-secondary] mb-4 flex items-center gap-2">
              <Shield size={14} /> Leverage Policy
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[--border-subtle]">
                    {["Symbol", "Hard Cap", "Default", "High Leverage ≥", "Min Confidence (high)"].map((h) => (
                      <th key={h} className="text-left py-2 pr-4 text-xs text-[--text-muted] font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leveragePolicy && Object.entries(leveragePolicy).map(([sym, policy]) => (
                    <tr key={sym} className="border-b border-[--border-subtle]/50">
                      <td className="py-2.5 pr-4 font-mono font-medium">{sym}</td>
                      <td className="py-2.5 pr-4 font-mono text-[--yellow]">{policy.hardCap}x</td>
                      <td className="py-2.5 pr-4 font-mono text-[--green]">{policy.recommendedDefault}x</td>
                      <td className="py-2.5 pr-4 font-mono text-[--text-secondary]">
                        {(leveragePolicy[sym] as Record<string, number>)?.["highLeverageThreshold"]}x
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[--text-secondary]">
                        {((leveragePolicy[sym] as Record<string, number>)?.["highLeverageMinConfidence"] * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[--text-muted] mt-3">
              Leverage above the recommended default requires higher confidence, wider liquidation distance, and tighter position sizing.
              The risk engine computes actual leverage dynamically per trade — 25x is a hard cap, not a default.
            </p>
          </div>

        </main>
      </div>
    </div>
  );
}

function StatusCard({ label, value, danger, detail }: { label: string; value: string; danger?: boolean; detail?: string }) {
  return (
    <div className={`card p-4 space-y-1 ${danger ? "border-[--red]/40" : ""}`}>
      <div className="text-xs text-[--text-muted] uppercase tracking-wider">{label}</div>
      <div className={`text-base font-mono font-semibold ${danger ? "text-[--red]" : "text-[--text-secondary]"}`}>
        {value}
      </div>
      {detail && <div className="text-xs text-[--text-muted] truncate">{detail}</div>}
    </div>
  );
}
