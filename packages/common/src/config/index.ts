import type { Symbol, ExecutionMode, RiskParameters } from "../types/index.js";

export interface LeveragePolicyEntry {
  hardCap: number;
  recommendedDefault: number;
  highLeverageThreshold: number;
  highLeverageMinConfidence: number;
  ultraLeverageThreshold: number;
  ultraLeverageMinConfidence: number;
  maxLeverageMinConfidence: number;
}

export const LEVERAGE_POLICY: Record<Symbol, LeveragePolicyEntry> = {
  BTC: { hardCap: 25, recommendedDefault: 3, highLeverageThreshold: 5, highLeverageMinConfidence: 0.80, ultraLeverageThreshold: 10, ultraLeverageMinConfidence: 0.90, maxLeverageMinConfidence: 0.95 },
  ETH: { hardCap: 25, recommendedDefault: 3, highLeverageThreshold: 5, highLeverageMinConfidence: 0.80, ultraLeverageThreshold: 10, ultraLeverageMinConfidence: 0.90, maxLeverageMinConfidence: 0.95 },
  SOL: { hardCap: 25, recommendedDefault: 2, highLeverageThreshold: 4, highLeverageMinConfidence: 0.82, ultraLeverageThreshold: 8, ultraLeverageMinConfidence: 0.92, maxLeverageMinConfidence: 0.96 },
};

export const DEFAULT_RISK_PARAMS: Record<Symbol, RiskParameters> = {
  BTC: { symbol: "BTC", maxRiskPerTradePct: 0.01, maxDailyLossPct: 0.05, maxDrawdownPct: 0.15, maxOpenPositions: 3, maxSymbolExposurePct: 0.30, maxCorrelatedExposurePct: 0.50, minConfidenceThreshold: 0.65, minLiquidationDistancePct: 0.08, maxLeverageHardCap: 25, defaultLeverage: 3, maxSpreadBps: 15, maxSlippageBps: 20, maxFundingRateHourly: 0.002, cooldownAfterLossMs: 1800000, consecutiveLossTripwire: 4, minRiskRewardRatio: 1.5 },
  ETH: { symbol: "ETH", maxRiskPerTradePct: 0.01, maxDailyLossPct: 0.05, maxDrawdownPct: 0.15, maxOpenPositions: 3, maxSymbolExposurePct: 0.30, maxCorrelatedExposurePct: 0.50, minConfidenceThreshold: 0.65, minLiquidationDistancePct: 0.08, maxLeverageHardCap: 25, defaultLeverage: 3, maxSpreadBps: 15, maxSlippageBps: 20, maxFundingRateHourly: 0.002, cooldownAfterLossMs: 1800000, consecutiveLossTripwire: 4, minRiskRewardRatio: 1.5 },
  SOL: { symbol: "SOL", maxRiskPerTradePct: 0.008, maxDailyLossPct: 0.05, maxDrawdownPct: 0.15, maxOpenPositions: 2, maxSymbolExposurePct: 0.20, maxCorrelatedExposurePct: 0.40, minConfidenceThreshold: 0.70, minLiquidationDistancePct: 0.10, maxLeverageHardCap: 25, defaultLeverage: 2, maxSpreadBps: 20, maxSlippageBps: 25, maxFundingRateHourly: 0.003, cooldownAfterLossMs: 2700000, consecutiveLossTripwire: 3, minRiskRewardRatio: 1.8 },
};

export interface SymbolContractSpec {
  symbol: Symbol;
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  minOrderSize: string;
  maintenanceMarginRate: number;
  initialMarginRate: number;
  fundingIntervalHours: number;
}

export const SYMBOL_CONTRACT_SPECS: Record<Symbol, SymbolContractSpec> = {
  BTC: { symbol: "BTC", baseAsset: "BTC", quoteAsset: "USDC", tickSize: "0.1", minOrderSize: "0.001", maintenanceMarginRate: 0.004, initialMarginRate: 0.04, fundingIntervalHours: 8 },
  ETH: { symbol: "ETH", baseAsset: "ETH", quoteAsset: "USDC", tickSize: "0.01", minOrderSize: "0.01", maintenanceMarginRate: 0.004, initialMarginRate: 0.04, fundingIntervalHours: 8 },
  SOL: { symbol: "SOL", baseAsset: "SOL", quoteAsset: "USDC", tickSize: "0.001", minOrderSize: "0.1", maintenanceMarginRate: 0.005, initialMarginRate: 0.04, fundingIntervalHours: 8 },
};

