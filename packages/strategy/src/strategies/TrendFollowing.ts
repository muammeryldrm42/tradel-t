/**
 * TrendFollowingStrategy
 * 
 * Signal logic:
 * - EMA 21/55 crossover for direction
 * - ADX > threshold for trend strength confirmation
 * - RSI not overbought/oversold for entry timing
 * - ATR-based stop loss and take profit
 */

import { BaseStrategy, type StrategyInput, type StrategyOutput } from "./BaseStrategy.js";
import { ema, rsi, atr, adx, last, crossOver, crossUnder } from "../indicators/index.js";

export interface TrendFollowingParams {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  atrTpMultiplier: number;
  minCandleCount: number;
}

const DEFAULTS: TrendFollowingParams = {
  fastEmaPeriod: 21,
  slowEmaPeriod: 55,
  adxPeriod: 14,
  adxThreshold: 25,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  atrTpMultiplier: 3.0,
  minCandleCount: 80,
};

export class TrendFollowingStrategy extends BaseStrategy {
  readonly name = "TrendFollowing";
  readonly type = "TREND_FOLLOWING";

  async generate(input: StrategyInput): Promise<StrategyOutput | null> {
    const { symbol, candles, ticker, config } = input;
    const primaryTf = config.timeframes[0] ?? "1h";
    const candleArr = candles.get(primaryTf) ?? [];

    const params: TrendFollowingParams = {
      ...DEFAULTS,
      ...(config.params as Partial<TrendFollowingParams>),
    };

    if (candleArr.length < params.minCandleCount) return null;

    const closes = this.extractClosePrices(candleArr);
    const highs = this.extractHighPrices(candleArr);
    const lows = this.extractLowPrices(candleArr);

    const fastEmaArr = ema(closes, params.fastEmaPeriod);
    const slowEmaArr = ema(closes, params.slowEmaPeriod);
    const rsiArr = rsi(closes, params.rsiPeriod);
    const { adx: adxArr } = adx(highs, lows, closes, params.adxPeriod);
    const atrArr = atr(highs, lows, closes, params.atrPeriod);

    const currentAdx = last(adxArr) ?? 0;
    const currentRsi = last(rsiArr) ?? 50;
    const currentAtr = last(atrArr) ?? 0;
    const currentPrice = parseFloat(ticker.lastPrice);

    // ─── Trend Strength Gate ────────────────────────────────────────────────
    if (currentAdx < params.adxThreshold) return null;

    const isGoldenCross = crossOver(fastEmaArr, slowEmaArr);
    const isDeathCross = crossUnder(fastEmaArr, slowEmaArr);

    const fastEma = last(fastEmaArr) ?? 0;
    const slowEma = last(slowEmaArr) ?? 0;

    // Already in trend (not just crossed)?
    const inBullTrend = fastEma > slowEma && !isGoldenCross;
    const inBearTrend = fastEma < slowEma && !isDeathCross;

    if (!isGoldenCross && !isDeathCross && !inBullTrend && !inBearTrend) return null;

    let direction: "LONG" | "SHORT" | null = null;
    let confidence = 0;
    let rationale = "";

    if (isGoldenCross || inBullTrend) {
      // Don't long into overbought
      if (currentRsi > params.rsiOverbought) return null;
      direction = "LONG";
      confidence = this.calcConfidence(currentAdx, currentRsi, "LONG", params, isGoldenCross);
      rationale = `EMA(${params.fastEmaPeriod}/${params.slowEmaPeriod}) ${isGoldenCross ? "bullish crossover" : "bullish alignment"}, ADX=${currentAdx.toFixed(1)}, RSI=${currentRsi.toFixed(1)}`;
    } else if (isDeathCross || inBearTrend) {
      // Don't short into oversold
      if (currentRsi < params.rsiOversold) return null;
      direction = "SHORT";
      confidence = this.calcConfidence(currentAdx, currentRsi, "SHORT", params, isDeathCross);
      rationale = `EMA(${params.fastEmaPeriod}/${params.slowEmaPeriod}) ${isDeathCross ? "bearish crossover" : "bearish alignment"}, ADX=${currentAdx.toFixed(1)}, RSI=${currentRsi.toFixed(1)}`;
    }

    if (!direction) return null;

    // ─── ATR-based stops ───────────────────────────────────────────────────
    const atrDistance = currentAtr * params.atrStopMultiplier;
    const stopLoss =
      direction === "LONG"
        ? (currentPrice - atrDistance).toFixed(8)
        : (currentPrice + atrDistance).toFixed(8);

    const tpDistance = currentAtr * params.atrTpMultiplier;
    const takeProfit =
      direction === "LONG"
        ? (currentPrice + tpDistance).toFixed(8)
        : (currentPrice - tpDistance).toFixed(8);

    const riskRewardRatio = params.atrTpMultiplier / params.atrStopMultiplier;

    return {
      direction,
      confidence,
      entryPrice: currentPrice.toFixed(8),
      stopLoss,
      takeProfit,
      riskRewardRatio,
      rationale,
      invalidationCondition: `Price closes ${direction === "LONG" ? "below" : "above"} slow EMA (${slowEma.toFixed(2)}) with ADX still rising`,
      tags: ["trend", "ema-crossover", isGoldenCross || isDeathCross ? "fresh-cross" : "continuation"],
    };
  }

  private calcConfidence(
    adxVal: number,
    rsiVal: number,
    direction: "LONG" | "SHORT",
    params: TrendFollowingParams,
    isFreshCross: boolean
  ): number {
    let conf = 0.5;

    // ADX contribution (0-0.25)
    conf += Math.min((adxVal - params.adxThreshold) / 50, 0.25);

    // RSI positioning (0-0.15)
    if (direction === "LONG") {
      // Best long confidence when RSI is 40-60 (room to run)
      conf += rsiVal >= 40 && rsiVal <= 60 ? 0.15 : rsiVal < 70 ? 0.08 : 0;
    } else {
      conf += rsiVal <= 60 && rsiVal >= 40 ? 0.15 : rsiVal > 30 ? 0.08 : 0;
    }

    // Fresh cross bonus
    if (isFreshCross) conf += 0.05;

    return Math.min(conf, 0.95);
  }
}
