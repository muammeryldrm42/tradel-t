/**
 * RiskEngine unit tests — verifying the system's most critical safety properties.
 * The risk engine must fail closed: a false rejection is recoverable; a false approval is not.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { RiskEngine } from "../engine/RiskEngine.js";
import type { TradingSignal, AccountBalance, Ticker, OrderBook, BotState } from "@lighter-bot/common";

function makeSignal(o: Partial<TradingSignal> = {}): TradingSignal {
  return { id: "sig1", symbol: "BTC", direction: "LONG", confidence: 0.75, entryPrice: "50000", stopLoss: "47500", takeProfit: "57500", riskRewardRatio: 3.0, strategyName: "Test", rationale: "test", invalidationCondition: "test", timeframe: "1h", generatedAt: Date.now(), expiresAt: Date.now() + 300_000, tags: [], ...o };
}
function makeAccount(o: Partial<AccountBalance> = {}): AccountBalance {
  return { currency: "USDC", total: "10000", available: "9000", locked: "1000", unrealizedPnl: "0", marginUsed: "1000", marginAvailable: "9000", accountEquity: "10000", maintenanceMargin: "500", initialMargin: "1000", accountHealth: 90, ...o };
}
function makeTicker(o: Partial<Ticker> = {}): Ticker {
  return { symbol: "BTC", lastPrice: "50000", markPrice: "50000", indexPrice: "50000", fundingRate: "0.0001", nextFundingTime: Date.now() + 28800_000, openInterest: "1000000", volume24h: "500000000", priceChange24h: "500", priceChangePct24h: "0.01", high24h: "51000", low24h: "49000", bestBid: "49998", bestAsk: "50002", bestBidSize: "5", bestAskSize: "5", timestamp: Date.now(), ...o };
}
function makeBook(): OrderBook {
  return { symbol: "BTC", bids: [{ price: "49998", size: "5" }], asks: [{ price: "50002", size: "5" }], lastUpdateId: 1, timestamp: Date.now() };
}
function makeBot(o: Partial<BotState> = {}): BotState {
  return { status: "RUNNING", mode: "PAPER", lastHeartbeat: Date.now(), activePositions: 0, dailyPnl: "0", dailyLoss: "0", dailyTrades: 0, consecutiveLosses: 0, circuitBreakerTripped: false, killSwitchActive: false, ...o };
}
const baseInput = () => ({ signal: makeSignal(), account: makeAccount(), openPositions: [] as any[], ticker: makeTicker(), orderBook: makeBook(), botState: makeBot(), tickerAge: 100 });

describe("RiskEngine", () => {
  let engine: RiskEngine;
  beforeEach(() => { engine = new RiskEngine(); });

  it("SAFETY: rejects all trades when kill switch is active", () => {
    engine.activateKillSwitch("test");
    const r = engine.assess(baseInput());
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("KILL_SWITCH"))).toBe(true);
  });

  it("SAFETY: rejects when botState.killSwitchActive=true", () => {
    const r = engine.assess({ ...baseInput(), botState: makeBot({ killSwitchActive: true }) });
    expect(r.approved).toBe(false);
  });

  it("SAFETY: rejects FLAT signals immediately", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ direction: "FLAT" }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("FLAT_SIGNAL"))).toBe(true);
  });

  it("SAFETY: rejects stale ticker data (>30s)", () => {
    const r = engine.assess({ ...baseInput(), tickerAge: 35_000 });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("STALE_DATA"))).toBe(true);
  });

  it("SAFETY: rejects low confidence signals", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ confidence: 0.40 }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("LOW_CONFIDENCE"))).toBe(true);
  });

  it("SAFETY: rejects poor risk/reward ratio", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ riskRewardRatio: 0.8 }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("POOR_RR"))).toBe(true);
  });

  it("SAFETY: rejects when spread too wide", () => {
    const r = engine.assess({ ...baseInput(), ticker: makeTicker({ bestBid: "49000", bestAsk: "51000" }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("SPREAD_TOO_WIDE"))).toBe(true);
  });

  it("SAFETY: rejects when stop is too close", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ entryPrice: "50000", stopLoss: "49985" }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("STOP_TOO_CLOSE"))).toBe(true);
  });

  it("SAFETY: rejects when account health critical (<30)", () => {
    const r = engine.assess({ ...baseInput(), account: makeAccount({ accountHealth: 15 }) });
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("ACCOUNT_HEALTH_CRITICAL"))).toBe(true);
  });

  it("SAFETY: trips circuit breaker after consecutive losses", () => {
    [1,2,3,4].forEach(() => engine.recordLoss("BTC", "200"));
    expect(engine.getState().circuitBreakerTripped).toBe(true);
    const r = engine.assess(baseInput());
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("CIRCUIT_BREAKER"))).toBe(true);
  });

  it("SAFETY: enforces cooldown after loss", () => {
    engine.recordLoss("BTC", "50");
    const r = engine.assess(baseInput());
    expect(r.approved).toBe(false);
    expect(r.reasons.some((x) => x.includes("COOLDOWN"))).toBe(true);
  });

  it("LEVERAGE: never exceeds 25x hard cap", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ confidence: 0.99 }) });
    if (r.approved) expect(r.leverageDecision.leverage).toBeLessThanOrEqual(25);
  });

  it("LEVERAGE: is at least 1x when approved", () => {
    const r = engine.assess({ ...baseInput(), signal: makeSignal({ confidence: 0.99 }) });
    if (r.approved) expect(r.leverageDecision.leverage).toBeGreaterThanOrEqual(1);
  });

  it("HAPPY PATH: approves a valid well-formed signal", () => {
    const r = engine.assess({
      ...baseInput(),
      signal: makeSignal({ confidence: 0.78, entryPrice: "50000", stopLoss: "47000", takeProfit: "59000", riskRewardRatio: 3.0 }),
    });
    expect(r.approved).toBe(true);
    expect(r.score).toBeGreaterThan(40);
    expect(r.adjustedLeverage).toBeGreaterThanOrEqual(1);
    expect(r.adjustedLeverage).toBeLessThanOrEqual(25);
    expect(parseFloat(r.computedPositionSize)).toBeGreaterThan(0);
  });

  it("deactivating kill switch removes the block", () => {
    engine.activateKillSwitch("test");
    engine.deactivateKillSwitch();
    const r = engine.assess(baseInput());
    expect(r.reasons.every((x) => !x.includes("KILL_SWITCH_ACTIVE"))).toBe(true);
  });

  it("resetting circuit breaker removes the block", () => {
    [1,2,3,4].forEach(() => engine.recordLoss("BTC", "200"));
    engine.resetCircuitBreaker();
    expect(engine.getState().circuitBreakerTripped).toBe(false);
  });
});
