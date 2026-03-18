/**
 * MomentumStrategy
 * 
 * Signal logic:
 * - MACD histogram direction + momentum
 * - RSI trend-following (not counter-trend)
 * - Multi-timeframe confirmation: higher TF trend must agree
 * - OBV confirms accumulation/distribution
 */

import { BaseStrategy, type StrategyInput, type StrategyOutput } from "./BaseStrategy.js";
import { macd, rsi, obv, atr, ema, last, prev } from "../indicators/index.js";
import type { Interval } from "@lighter-bot/common";

export interface MomentumParams {
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  rsiPeriod: number;
  rsiMomentumMin: number;   // RSI must be above (LONG) or below (SHORT) this
  rsiMomentumMax: number;
  obvEmaPeriod: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTpMultiplier: number;
  higherTfRequired: boolean;
  minCandleCount: number;
}

const DEFAULTS: MomentumParams = {
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  rsiMomentumMin: 45,
  rsiMomentumMax: 55,
  obvEmaPeriod: 20,
  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  atrTpMultiplier: 2.5,
  higherTfRequired: true,
  minCandleCount: 80,
};

export class MomentumStrategy extends BaseStrategy {
  readonly name = "Momentum";
  readonly type = "MOMENTUM";

  async generate(input: StrategyInput): Promise<StrategyOutput | null> {
    const { candles, ticker, config } = input;
    const timeframes = config.timeframes;
    const primaryTf: Interval = timeframes[0] ?? "15m";
    const higherTf: Interval = timeframes[1] ?? "1h";

    const candleArr = candles.get(primaryTf) ?? [];
    const higherCandleArr = candles.get(higherTf) ?? [];

    const params: MomentumParams = {
      ...DEFAULTS,
      ...(config.params as Partial<MomentumParams>),
    };

    if (candleArr.length < params.minCandleCount) return null;

    const closes = this.extractClosePrices(candleArr);
    const highs = this.extractHighPrices(candleArr);
    const lows = this.extractLowPrices(candleArr);
    const volumes = this.extractVolumes(candleArr);

    const macdResult = macd(closes, params.macdFast, params.macdSlow, params.macdSignal);
    const rsiArr = rsi(closes, params.rsiPeriod);
    const obvArr = obv(closes, volumes);
    const obvEmaArr = ema(obvArr, params.obvEmaPeriod);
    const atrArr = atr(highs, lows, closes, params.atrPeriod);

    const currentPrice = parseFloat(ticker.lastPrice);
    const currentRsi = last(rsiArr) ?? 50;
    const currentHistogram = last(macdResult.histogram) ?? 0;
    const prevHistogram = prev(macdResult.histogram) ?? 0;
    const currentObv = last(obvArr) ?? 0;
    const currentObvEma = last(obvEmaArr) ?? 0;
    const currentAtr = last(atrArr) ?? 0;

    // ─── Histogram momentum (accelerating) ────────────────────────────────
    const histogramAccelerating =
      Math.abs(currentHistogram) > Math.abs(prevHistogram);
    if (!histogramAccelerating) return null;

    // ─── OBV trend confirmation ────────────────────────────────────────────
    const obvBullish = currentObv > currentObvEma;
    const obvBearish = currentObv < currentObvEma;

    let direction: "LONG" | "SHORT" | null = null;
    let confidence = 0;
    let rationale = "";

    if (
      currentHistogram > 0 &&
      currentRsi >= params.rsiMomentumMin &&
      currentRsi <= 70 &&
      obvBullish
    ) {
      // Higher TF confirmation
      if (params.higherTfRequired && higherCandleArr.length > 30) {
        const htfBias = this.getHigherTfBias(higherCandleArr);
        if (htfBias === "BEARISH") return null;
      }
      direction = "LONG";
      confidence = this.calcConfidence(currentHistogram, prevHistogram, currentRsi, currentObv, currentObvEma, "LONG", params);
      rationale = `MACD histogram accelerating bullish (${currentHistogram.toFixed(4)}), RSI=${currentRsi.toFixed(1)}, OBV above EMA`;
    } else if (
      currentHistogram < 0 &&
      currentRsi <= (100 - params.rsiMomentumMin) &&
      currentRsi >= 30 &&
      obvBearish
    ) {
      if (params.higherTfRequired && higherCandleArr.length > 30) {
        const htfBias = this.getHigherTfBias(higherCandleArr);
        if (htfBias === "BULLISH") return null;
      }
      direction = "SHORT";
      confidence = this.calcConfidence(currentHistogram, prevHistogram, currentRsi, currentObv, currentObvEma, "SHORT", params);
      rationale = `MACD histogram accelerating bearish (${currentHistogram.toFixed(4)}), RSI=${currentRsi.toFixed(1)}, OBV below EMA`;
    }

    if (!direction) return null;

    const stopLoss =
      direction === "LONG"
        ? (currentPrice - currentAtr * params.atrStopMultiplier).toFixed(8)
        : (currentPrice + currentAtr * params.atrStopMultiplier).toFixed(8);

    const takeProfit =
      direction === "LONG"
        ? (currentPrice + currentAtr * params.atrTpMultiplier).toFixed(8)
        : (currentPrice - currentAtr * params.atrTpMultiplier).toFixed(8);

    const riskRewardRatio = params.atrTpMultiplier / params.atrStopMultiplier;

    return {
      direction,
      confidence,
      entryPrice: currentPrice.toFixed(8),
      stopLoss,
      takeProfit,
      riskRewardRatio,
      rationale,
      invalidationCondition: `MACD histogram reverses direction`,
      tags: ["momentum", "macd", "multi-timeframe", "obv-confirmed"],
    };
  }

  private getHigherTfBias(candles: Candle[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
    const closes = candles.map((c) => parseFloat(c.close));
    const ema21 = ema(closes, 21);
    const ema55 = ema(closes, 55);
    if (ema21.length < 1 || ema55.length < 1) return "NEUTRAL";
    const fast = last(ema21) ?? 0;
    const slow = last(ema55) ?? 0;
    if (fast > slow * 1.005) return "BULLISH";
    if (fast < slow * 0.995) return "BEARISH";
    return "NEUTRAL";
  }

  private calcConfidence(
    histogram: number,
    prevHistogram: number,
    rsiVal: number,
    obvVal: number,
    obvEmaVal: number,
    direction: "LONG" | "SHORT",
    params: MomentumParams
  ): number {
    let conf = 0.5;

    // Histogram acceleration strength
    const acceleration = Math.abs(histogram) / (Math.abs(prevHistogram) + 1e-10) - 1;
    conf += Math.min(acceleration * 0.15, 0.15);

    // RSI momentum zone
    const inMomentumZone = direction === "LONG"
      ? rsiVal >= 50 && rsiVal <= 65
      : rsiVal <= 50 && rsiVal >= 35;
    if (inMomentumZone) conf += 0.10;

    // OBV divergence from EMA
    const obvDeviation = Math.abs(obvVal - obvEmaVal) / (Math.abs(obvEmaVal) + 1);
    conf += Math.min(obvDeviation * 0.1, 0.10);

    return Math.min(conf, 0.88);
  }
}

// Re-export type for indicator usage
type Candle = { close: string };
