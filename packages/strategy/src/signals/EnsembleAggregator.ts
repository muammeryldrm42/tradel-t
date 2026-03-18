/**
 * EnsembleSignalAggregator
 * 
 * Combines outputs from multiple strategies into a single actionable signal.
 * 
 * Design principles:
 * - False positive reduction via agreement score
 * - Regime-aware strategy weighting
 * - Blocks signals in poor conditions (chaotic, low-liquidity)
 * - Respects minimum agreement quorum
 * - Confidence floor prevents marginal trades
 */

import { randomUUID } from "crypto";
import type {
  Symbol,
  TradingSignal,
  EnsembleSignal,
  MarketRegime,
  StrategyConfig,
  Candle,
  Ticker,
  Interval,
} from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";

import { TrendFollowingStrategy } from "../strategies/TrendFollowing.js";
import { MeanReversionStrategy } from "../strategies/MeanReversion.js";
import { BreakoutStrategy } from "../strategies/Breakout.js";
import { MomentumStrategy } from "../strategies/Momentum.js";
import { RegimeDetector } from "../regime/RegimeDetector.js";
import type { IStrategy, StrategyInput } from "../strategies/BaseStrategy.js";

const log = createChildLogger({ module: "ensemble" });

export interface EnsembleConfig {
  minAgreementScore: number;    // 0-1, fraction of strategies that must agree
  minEnsembleConfidence: number;
  minStrategiesVoting: number;
  blockOnHighVolatility: boolean;
  blockVolatilityPercentile: number;
}

const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  minAgreementScore: 0.6,       // 60% of weighted vote must agree
  minEnsembleConfidence: 0.65,
  minStrategiesVoting: 2,
  blockOnHighVolatility: false, // warn but don't block — risk engine handles it
  blockVolatilityPercentile: 90,
};

// ─── Regime → Strategy weights ────────────────────────────────────────────────
// Each regime maps to how much we weight each strategy type
const REGIME_WEIGHTS: Record<MarketRegime, Record<string, number>> = {
  TRENDING_BULLISH: { TREND_FOLLOWING: 0.45, MOMENTUM: 0.35, BREAKOUT: 0.15, MEAN_REVERSION: 0.05, VOLATILITY_REGIME: 0 },
  TRENDING_BEARISH: { TREND_FOLLOWING: 0.45, MOMENTUM: 0.35, BREAKOUT: 0.15, MEAN_REVERSION: 0.05, VOLATILITY_REGIME: 0 },
  RANGING:          { MEAN_REVERSION: 0.50, MOMENTUM: 0.20, TREND_FOLLOWING: 0.15, BREAKOUT: 0.10, VOLATILITY_REGIME: 0.05 },
  BREAKOUT:         { BREAKOUT: 0.55, MOMENTUM: 0.25, TREND_FOLLOWING: 0.15, MEAN_REVERSION: 0.05, VOLATILITY_REGIME: 0 },
  BREAKDOWN:        { BREAKOUT: 0.55, MOMENTUM: 0.25, TREND_FOLLOWING: 0.15, MEAN_REVERSION: 0.05, VOLATILITY_REGIME: 0 },
  HIGH_VOLATILITY:  { VOLATILITY_REGIME: 0.40, BREAKOUT: 0.30, MOMENTUM: 0.20, TREND_FOLLOWING: 0.10, MEAN_REVERSION: 0 },
  LOW_VOLATILITY:   { MEAN_REVERSION: 0.45, BREAKOUT: 0.25, MOMENTUM: 0.15, TREND_FOLLOWING: 0.10, VOLATILITY_REGIME: 0.05 },
  UNKNOWN:          { TREND_FOLLOWING: 0.25, MEAN_REVERSION: 0.25, BREAKOUT: 0.25, MOMENTUM: 0.25, VOLATILITY_REGIME: 0 },
};

export class EnsembleSignalAggregator {
  private readonly strategies: Map<string, IStrategy>;
  private readonly regimeDetector: RegimeDetector;
  private readonly config: EnsembleConfig;

  constructor(config?: Partial<EnsembleConfig>) {
    this.config = { ...DEFAULT_ENSEMBLE_CONFIG, ...config };
    this.regimeDetector = new RegimeDetector();

    this.strategies = new Map<string, IStrategy>([
      ["TREND_FOLLOWING", new TrendFollowingStrategy()],
      ["MEAN_REVERSION", new MeanReversionStrategy()],
      ["BREAKOUT", new BreakoutStrategy()],
      ["MOMENTUM", new MomentumStrategy()],
    ]);
  }

