/**
 * RiskEngine - The primary safety layer for all trade decisions.
 * 
 * This engine runs BEFORE any order reaches the execution layer.
 * Every check here must pass for a trade to proceed.
 * The engine is intentionally conservative and fails CLOSED.
 * 
 * CRITICAL SAFETY PROPERTIES:
 * - A rejected trade is NEVER retried with loosened parameters
 * - Risk parameters are immutable after initialization
 * - The kill switch is irreversible within a session
 * - Leverage is COMPUTED, not passed in from signals
 */

import { Decimal } from "decimal.js";
import {
  type Symbol,
  type Side,
  type TradingSignal,
  type RiskAssessment,
  type RiskParameters,
  type AccountBalance,
  type Position,
  type Ticker,
  type OrderBook,
  type BotState,
  type LeverageDecision,
  type RegimeState,
} from "@lighter-bot/common";
import {
  LEVERAGE_POLICY,
  DEFAULT_RISK_PARAMS,
  SYMBOL_CONTRACT_SPECS,
} from "@lighter-bot/common";
import {
  spreadBps,
  liquidationDistancePct,
  calcLiquidationPrice,
  calcPositionSize,
  clamp,
} from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";

const log = createChildLogger({ module: "risk-engine" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RiskCheckInput {
  signal: TradingSignal;
  account: AccountBalance;
  openPositions: Position[];
  ticker: Ticker;
  orderBook: OrderBook;
  botState: BotState;
  regime?: RegimeState;
  tickerAge: number; // ms since ticker was fetched
}

export interface RiskCheckResult extends RiskAssessment {
  leverageDecision: LeverageDecision;
  computedPositionSize: string;
  notionalValue: string;
  requiredMargin: string;
  estimatedFee: string;
}

// ─── RiskEngine ───────────────────────────────────────────────────────────────

export class RiskEngine {
  private readonly params: Record<Symbol, RiskParameters>;
  private dailyLoss: Record<Symbol, Decimal>;
  private dailyLossAll: Decimal;
  private consecutiveLosses: Record<Symbol, number>;
  private lastLossTime: Record<Symbol, number>;
  private killSwitchActive: boolean;
  private circuitBreakerTripped: boolean;
  private circuitBreakerReason: string | null;
  private peakEquity: Decimal;

  constructor(params?: Partial<Record<Symbol, Partial<RiskParameters>>>) {
    this.params = {
      BTC: { ...DEFAULT_RISK_PARAMS.BTC, ...(params?.BTC ?? {}) },
      ETH: { ...DEFAULT_RISK_PARAMS.ETH, ...(params?.ETH ?? {}) },
      SOL: { ...DEFAULT_RISK_PARAMS.SOL, ...(params?.SOL ?? {}) },
    };
    this.dailyLoss = { BTC: new Decimal(0), ETH: new Decimal(0), SOL: new Decimal(0) };
    this.dailyLossAll = new Decimal(0);
    this.consecutiveLosses = { BTC: 0, ETH: 0, SOL: 0 };
    this.lastLossTime = { BTC: 0, ETH: 0, SOL: 0 };
    this.killSwitchActive = false;
    this.circuitBreakerTripped = false;
    this.circuitBreakerReason = null;
    this.peakEquity = new Decimal(0);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  activateKillSwitch(reason: string): void {
    this.killSwitchActive = true;
    log.warn({ reason }, "KILL SWITCH ACTIVATED - all trading halted");
  }

  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    log.info("Kill switch deactivated by operator");
  }

  resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.circuitBreakerReason = null;
    log.info("Circuit breaker manually reset by operator");
  }

  resetDailyStats(): void {
    this.dailyLoss = { BTC: new Decimal(0), ETH: new Decimal(0), SOL: new Decimal(0) };
    this.dailyLossAll = new Decimal(0);
    log.info("Daily stats reset");
  }

  recordLoss(symbol: Symbol, lossAmount: string): void {
    const loss = new Decimal(lossAmount).abs();
    this.dailyLoss[symbol] = this.dailyLoss[symbol].plus(loss);
    this.dailyLossAll = this.dailyLossAll.plus(loss);
    this.consecutiveLosses[symbol] = (this.consecutiveLosses[symbol] ?? 0) + 1;
    this.lastLossTime[symbol] = Date.now();

    const params = this.params[symbol]!;
    if ((this.consecutiveLosses[symbol] ?? 0) >= params.consecutiveLossTripwire) {
      this.tripCircuitBreaker(
        `${this.consecutiveLosses[symbol]} consecutive losses on ${symbol}`
      );
    }
    log.info({ symbol, lossAmount, consecutiveLosses: this.consecutiveLosses[symbol] }, "Loss recorded");
  }

  recordWin(symbol: Symbol): void {
    this.consecutiveLosses[symbol] = 0;
  }

  updatePeakEquity(equity: string): void {
    const eq = new Decimal(equity);
    if (eq.gt(this.peakEquity)) {
      this.peakEquity = eq;
    }
  }

  // ─── Primary Assessment ──────────────────────────────────────────────────────

  assess(input: RiskCheckInput): RiskCheckResult {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const { signal, account, openPositions, ticker, orderBook, botState, regime, tickerAge } = input;
    const { symbol } = signal;
    const params = this.params[symbol]!;
    const contractSpec = SYMBOL_CONTRACT_SPECS[symbol];
    const side: Side = signal.direction === "LONG" ? "LONG" : "SHORT";

    // ─── Hard Stops (instant reject) ──────────────────────────────────────────

    if (this.killSwitchActive) {
      return this.reject(reasons, warnings, "KILL_SWITCH_ACTIVE: trading is halted");
    }

    if (this.circuitBreakerTripped) {
      return this.reject(
        reasons,
        warnings,
        `CIRCUIT_BREAKER: ${this.circuitBreakerReason ?? "tripped"}`
      );
    }

    if (botState.killSwitchActive) {
      return this.reject(reasons, warnings, "BOT_KILL_SWITCH: operator activated kill switch");
    }

    if (botState.circuitBreakerTripped) {
      return this.reject(reasons, warnings, "BOT_CIRCUIT_BREAKER: tripped in bot state");
    }

    if (signal.direction === "FLAT") {
      return this.reject(reasons, warnings, "FLAT_SIGNAL: no directional edge");
    }

    // ─── Stale Data Check ──────────────────────────────────────────────────────

    if (tickerAge > 30_000) {
      return this.reject(reasons, warnings, `STALE_DATA: ticker is ${tickerAge}ms old`);
    }

    // ─── Signal Confidence ─────────────────────────────────────────────────────

    if (signal.confidence < params.minConfidenceThreshold) {
      return this.reject(
        reasons,
        warnings,
        `LOW_CONFIDENCE: ${signal.confidence.toFixed(3)} < ${params.minConfidenceThreshold}`
      );
    }

    // ─── Risk/Reward ───────────────────────────────────────────────────────────

    if (signal.riskRewardRatio < params.minRiskRewardRatio) {
      return this.reject(
        reasons,
        warnings,
        `POOR_RR: ${signal.riskRewardRatio.toFixed(2)} < ${params.minRiskRewardRatio}`
      );
    }

    // ─── Daily Loss Limit ──────────────────────────────────────────────────────

    const equity = new Decimal(account.accountEquity);
    const dailyLossLimit = equity.mul(params.maxDailyLossPct);
    if (this.dailyLossAll.gte(dailyLossLimit)) {
      return this.reject(
        reasons,
        warnings,
        `DAILY_LOSS_LIMIT: ${this.dailyLossAll.toFixed(2)} >= ${dailyLossLimit.toFixed(2)}`
      );
    }

    // ─── Max Drawdown ──────────────────────────────────────────────────────────

    this.updatePeakEquity(account.accountEquity);
    if (this.peakEquity.gt(0)) {
      const drawdownPct = this.peakEquity
        .minus(equity)
        .div(this.peakEquity)
        .toNumber();
      if (drawdownPct >= params.maxDrawdownPct) {
        return this.reject(
          reasons,
          warnings,
          `MAX_DRAWDOWN: ${(drawdownPct * 100).toFixed(2)}% >= ${(params.maxDrawdownPct * 100).toFixed(2)}%`
        );
      }
      if (drawdownPct >= params.maxDrawdownPct * 0.8) {
        warnings.push(`DRAWDOWN_WARNING: ${(drawdownPct * 100).toFixed(2)}% of limit`);
      }
    }

    // ─── Cooldown After Loss ───────────────────────────────────────────────────

    const lastLoss = this.lastLossTime[symbol] ?? 0;
    if (lastLoss > 0 && Date.now() - lastLoss < params.cooldownAfterLossMs) {
      const remaining = params.cooldownAfterLossMs - (Date.now() - lastLoss);
      return this.reject(
        reasons,
        warnings,
        `COOLDOWN: ${Math.ceil(remaining / 1000)}s remaining after loss`
      );
    }

    // ─── Open Position Limits ──────────────────────────────────────────────────

    const openCount = openPositions.filter((p) => p.isOpen).length;
    if (openCount >= params.maxOpenPositions) {
      return this.reject(
        reasons,
        warnings,
        `MAX_POSITIONS: ${openCount} >= ${params.maxOpenPositions}`
      );
    }

    // Prevent opening duplicate position in same symbol+direction
    const existingPosition = openPositions.find(
      (p) => p.symbol === symbol && p.side === side && p.isOpen
    );
    if (existingPosition) {
      return this.reject(
        reasons,
        warnings,
        `DUPLICATE_POSITION: already ${side} on ${symbol}`
      );
    }

    // ─── Symbol Exposure ───────────────────────────────────────────────────────

    const symbolExposure = openPositions
      .filter((p) => p.symbol === symbol && p.isOpen)
      .reduce((sum, p) => sum.plus(p.margin), new Decimal(0));
    const symbolExposurePct = symbolExposure.div(equity).toNumber();
    if (symbolExposurePct >= params.maxSymbolExposurePct) {
      return this.reject(
        reasons,
        warnings,
        `SYMBOL_EXPOSURE: ${(symbolExposurePct * 100).toFixed(2)}% >= ${(params.maxSymbolExposurePct * 100).toFixed(2)}%`
      );
    }

    // ─── Account Health ────────────────────────────────────────────────────────

    if (account.accountHealth < 30) {
      return this.reject(
        reasons,
        warnings,
        `ACCOUNT_HEALTH_CRITICAL: ${account.accountHealth} < 30`
      );
    }
    if (account.accountHealth < 50) {
      warnings.push(`ACCOUNT_HEALTH_LOW: ${account.accountHealth}`);
    }

    // ─── Spread / Liquidity ────────────────────────────────────────────────────

    const spread = spreadBps(ticker.bestBid, ticker.bestAsk);
    if (spread > params.maxSpreadBps) {
      return this.reject(
        reasons,
        warnings,
        `SPREAD_TOO_WIDE: ${spread.toFixed(2)} bps > ${params.maxSpreadBps} bps`
      );
    }
    if (spread > params.maxSpreadBps * 0.7) {
      warnings.push(`SPREAD_ELEVATED: ${spread.toFixed(2)} bps`);
    }

    // ─── Funding Rate ──────────────────────────────────────────────────────────

    const fundingRate = parseFloat(ticker.fundingRate);
    const fundingIsAdverse =
      (side === "LONG" && fundingRate > params.maxFundingRateHourly) ||
      (side === "SHORT" && fundingRate < -params.maxFundingRateHourly);
    if (fundingIsAdverse) {
      warnings.push(
        `ADVERSE_FUNDING: rate=${fundingRate.toFixed(6)}, holding ${side} is expensive`
      );
    }

    // ─── Leverage Decision ─────────────────────────────────────────────────────

    const leverageDecision = this.computeLeverage({
      symbol,
      side,
      confidence: signal.confidence,
      regime,
      spread,
      fundingRate,
      params,
      ticker,
    });

    // ─── Liquidation Distance ──────────────────────────────────────────────────

    const liqPrice = calcLiquidationPrice(
      signal.entryPrice,
      leverageDecision.leverage,
      side,
      contractSpec.maintenanceMarginRate
    );

    const liqDistance = liquidationDistancePct(signal.entryPrice, liqPrice, side);
    if (liqDistance < params.minLiquidationDistancePct) {
      return this.reject(
        reasons,
        warnings,
        `LIQ_DISTANCE_TOO_CLOSE: ${(liqDistance * 100).toFixed(2)}% < ${(params.minLiquidationDistancePct * 100).toFixed(2)}% (leverage=${leverageDecision.leverage}x)`
      );
    }

    // Enhanced check for higher leverage
    const leveragePolicy = LEVERAGE_POLICY[symbol];
    if (leverageDecision.leverage > leveragePolicy.highLeverageThreshold) {
      const enhancedMinLiqDistance = params.minLiquidationDistancePct * leverageDecision.liquidationSafetyMultiplier;
      if (liqDistance < enhancedMinLiqDistance) {
        return this.reject(
          reasons,
          warnings,
          `LIQ_DISTANCE_INSUFFICIENT_FOR_LEVERAGE: ${(liqDistance * 100).toFixed(2)}% < ${(enhancedMinLiqDistance * 100).toFixed(2)}% required at ${leverageDecision.leverage}x`
        );
      }
    }

    // ─── Stop Loss Validity ────────────────────────────────────────────────────

    const stopDistance = new Decimal(signal.entryPrice)
      .minus(signal.stopLoss)
      .abs()
      .div(signal.entryPrice)
      .toNumber();

    if (stopDistance < 0.003) {
      return this.reject(
        reasons,
        warnings,
        `STOP_TOO_CLOSE: ${(stopDistance * 100).toFixed(3)}% < 0.3%`
      );
    }

    // ─── Position Sizing ───────────────────────────────────────────────────────

    const computedSize = calcPositionSize(
      account.accountEquity,
      params.maxRiskPerTradePct,
      signal.entryPrice,
      signal.stopLoss
    );

    const notional = new Decimal(computedSize).mul(signal.entryPrice);
    const requiredMargin = notional.div(leverageDecision.leverage);
    const availableMargin = new Decimal(account.marginAvailable);

    if (requiredMargin.gt(availableMargin)) {
      return this.reject(
        reasons,
        warnings,
        `INSUFFICIENT_MARGIN: need ${requiredMargin.toFixed(2)}, have ${availableMargin.toFixed(2)}`
      );
    }

    // Margin should not exceed X% of available
    const marginUtilization = requiredMargin.div(equity).toNumber();
    if (marginUtilization > params.maxSymbolExposurePct) {
      warnings.push(
        `HIGH_MARGIN_UTILIZATION: ${(marginUtilization * 100).toFixed(2)}%`
      );
    }

    const estimatedFee = notional.mul(0.0005); // 5bps taker, conservative

    // ─── Regime-Based Filter ───────────────────────────────────────────────────

    if (regime) {
      const regimeBlock = this.checkRegimeFilter(regime, signal, params);
      if (regimeBlock) {
        return this.reject(reasons, warnings, regimeBlock);
      }
    }

    // ─── Score (0-100) ────────────────────────────────────────────────────────

    const score = this.computeRiskScore({
      confidence: signal.confidence,
      spread,
      liqDistance,
      leverage: leverageDecision.leverage,
      marginUtilization,
      accountHealth: account.accountHealth,
      rr: signal.riskRewardRatio,
    });

    log.info(
      {
        symbol,
        side,
        leverage: leverageDecision.leverage,
        liqDistance: (liqDistance * 100).toFixed(2) + "%",
        spread: spread.toFixed(2) + " bps",
        confidence: signal.confidence.toFixed(3),
        score,
        warnings: warnings.length,
      },
      "Risk assessment APPROVED"
    );

    return {
      approved: true,
      reasons,
      warnings,
      adjustedLeverage: leverageDecision.leverage,
      adjustedSize: computedSize,
      liquidationDistance: liqDistance,
      score,
      timestamp: Date.now(),
      leverageDecision,
      computedPositionSize: computedSize,
      notionalValue: notional.toFixed(8),
      requiredMargin: requiredMargin.toFixed(8),
      estimatedFee: estimatedFee.toFixed(8),
    };
  }

  // ─── Leverage Computation ──────────────────────────────────────────────────

  private computeLeverage(ctx: {
    symbol: Symbol;
    side: Side;
    confidence: number;
    regime?: RegimeState;
    spread: number;
    fundingRate: number;
    params: RiskParameters;
    ticker: Ticker;
  }): LeverageDecision {
    const { symbol, confidence, regime, spread, params } = ctx;
    const policy = LEVERAGE_POLICY[symbol];

    let leverage = params.defaultLeverage;
    const reasons: string[] = [`base=${leverage}x`];

    // Reduce leverage in high volatility
    if (regime) {
      if (
        regime.regime === "HIGH_VOLATILITY" ||
        regime.volatilityPercentile > 80
      ) {
        leverage = Math.max(1, leverage - 1);
        reasons.push(`vol_reduction (pct=${regime.volatilityPercentile})`);
      }
      if (regime.regime === "RANGING" && regime.confidence > 0.8) {
        // slightly reduce leverage in ranging - less momentum
        leverage = Math.max(1, leverage - 0.5);
        reasons.push("ranging_reduction");
      }
    }

    // Spread penalty
    if (spread > params.maxSpreadBps * 0.5) {
      leverage = Math.max(1, leverage - 1);
      reasons.push(`spread_penalty (${spread.toFixed(1)}bps)`);
    }

    // Only INCREASE above default if confidence is very high
    if (confidence >= policy.highLeverageMinConfidence && leverage <= policy.highLeverageThreshold) {
      const bonus = (confidence - policy.highLeverageMinConfidence) * 10;
      leverage = Math.min(leverage + bonus, policy.highLeverageThreshold);
      reasons.push(`confidence_bonus (conf=${confidence.toFixed(3)})`);
    }

    // Ultra-leverage gate
    if (confidence < policy.ultraLeverageMinConfidence) {
      leverage = Math.min(leverage, policy.ultraLeverageThreshold);
    }

    // Max leverage gate
    if (confidence < policy.maxLeverageMinConfidence) {
      leverage = Math.min(leverage, policy.hardCap - 5);
    }

    // Absolute hard cap
    leverage = clamp(Math.round(leverage), 1, policy.hardCap);

    const liquidationSafetyMultiplier =
      leverage > policy.highLeverageThreshold ? 1.5 : 1.0;

    const requiredConfidence =
      leverage > policy.ultraLeverageThreshold
        ? policy.maxLeverageMinConfidence
        : leverage > policy.highLeverageThreshold
        ? policy.ultraLeverageMinConfidence
        : leverage > params.defaultLeverage
        ? policy.highLeverageMinConfidence
        : 0;

    return {
      leverage,
      reason: reasons.join(", "),
      requiresHigherConfidenceThreshold: requiredConfidence,
      liquidationSafetyMultiplier,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private reject(
    reasons: string[],
    warnings: string[],
    reason: string
  ): RiskCheckResult {
    reasons.push(reason);
    log.warn({ reason, warnings }, "Risk assessment REJECTED");
    return {
      approved: false,
      reasons,
      warnings,
      score: 0,
      timestamp: Date.now(),
      leverageDecision: { leverage: 0, reason: "rejected", requiresHigherConfidenceThreshold: 1, liquidationSafetyMultiplier: 1 },
      computedPositionSize: "0",
      notionalValue: "0",
      requiredMargin: "0",
      estimatedFee: "0",
    };
  }

  private tripCircuitBreaker(reason: string): void {
    this.circuitBreakerTripped = true;
    this.circuitBreakerReason = reason;
    log.error({ reason }, "CIRCUIT BREAKER TRIPPED - trading halted until manual reset");
  }

  private checkRegimeFilter(
    regime: RegimeState,
    signal: TradingSignal,
    params: RiskParameters
  ): string | null {
    // Block trades when regime is unknown and confidence is required
    if (regime.regime === "UNKNOWN" && regime.confidence < 0.5) {
      return "REGIME_UNKNOWN: insufficient market clarity";
    }

    // Don't trade against confirmed strong trend
    if (regime.regime === "TRENDING_BULLISH" && signal.direction === "SHORT") {
      if (regime.confidence > 0.85 && regime.trendStrength > 0.8) {
        return "REGIME_CONFLICT: shorting into strong bullish trend";
      }
    }
    if (regime.regime === "TRENDING_BEARISH" && signal.direction === "LONG") {
      if (regime.confidence > 0.85 && regime.trendStrength > 0.8) {
        return "REGIME_CONFLICT: longing into strong bearish trend";
      }
    }

    return null;
  }

  private computeRiskScore(factors: {
    confidence: number;
    spread: number;
    liqDistance: number;
    leverage: number;
    marginUtilization: number;
    accountHealth: number;
    rr: number;
  }): number {
    const { confidence, spread, liqDistance, leverage, marginUtilization, accountHealth, rr } = factors;

    let score = 100;

    // Confidence contribution (0-25 pts)
    score -= (1 - confidence) * 25;

    // Spread penalty (0-20 pts)
    score -= Math.min(spread / 2, 20);

    // Liquidation distance (0-20 pts — higher is safer)
    score -= Math.max(0, (0.15 - liqDistance) / 0.15) * 20;

    // Leverage penalty (0-15 pts)
    score -= (leverage / LEVERAGE_POLICY.BTC.hardCap) * 15;

    // Margin utilization penalty (0-10 pts)
    score -= marginUtilization * 10;

    // Account health (0-10 pts)
    score -= Math.max(0, (80 - accountHealth) / 80) * 10;

    return Math.round(clamp(score, 0, 100));
  }

  getState() {
    return {
      killSwitchActive: this.killSwitchActive,
      circuitBreakerTripped: this.circuitBreakerTripped,
      circuitBreakerReason: this.circuitBreakerReason,
      dailyLoss: Object.fromEntries(
        Object.entries(this.dailyLoss).map(([k, v]) => [k, v.toFixed(2)])
      ),
      consecutiveLosses: { ...this.consecutiveLosses },
      peakEquity: this.peakEquity.toFixed(2),
    };
  }
}
