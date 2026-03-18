/**
 * RiskEngine unit tests
 * Tests the core safety properties: rejection conditions, leverage computation,
 * kill switch, circuit breaker, and daily loss limits.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RiskEngine } from "../src/engine/RiskEngine.js";
import type { RiskCheckInput } from "../src/engine/RiskEngine.js";
import type {
  TradingSignal,
  AccountBalance,
  Position,
  Ticker,
  OrderBook,
  BotState,
} from "@lighter-bot/common";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

function makeSignal(overrides?: Partial<TradingSignal>): TradingSignal {
  return {
    id: "test-signal-1",
    symbol: "BTC",
    direction: "LONG",
    confidence: 0.75,
    entryPrice: "50000",
    stopLoss: "47000",
    takeProfit: "58000",
    riskRewardRatio: 2.67,
    strategyName: "TrendFollowing",
    rationale: "Test signal",
    invalidationCondition: "Close below 47000",
    timeframe: "1h",
    generatedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    tags: ["test"],
    ...overrides,
  };
}

function makeAccount(overrides?: Partial<AccountBalance>): AccountBalance {
  return {
    currency: "USDC",
    total: "10000",
    available: "8000",
    locked: "2000",
    unrealizedPnl: "0",
    marginUsed: "2000",
    marginAvailable: "8000",
    accountEquity: "10000",
    maintenanceMargin: "500",
    initialMargin: "2000",
    accountHealth: 85,
    ...overrides,
  };
}

function makeTicker(overrides?: Partial<Ticker>): Ticker {
  return {
    symbol: "BTC",
    lastPrice: "50000",
    markPrice: "50000",
    indexPrice: "50000",
    fundingRate: "0.0001",
    nextFundingTime: Date.now() + 8 * 3600_000,
    openInterest: "1000",
    volume24h: "5000000",
    priceChange24h: "500",
    priceChangePct24h: "0.01",
    high24h: "51000",
    low24h: "49000",
    bestBid: "49998",
    bestAsk: "50002",
    bestBidSize: "5",
    bestAskSize: "5",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeOrderBook(): OrderBook {
  return {
    symbol: "BTC",
    bids: [{ price: "49998", size: "5" }],
    asks: [{ price: "50002", size: "5" }],
    lastUpdateId: 1,
    timestamp: Date.now(),
  };
}

function makeBotState(overrides?: Partial<BotState>): BotState {
  return {
    status: "RUNNING",
    mode: "PAPER",
    lastHeartbeat: Date.now(),
    activePositions: 0,
    dailyPnl: "0",
    dailyLoss: "0",
    dailyTrades: 0,
    consecutiveLosses: 0,
    circuitBreakerTripped: false,
    killSwitchActive: false,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<RiskCheckInput>): RiskCheckInput {
  return {
    signal: makeSignal(),
    account: makeAccount(),
    openPositions: [],
    ticker: makeTicker(),
    orderBook: makeOrderBook(),
    botState: makeBotState(),
    tickerAge: 1000,
    ...overrides,
  };
}

type OrderBook = import("@lighter-bot/common").OrderBook;

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("RiskEngine", () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  // ─── Basic approval ────────────────────────────────────────────────────────

  it("approves a clean high-quality signal", () => {
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.score).toBeGreaterThan(50);
  });

  it("returns a leverage decision on approval", () => {
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(true);
    expect(result.leverageDecision.leverage).toBeGreaterThanOrEqual(1);
    expect(result.leverageDecision.leverage).toBeLessThanOrEqual(25);
  });

  it("computes position size on approval", () => {
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(true);
    expect(parseFloat(result.computedPositionSize)).toBeGreaterThan(0);
  });

  // ─── Kill switch ──────────────────────────────────────────────────────────

  it("rejects all trades when kill switch is active", () => {
    engine.activateKillSwitch("Test");
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("KILL_SWITCH"))).toBe(true);
  });

  it("allows trades after kill switch is deactivated", () => {
    engine.activateKillSwitch("Test");
    engine.deactivateKillSwitch();
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(true);
  });

  it("rejects when bot state has kill switch active", () => {
    const result = engine.assess(
      makeInput({ botState: makeBotState({ killSwitchActive: true }) })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("BOT_KILL_SWITCH"))).toBe(true);
  });

  // ─── Circuit breaker ──────────────────────────────────────────────────────

  it("trips circuit breaker after consecutive losses tripwire", () => {
    // Default tripwire is 4 consecutive losses for BTC
    for (let i = 0; i < 4; i++) {
      engine.recordLoss("BTC", "100");
    }
    const state = engine.getState();
    expect(state.circuitBreakerTripped).toBe(true);
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("CIRCUIT_BREAKER"))).toBe(true);
  });

  it("can reset circuit breaker", () => {
    for (let i = 0; i < 4; i++) engine.recordLoss("BTC", "100");
    engine.resetCircuitBreaker();
    expect(engine.getState().circuitBreakerTripped).toBe(false);
  });

  // ─── Low confidence ───────────────────────────────────────────────────────

  it("rejects signal below confidence threshold", () => {
    const result = engine.assess(
      makeInput({ signal: makeSignal({ confidence: 0.50 }) })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("LOW_CONFIDENCE"))).toBe(true);
  });

  it("approves signal exactly at confidence threshold", () => {
    // Default BTC threshold is 0.65
    const result = engine.assess(
      makeInput({ signal: makeSignal({ confidence: 0.65 }) })
    );
    expect(result.approved).toBe(true);
  });

  // ─── FLAT signal ──────────────────────────────────────────────────────────

  it("rejects FLAT signals", () => {
    const result = engine.assess(
      makeInput({ signal: makeSignal({ direction: "FLAT" }) })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("FLAT_SIGNAL"))).toBe(true);
  });

  // ─── Stale data ───────────────────────────────────────────────────────────

  it("rejects when ticker data is stale", () => {
    const result = engine.assess(makeInput({ tickerAge: 60_000 }));
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("STALE_DATA"))).toBe(true);
  });

  // ─── Spread ───────────────────────────────────────────────────────────────

  it("rejects when spread exceeds max", () => {
    // Max spread for BTC is 15 bps. Setting bid/ask to create ~30 bps spread.
    const result = engine.assess(
      makeInput({
        ticker: makeTicker({ bestBid: "49700", bestAsk: "50300" }),
      })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("SPREAD_TOO_WIDE"))).toBe(true);
  });

  // ─── Risk/Reward ──────────────────────────────────────────────────────────

  it("rejects signal with poor risk/reward ratio", () => {
    const result = engine.assess(
      makeInput({ signal: makeSignal({ riskRewardRatio: 0.8 }) })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("POOR_RR"))).toBe(true);
  });

  // ─── Max positions ────────────────────────────────────────────────────────

  it("rejects when max open positions is reached", () => {
    const fakePositions: Position[] = Array.from({ length: 3 }, (_, i) => ({
      id: `pos-${i}`,
      symbol: "ETH",
      side: "LONG" as const,
      size: "0.1",
      entryPrice: "3000",
      markPrice: "3000",
      liquidationPrice: "2000",
      unrealizedPnl: "0",
      realizedPnl: "0",
      leverage: 3,
      margin: "100",
      marginType: "ISOLATED" as const,
      fundingFee: "0",
      openedAt: Date.now(),
      updatedAt: Date.now(),
      isOpen: true,
    }));
    const result = engine.assess(makeInput({ openPositions: fakePositions }));
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("MAX_POSITIONS"))).toBe(true);
  });

  // ─── Daily loss limit ─────────────────────────────────────────────────────

  it("rejects when daily loss limit is exceeded", () => {
    // 5% of $10,000 equity = $500 daily loss limit
    engine.recordLoss("BTC", "550");
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("DAILY_LOSS_LIMIT"))).toBe(true);
  });

  it("resets daily stats correctly", () => {
    engine.recordLoss("BTC", "550");
    engine.resetDailyStats();
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(true);
  });

  // ─── Account health ───────────────────────────────────────────────────────

  it("rejects when account health is critically low", () => {
    const result = engine.assess(
      makeInput({ account: makeAccount({ accountHealth: 20 }) })
    );
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("ACCOUNT_HEALTH_CRITICAL"))).toBe(true);
  });

  // ─── Leverage caps ────────────────────────────────────────────────────────

  it("never assigns leverage above 25x (hard cap for BTC)", () => {
    const result = engine.assess(
      makeInput({ signal: makeSignal({ confidence: 0.99 }) })
    );
    if (result.approved) {
      expect(result.leverageDecision.leverage).toBeLessThanOrEqual(25);
    }
  });

  it("uses conservative leverage by default", () => {
    const result = engine.assess(makeInput());
    if (result.approved) {
      // Default BTC leverage is 3x — should be close to that for normal confidence
      expect(result.leverageDecision.leverage).toBeLessThanOrEqual(10);
    }
  });

  it("records win correctly resets consecutive losses", () => {
    engine.recordLoss("BTC", "50");
    engine.recordLoss("BTC", "50");
    engine.recordWin("BTC");
    const state = engine.getState();
    expect(state.consecutiveLosses["BTC"]).toBe(0);
  });

  // ─── Cooldown ─────────────────────────────────────────────────────────────

  it("rejects during cooldown period after loss", () => {
    engine.recordLoss("BTC", "50");
    // Immediately try to trade — should be in cooldown
    const result = engine.assess(makeInput());
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("COOLDOWN"))).toBe(true);
  });
});