  async generate(
    symbol: Symbol,
    candles: Map<Interval, Candle[]>,
    ticker: Ticker,
    strategyConfigs: StrategyConfig[]
  ): Promise<EnsembleSignal | null> {
    // ─── Detect regime ─────────────────────────────────────────────────────
    const primaryCandles = candles.get("1h") ?? candles.get("15m") ?? [];
    const regime = this.regimeDetector.detect(symbol, primaryCandles, ticker);

    // ─── Block on extreme volatility ───────────────────────────────────────
    if (
      this.config.blockOnHighVolatility &&
      regime.volatilityPercentile >= this.config.blockVolatilityPercentile
    ) {
      log.info({ symbol, volatilityPct: regime.volatilityPercentile }, "Ensemble blocked: extreme volatility");
      return null;
    }

    // ─── Collect individual signals ────────────────────────────────────────
    const enabledConfigs = strategyConfigs.filter((c) => c.enabled && c.symbol === symbol);
    if (enabledConfigs.length === 0) return null;

    const signals: Array<{ signal: TradingSignal; weight: number }> = [];

    for (const config of enabledConfigs) {
      const strategy = this.strategies.get(config.type);
      if (!strategy) continue;

      const input: StrategyInput = { symbol, candles, ticker, config };

      try {
        const output = await strategy.generate(input);
        if (!output || output.direction === "FLAT") continue;

        // Regime-adjusted weight
        const regimeWeight = REGIME_WEIGHTS[regime.regime][config.type] ?? 0.25;
        const finalWeight = config.weight * regimeWeight;

        if (finalWeight < 0.05) continue; // negligible contribution

        // Build full signal from strategy output
        const signal: TradingSignal = {
          id: randomUUID(),
          symbol,
          direction: output.direction,
          confidence: output.confidence,
          entryPrice: output.entryPrice,
          stopLoss: output.stopLoss,
          takeProfit: output.takeProfit,
          riskRewardRatio: output.riskRewardRatio,
          strategyName: strategy.name,
          rationale: output.rationale,
          invalidationCondition: output.invalidationCondition,
          timeframe: config.timeframes[0] ?? "1h",
          generatedAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000,
          tags: output.tags,
        };

        signals.push({ signal, weight: finalWeight });
        log.debug({ strategy: strategy.name, direction: output.direction, confidence: output.confidence.toFixed(3), weight: finalWeight.toFixed(3) }, "Strategy signal collected");
      } catch (err) {
        log.warn({ strategy: config.type, err }, "Strategy threw error — skipping");
      }
    }

    if (signals.length < this.config.minStrategiesVoting) {
      log.debug({ symbol, signalCount: signals.length }, "Insufficient signals for ensemble");
      return null;
    }

    // ─── Agreement vote ────────────────────────────────────────────────────
    let longWeight = 0;
    let shortWeight = 0;
    let totalWeight = 0;

    for (const { signal, weight } of signals) {
      const weightedConf = signal.confidence * weight;
      if (signal.direction === "LONG") longWeight += weightedConf;
      else if (signal.direction === "SHORT") shortWeight += weightedConf;
      totalWeight += weightedConf;
    }

    if (totalWeight === 0) return null;

    const longScore = longWeight / totalWeight;
    const shortScore = shortWeight / totalWeight;

    const direction = longScore > shortScore ? "LONG" : "SHORT";
    const agreementScore = Math.max(longScore, shortScore);

    if (agreementScore < this.config.minAgreementScore) {
      log.debug(
        { symbol, direction, agreementScore: agreementScore.toFixed(3), threshold: this.config.minAgreementScore },
        "Ensemble blocked: insufficient agreement"
      );
      return null;
    }

    // ─── Ensemble confidence ───────────────────────────────────────────────
    const agreeingSignals = signals.filter((s) => s.signal.direction === direction);
    const avgConfidence =
      agreeingSignals.reduce((sum, s) => sum + s.signal.confidence * s.weight, 0) /
      agreeingSignals.reduce((sum, s) => sum + s.weight, 0);

    const regimeBonus = regime.confidence > 0.75 ? 0.03 : 0;
    const ensembleConfidence = Math.min(avgConfidence * agreementScore + regimeBonus, 0.97);

    if (ensembleConfidence < this.config.minEnsembleConfidence) {
      log.debug(
        { symbol, ensembleConfidence: ensembleConfidence.toFixed(3) },
        "Ensemble blocked: confidence too low"
      );
      return null;
    }

    // ─── Composite entry/stop/tp (from highest-confidence agreeing signal) ─
    const bestSignal = agreeingSignals.reduce((best, curr) =>
      curr.signal.confidence > best.signal.confidence ? curr : best
    );

    const baseSignal = bestSignal.signal;

    // Anti-overtrading: check signal hasn't expired
    if (baseSignal.expiresAt < Date.now()) return null;

    log.info(
      {
        symbol,
        direction,
        ensembleConfidence: ensembleConfidence.toFixed(3),
        agreementScore: agreementScore.toFixed(3),
        signaledStrategies: agreeingSignals.map((s) => s.signal.strategyName).join(","),
        regime: regime.regime,
      },
      "Ensemble signal generated"
    );

    return {
      ...baseSignal,
      id: randomUUID(),
      direction,
      confidence: ensembleConfidence,
      strategyName: "Ensemble",
      rationale: `Ensemble agreement: ${agreeingSignals.map((s) => s.signal.strategyName).join(", ")} | ${baseSignal.rationale}`,
      componentSignals: agreeingSignals.map((s) => s.signal),
      agreementScore,
      regimeAdjusted: true,
      generatedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      tags: [...new Set(agreeingSignals.flatMap((s) => s.signal.tags)), "ensemble", regime.regime.toLowerCase()],
    };
  }

  getRegimeDetector(): RegimeDetector {
    return this.regimeDetector;
  }
}
