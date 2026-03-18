/**
 * MeanReversionStrategy
 * 
 * Signal logic:
 * - Price touches/breaks Bollinger Band extremes
 * - RSI confirms oversold/overbought
 * - Stochastic secondary confirmation
 * - Mean (SMA20) as take-profit target
 */

import { BaseStrategy, type StrategyInput, type StrategyOutput } from "./BaseStrategy.js";
import { bollingerBands, rsi, stochastic, atr, sma, last } from "../indicators/index.js";

export interface MeanReversionParams {
  bbPeriod: number;
  bbStdDev: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  stochKPeriod: number;
  stochDPeriod: number;
  stochOversold: number;
  stochOverbought: number;
  atrPeriod: number;
  atrStopMultiplier: number;
  minCandleCount: number;
  minBandwidthPct: number; // only trade when bands are wide enough
}

const DEFAULTS: MeanReversionParams = {
  bbPeriod: 20,
  bbStdDev: 2,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  stochKPeriod: 14,
  stochDPeriod: 3,
  stochOversold: 25,
  stochOverbought: 75,
  atrPeriod: 14,
  atrStopMultiplier: 1.2,
  minCandleCount: 60,
  minBandwidthPct: 0.02, // bands must be at least 2% wide
};

export class MeanReversionStrategy extends BaseStrategy {
  readonly name = "MeanReversion";
  readonly type = "MEAN_REVERSION";

  async generate(input: StrategyInput): Promise<StrategyOutput | null> {
    const { candles, ticker, config } = input;
    const primaryTf = config.timeframes[0] ?? "15m";
    const candleArr = candles.get(primaryTf) ?? [];

    const params: MeanReversionParams = {
      ...DEFAULTS,
      ...(config.params as Partial<MeanReversionParams>),
    };

    if (candleArr.length < params.minCandleCount) return null;

    const closes = this.extractClosePrices(candleArr);
    const highs = this.extractHighPrices(candleArr);
    const lows = this.extractLowPrices(candleArr);

    const bb = bollingerBands(closes, params.bbPeriod, params.bbStdDev);
    const rsiArr = rsi(closes, params.rsiPeriod);
    const stoch = stochastic(highs, lows, closes, params.stochKPeriod, params.stochDPeriod);
    const atrArr = atr(highs, lows, closes, params.atrPeriod);

    const currentPrice = parseFloat(ticker.lastPrice);
    const upperBand = last(bb.upper) ?? 0;
    const lowerBand = last(bb.lower) ?? 0;
    const middleBand = last(bb.middle) ?? 0;
    const bandwidth = last(bb.bandwidth) ?? 0;
    const pctB = last(bb.percentB) ?? 0.5;
    const currentRsi = last(rsiArr) ?? 50;
    const currentStochK = last(stoch.k) ?? 50;
    const currentStochD = last(stoch.d) ?? 50;
    const currentAtr = last(atrArr) ?? 0;

    // Only trade mean reversion when bands have sufficient width (avoid chop)
    if (bandwidth < params.minBandwidthPct) return null;

    let direction: "LONG" | "SHORT" | null = null;
    let confidence = 0;
    let rationale = "";

    // ─── Long: price at/below lower band, RSI oversold ────────────────────
    if (
      pctB <= 0.05 &&
      currentRsi <= params.rsiOversold &&
      currentStochK <= params.stochOversold &&
      currentStochK < currentStochD
    ) {
      direction = "LONG";
      confidence = this.calcConfidence(pctB, currentRsi, currentStochK, "LONG", params);
      rationale = `Price at lower BB (pctB=${pctB.toFixed(3)}), RSI=${currentRsi.toFixed(1)} oversold, Stoch=${currentStochK.toFixed(1)}`;
    }

    // ─── Short: price at/above upper band, RSI overbought ─────────────────
    if (
      pctB >= 0.95 &&
      currentRsi >= params.rsiOverbought &&
      currentStochK >= params.stochOverbought &&
      currentStochK > currentStochD
    ) {
      direction = "SHORT";
      confidence = this.calcConfidence(pctB, currentRsi, currentStochK, "SHORT", params);
      rationale = `Price at upper BB (pctB=${pctB.toFixed(3)}), RSI=${currentRsi.toFixed(1)} overbought, Stoch=${currentStochK.toFixed(1)}`;
    }

    if (!direction) return null;

    // ─── Stop: beyond the band + ATR buffer ──────────────────────────────
    const atrBuffer = currentAtr * params.atrStopMultiplier;
    const stopLoss =
      direction === "LONG"
        ? Math.min(lowerBand - atrBuffer, currentPrice - atrBuffer * 1.5).toFixed(8)
        : Math.max(upperBand + atrBuffer, currentPrice + atrBuffer * 1.5).toFixed(8);

    // TP: mean reversion to middle band
    const takeProfit = middleBand.toFixed(8);

    const priceDiff = Math.abs(currentPrice - parseFloat(stopLoss));
    const tpDiff = Math.abs(middleBand - currentPrice);
    const riskRewardRatio = priceDiff > 0 ? tpDiff / priceDiff : 0;

    if (riskRewardRatio < 1.0) return null; // too tight for mean reversion

    return {
      direction,
      confidence,
      entryPrice: currentPrice.toFixed(8),
      stopLoss,
      takeProfit,
      riskRewardRatio,
      rationale,
      invalidationCondition: `Price closes ${direction === "LONG" ? "below" : "above"} current extreme with expanding bands`,
      tags: ["mean-reversion", "bollinger-bands", "oversold-oversold"],
    };
  }

  private calcConfidence(
    pctB: number,
    rsiVal: number,
    stochVal: number,
    direction: "LONG" | "SHORT",
    params: MeanReversionParams
  ): number {
    let conf = 0.5;

    // Band extremity (0-0.20)
    const extremity = direction === "LONG" ? 1 - pctB : pctB;
    conf += extremity * 0.20;

    // RSI extremity (0-0.15)
    const rsiExtremity = direction === "LONG"
      ? Math.max(0, (params.rsiOversold - rsiVal) / params.rsiOversold)
      : Math.max(0, (rsiVal - params.rsiOverbought) / (100 - params.rsiOverbought));
    conf += rsiExtremity * 0.15;

    // Stochastic extremity (0-0.10)
    const stochExtremity = direction === "LONG"
      ? Math.max(0, (params.stochOversold - stochVal) / params.stochOversold)
      : Math.max(0, (stochVal - params.stochOverbought) / (100 - params.stochOverbought));
    conf += stochExtremity * 0.10;

    return Math.min(conf, 0.88); // mean reversion capped at 88% — inherently counter-trend
  }
}