export interface AppConfig {
  execution: { mode: ExecutionMode; dryRun: boolean; paperTrading: boolean; liveEnabled: boolean; symbolAllowlist: Symbol[]; operatorConfirmationToken: string | null; acknowledgedRisk: boolean; };
  lighter: { apiBaseUrl: string; wsBaseUrl: string; apiKey: string | null; subAccountId: string | null; requestTimeoutMs: number; maxRetries: number; retryDelayMs: number; };
  bot: { enabledSymbols: Symbol[]; pollingIntervalMs: number; signalIntervalMs: number; heartbeatIntervalMs: number; };
  db: { url: string; };
  api: { port: number; host: string; corsOrigins: string[]; jwtSecret: string; };
  logging: { level: "trace" | "debug" | "info" | "warn" | "error"; pretty: boolean; };
}

export function loadAppConfig(): AppConfig {
  const env = process.env;
  const liveEnabled =
    env["ENABLE_LIVE_TRADING"] === "true" &&
    env["I_UNDERSTAND_THIS_MAY_LOSE_REAL_MONEY"] === "true" &&
    !!env["OPERATOR_CONFIRMATION_TOKEN"];

  const mode: ExecutionMode = liveEnabled ? "LIVE" : env["PAPER_TRADING"] === "true" ? "PAPER" : "DRY_RUN";

  return {
    execution: {
      mode,
      dryRun: env["DRY_RUN"] !== "false",
      paperTrading: env["PAPER_TRADING"] === "true",
      liveEnabled,
      symbolAllowlist: parseSymbols(env["SYMBOL_ALLOWLIST"]),
      operatorConfirmationToken: env["OPERATOR_CONFIRMATION_TOKEN"] ?? null,
      acknowledgedRisk: env["I_UNDERSTAND_THIS_MAY_LOSE_REAL_MONEY"] === "true",
    },
    lighter: {
      apiBaseUrl: env["LIGHTER_API_URL"] ?? "https://mainnet.zklighter.elliot.ai",
      wsBaseUrl: env["LIGHTER_WS_URL"] ?? "wss://mainnet.zklighter.elliot.ai/stream",
      apiKey: env["LIGHTER_API_KEY"] ?? null,
      subAccountId: env["LIGHTER_SUB_ACCOUNT_ID"] ?? null,
      requestTimeoutMs: parseInt(env["LIGHTER_TIMEOUT_MS"] ?? "10000"),
      maxRetries: parseInt(env["LIGHTER_MAX_RETRIES"] ?? "3"),
      retryDelayMs: parseInt(env["LIGHTER_RETRY_DELAY_MS"] ?? "1000"),
    },
    bot: {
      enabledSymbols: parseSymbols(env["ENABLED_SYMBOLS"]) || ["BTC", "ETH", "SOL"],
      pollingIntervalMs: parseInt(env["POLLING_INTERVAL_MS"] ?? "5000"),
      signalIntervalMs: parseInt(env["SIGNAL_INTERVAL_MS"] ?? "60000"),
      heartbeatIntervalMs: parseInt(env["HEARTBEAT_INTERVAL_MS"] ?? "30000"),
    },
    db: { url: env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/lighter_bot" },
    api: {
      port: parseInt(env["API_PORT"] ?? "3001"),
      host: env["API_HOST"] ?? "0.0.0.0",
      corsOrigins: (env["CORS_ORIGINS"] ?? "*").split(","),
      jwtSecret: env["JWT_SECRET"] ?? "dev-secret-change-in-production",
    },
    logging: {
      level: (env["LOG_LEVEL"] as AppConfig["logging"]["level"]) ?? "info",
      pretty: env["LOG_PRETTY"] === "true",
    },
  };
}

function parseSymbols(raw: string | undefined): Symbol[] {
  if (!raw) return ["BTC", "ETH", "SOL"];
  return raw.split(",").map((s) => s.trim().toUpperCase() as Symbol).filter((s): s is Symbol => ["BTC", "ETH", "SOL"].includes(s));
}
