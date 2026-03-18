"use client";

import { useEffect } from "react";
import useSWR from "swr";
import {
  Activity, TrendingUp, TrendingDown, AlertTriangle,
  Shield, Zap, DollarSign, BarChart2,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useDashboardStore } from "../store/index.js";
import { useLiveUpdates } from "../hooks/useLiveUpdates.js";
import { Sidebar } from "../components/layout/Sidebar.js";
import { TopBar } from "../components/layout/TopBar.js";
import { MetricCard } from "../components/ui/MetricCard.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { KillSwitchButton } from "../components/ui/KillSwitchButton.js";
import { EquityCurveChart } from "../components/charts/EquityCurveChart.js";
import { AlertBanner } from "../components/ui/AlertBanner.js";

export default function DashboardPage() {
  useLiveUpdates();

  const { botState, paperSummary, riskState, alerts, wsConnected } = useDashboardStore();

  // Also poll for initial data
  const { data, mutate } = useSWR("/api/v1/bot/state", () => api.getBotState(), {
    refreshInterval: wsConnected ? 0 : 5000,
    onSuccess: (d) => useDashboardStore.getState().setBotData(d),
  });

  const { data: perf } = useSWR("/api/v1/metrics/performance", () => api.getPerformance(), {
    refreshInterval: 30_000,
  });

  const pnlPositive = parseFloat(paperSummary?.realizedPnl ?? "0") >= 0;
  const balance = paperSummary?.balance ?? "—";
  const pnl = paperSummary?.realizedPnl ?? "0";
  const openPos = paperSummary?.openPositions ?? 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="Overview" wsConnected={wsConnected} />

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Alerts */}
          {alerts.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} />
          ))}

          {/* Top row: bot status + kill switch */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`status-dot ${botState?.status === "RUNNING" ? "running" : botState?.status === "ERROR" ? "error" : "stopped"}`} />
              <span className="text-sm text-[--text-secondary]">
                Bot: <span className="text-[--text-primary] font-medium">{botState?.status ?? "—"}</span>
              </span>
              <span className="text-[--border-default]">|</span>
              <span className="text-sm text-[--text-secondary]">
                Mode: <span className="text-[--accent-primary] font-medium font-mono">{botState?.mode ?? "DRY_RUN"}</span>
              </span>
              {botState?.mode === "DRY_RUN" && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-[--yellow] text-[--yellow]">
                  SIMULATION
                </span>
              )}
            </div>
            <KillSwitchButton
              active={botState?.killSwitchActive ?? false}
              onActivate={() => api.activateKillSwitch("Operator dashboard").then(() => mutate())}
              onDeactivate={() => api.deactivateKillSwitch().then(() => mutate())}
            />
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<DollarSign size={16} />}
              label="Paper Balance"
              value={`$${parseFloat(balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              valueClass="num-ticker"
            />
            <MetricCard
              icon={pnlPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              label="Realized PnL"
              value={`${pnlPositive ? "+" : ""}$${parseFloat(pnl).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              valueClass={`num-ticker ${pnlPositive ? "text-positive" : "text-negative"}`}
            />
            <MetricCard
              icon={<Activity size={16} />}
              label="Open Positions"
              value={openPos.toString()}
              subtitle={`Max: ${3}`}
            />
            <MetricCard
              icon={<BarChart2 size={16} />}
              label="Daily Trades"
              value={(botState?.dailyTrades ?? 0).toString()}
              subtitle={`Consecutive losses: ${botState?.consecutiveLosses ?? 0}`}
            />
          </div>

          {/* Performance row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={<TrendingUp size={16} />}
              label="Win Rate"
              value={perf ? `${(perf.winRate * 100).toFixed(1)}%` : "—"}
              subtitle={`${perf?.winningTrades ?? 0}W / ${perf?.losingTrades ?? 0}L`}
            />
            <MetricCard
              icon={<Zap size={16} />}
              label="Total Trades"
              value={(perf?.totalTrades ?? 0).toString()}
            />
            <MetricCard
              icon={<DollarSign size={16} />}
              label="Fees Paid"
              value={perf ? `$${parseFloat(perf.totalFees).toFixed(2)}` : "—"}
              valueClass="num-ticker text-[--text-secondary]"
            />
            <MetricCard
              icon={<Activity size={16} />}
              label="Avg Hold"
              value={perf ? `${perf.avgHoldHours}h` : "—"}
            />
          </div>

          {/* Risk state row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card p-4 space-y-3">
              <h3 className="text-xs text-[--text-muted] uppercase tracking-wider flex items-center gap-2">
                <Shield size={12} /> Risk State
              </h3>
              <div className="space-y-2">
                <RiskRow label="Kill Switch" value={riskState?.killSwitchActive ? "ACTIVE" : "Off"} danger={riskState?.killSwitchActive} />
                <RiskRow label="Circuit Breaker" value={riskState?.circuitBreakerTripped ? "TRIPPED" : "OK"} danger={riskState?.circuitBreakerTripped} />
                <RiskRow label="Peak Equity" value={riskState ? `$${parseFloat(riskState.peakEquity).toFixed(2)}` : "—"} />
              </div>
            </div>

            <div className="card p-4 space-y-3">
              <h3 className="text-xs text-[--text-muted] uppercase tracking-wider">
                Daily Loss (by symbol)
              </h3>
              {riskState && Object.entries(riskState.dailyLoss).map(([sym, loss]) => (
                <RiskRow key={sym} label={sym} value={`$${parseFloat(loss).toFixed(2)}`} danger={parseFloat(loss) > 100} />
              ))}
            </div>

            <div className="card p-4 space-y-3">
              <h3 className="text-xs text-[--text-muted] uppercase tracking-wider">
                Consecutive Losses
              </h3>
              {riskState && Object.entries(riskState.consecutiveLosses).map(([sym, count]) => (
                <RiskRow key={sym} label={sym} value={`${count}`} danger={count >= 3} />
              ))}
            </div>
          </div>

          {/* Equity curve placeholder */}
          <div className="card p-4">
            <h3 className="text-sm font-medium text-[--text-secondary] mb-4">Equity Curve (Paper)</h3>
            <EquityCurveChart />
          </div>
        </main>
      </div>
    </div>
  );
}

function RiskRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-[--text-muted]">{label}</span>
      <span className={`font-mono font-medium ${danger ? "text-[--red]" : "text-[--text-secondary]"}`}>
        {value}
      </span>
    </div>
  );
}
