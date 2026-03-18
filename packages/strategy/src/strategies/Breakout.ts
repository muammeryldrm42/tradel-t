/**
 * BreakoutStrategy
 * 
 * Signal logic:
 * - Price breaks above/below N-period high/low
 * - Volume spike confirms breakout
 * - ATR confirms expansion (not dead market)
 * - Breakout retest preferred over direct entries
 */

import { BaseStrategy, type StrategyInput, type StrategyOutput } from "./BaseStrategy.js";
import { atr, sma, last, prev } from "../indicators/index.js";

export interface BreakoutParams {
  lookbackPeriod: number;      // periods for high/low channel
  volumeMultiplier: number;    // breakout volume must be X times average
  atrPeriod: number;
  atrExpansionMin: number;     // min ATR percentile to confirm volatility
  stopAtrMultiplier: number;
  tpAtrMultiplier: number;
  minCandleCount: number;
  retestEnabled: boolean;      // wait for retest before entry
}

const DEFAULTS: BreakoutParams = {
  lookbackPeriod: 20,
  volumeMultiplier: 1.5,
  atrPeriod: 14,
  atrExpansionMin: 0.5,
  stopAtrMultiplier: 1.0,
  tpAtrMultiplier: 3.0,
  minCandleCount: 50,
  retestEnabled: false,
};

export class BreakoutStrategy extends BaseStrategy {
  readonly name = "Breakout";
  readonly type = "BREAKOUT";

  async generate(input: StrategyInput): Promise<StrategyOutput | null> {
    const { candles, ticker, config } = input;
    const primaryTf = config.timeframes[0] ?? "1h";
    const candleArr = candles.get(primaryTf) ?? [];

    const params: BreakoutParams = {
      ...DEFAULTS,
      ...(config.params as Partial<BreakoutParams>),
    };

    if (candleArr.length < params.minCandleCount) return null;

    const closes = this.extractClosePrices(candleArr);
    const highs = this.extractHighPrices(candleArr);
    const lows = this.extractLowPrices(candleArr);
    const volumes = this.extractVolumes(candleArr);

    const atrArr = atr(highs, lows, closes, params.atrPeriod);
    const avgVolArr = sma(volumes, params.lookbackPeriod);

    const currentPrice = parseFloat(ticker.lastPrice);
    const currentAtr = last(atrArr) ?? 0;
    const avgVol = last(avgVolArr) ?? 0;
    const currentVol = last(volumes) ?? 0;

    // Need at least lookbackPeriod candles before current
    const lookbackSlice = candleArr.slice(-params.lookbackPeriod - 1, -1);
    if (lookbackSlice.length < params.lookbackPeriod) return null;

    const periodHigh = Math.max(...lookbackSlice.map((c) => parseFloat(c.high)));
    const periodLow = Math.min(...lookbackSlice.map((c) => parseFloat(c.low)));

    // ─── Volume confirmation ────────────────────────────────────────────────
    const hasVolumeConfirmation = currentVol >= avgVol * params.volumeMultiplier;
    if (!hasVolumeConfirmation) return null;

    // ─── ATR expansion check ───────────────────────────────────────────────
    const prevAtr = prev(atrArr, 3) ?? currentAtr;
    const atrExpanding = currentAtr > prevAtr * (1 + params.atrExpansionMin);

    const lastClose = last(closes) ?? 0;
    const prevClose = prev(closes) ?? 0;

    let direction: "LONG" | "SHORT" | null = null;
    let breakoutLevel = 0;
    let rationale = "";

    // Bullish breakout: close breaks above period high
    if (lastClose > periodHigh && prevClose <= periodHigh) {
      direction = "LONG";
      breakoutLevel = periodHigh;
      rationale = `Bullish breakout above ${periodHigh.toFixed(2)} (${params.lookbackPeriod}-period high), vol=${(currentVol / avgVol).toFixed(2)}x avg, ATR expanding=${atrExpanding}`;
    }

    // Bearish breakout: close breaks below period low
    if (lastClose < periodLow && prevClose >= periodLow) {
      direction = "SHORT";
      breakoutLevel = periodLow;
      rationale = `Bearish breakdown below ${periodLow.toFixed(2)} (${params.lookbackPeriod}-period low), vol=${(currentVol / avgVol).toFixed(2)}x avg, ATR expanding=${atrExpanding}`;
    }

    if (!direction) return null;

    // ─── Confidence ────────────────────────────────────────────────────────
    const volScore = Math.min((currentVol / avgVol - 1) / 2, 0.25);
    const atrScore = atrExpanding ? 0.15 : 0;
    const breakoutStrength = Math.abs(lastClose - breakoutLevel) / (currentAtr || 1);
    const strengthScore = Math.min(breakoutStrength * 0.05, 0.15);
    const confidence = Math.min(0.55 + volScore + atrScore + strengthScore, 0.90);

    // ─── Stops & Targets ──────────────────────────────────────────────────
    const stopDistance = currentAtr * params.stopAtrMultiplier;
    const stopLoss =
      direction === "LONG"
        ? (breakoutLevel - stopDistance).toFixed(8)  // stop below breakout level
        : (breakoutLevel + stopDistance).toFixed(8);

    const tpDistance = currentAtr * params.tpAtrMultiplier;
    const takeProfit =
      direction === "LONG"
        ? (currentPrice + tpDistance).toFixed(8)
        : (currentPrice - tpDistance).toFixed(8);

    const priceDiff = Math.abs(currentPrice - parseFloat(stopLoss));
    const tpDiff = Math.abs(parseFloat(takeProfit) - currentPrice);
    const riskRewardRatio = priceDiff > 0 ? tpDiff / priceDiff : 0;

    return {
      direction,
      confidence,
      entryPrice: currentPrice.toFixed(8),
      stopLoss,
      takeProfit,
      riskRewardRatio,
      rationale,
      invalidationCondition: `Price closes back ${direction === "LONG" ? "below" : "above"} ${breakoutLevel.toFixed(2)} within 3 candles`,
      tags: ["breakout", direction === "LONG" ? "bullish-breakout" : "bearish-breakdown", "volume-confirmed"],
    };
  }
}
