/**
 * API client for the dashboard.
 * Wraps fetch calls to the backend API with error handling.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? "API error");
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ─── Bot ───────────────────────────────────────────────────────────────────
  getBotState: () => apiFetch<BotStateResponse>("/api/v1/bot/state"),
  startBot: () => apiFetch<{ success: boolean }>("/api/v1/bot/start", { method: "POST" }),
  stopBot: () => apiFetch<{ success: boolean }>("/api/v1/bot/stop", { method: "POST" }),
  activateKillSwitch: (reason: string) =>
    apiFetch<{ success: boolean }>("/api/v1/bot/kill-switch", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  deactivateKillSwitch: () =>
    apiFetch<{ success: boolean }>("/api/v1/bot/kill-switch", { method: "DELETE" }),
  resetCircuitBreaker: () =>
    apiFetch<{ success: boolean }>("/api/v1/bot/reset-circuit-breaker", { method: "POST" }),

  // ─── Markets ───────────────────────────────────────────────────────────────
  getMarkets: () => apiFetch<{ markets: unknown[] }>("/api/v1/markets"),
  getTicker: (symbol: string) => apiFetch<{ ticker: unknown }>(`/api/v1/markets/${symbol}/ticker`),
  getOrderBook: (symbol: string, depth = 20) =>
    apiFetch<{ orderBook: unknown }>(`/api/v1/markets/${symbol}/orderbook?depth=${depth}`),
  getCandles: (symbol: string, interval = "1h", limit = 200) =>
    apiFetch<{ candles: unknown[] }>(`/api/v1/markets/${symbol}/candles?interval=${interval}&limit=${limit}`),

  // ─── Trades ────────────────────────────────────────────────────────────────
  getTrades: (open?: boolean) =>
    apiFetch<{ trades: unknown[]; total: number }>(`/api/v1/trades${open !== undefined ? `?open=${open}` : ""}`),
  getTradeSummary: () => apiFetch<{ summary: unknown }>("/api/v1/trades/summary"),
  getPositions: () => apiFetch<{ positions: unknown[] }>("/api/v1/positions"),

  // ─── Risk ──────────────────────────────────────────────────────────────────
  getRiskState: () => apiFetch<RiskStateResponse>("/api/v1/risk/state"),
  getRiskParams: () => apiFetch<unknown>("/api/v1/risk/params"),

  // ─── Metrics ───────────────────────────────────────────────────────────────
  getPerformance: () => apiFetch<PerformanceResponse>("/api/v1/metrics/performance"),

  // ─── Backtests ─────────────────────────────────────────────────────────────
  getBacktests: () => apiFetch<{ backtests: unknown[] }>("/api/v1/backtests"),
  runBacktest: (config: BacktestRunRequest) =>
    apiFetch<unknown>("/api/v1/backtests/run", { method: "POST", body: JSON.stringify(config) }),

  // ─── Audit ─────────────────────────────────────────────────────────────────
  getAuditLog: () => apiFetch<{ events: unknown[] }>("/api/v1/audit"),

  // ─── Health ────────────────────────────────────────────────────────────────
  getHealth: () => apiFetch<HealthResponse>("/health"),
};

// ─── Response Types ────────────────────────────────────────────────────────────

export interface BotStateResponse {
  botState: {
    status: string;
    mode: string;
    activePositions: number;
    dailyPnl: string;
    dailyLoss: string;
    dailyTrades: number;
    consecutiveLosses: number;
    circuitBreakerTripped: boolean;
    killSwitchActive: boolean;
    error?: string;
    startedAt?: number;
    lastHeartbeat: number;
  };
  paperSummary: {
    balance: string;
    realizedPnl: string;
    totalFeePaid: string;
    totalFundingPaid: string;
    totalTrades: number;
    openPositions: number;
  };
  riskState: {
    killSwitchActive: boolean;
    circuitBreakerTripped: boolean;
    circuitBreakerReason: string | null;
    dailyLoss: Record<string, string>;
    consecutiveLosses: Record<string, number>;
    peakEquity: string;
  };
}

export interface RiskStateResponse {
  riskState: BotStateResponse["riskState"];
  defaultParams: unknown;
  leveragePolicy: unknown;
}

export interface PerformanceResponse {
  totalTrades: number;
  winRate: number;
  totalPnl: string;
  totalFees: string;
  avgHoldHours: string;
  winningTrades: number;
  losingTrades: number;
  openTrades: number;
}

export interface HealthResponse {
  status: string;
  mode: string;
  dryRun: boolean;
  botStatus: string;
  timestamp: string;
}

export interface BacktestRunRequest {
  name: string;
  symbols: string[];
  startDate: number;
  endDate: number;
  interval?: string;
  initialCapital?: string;
}
