/**
 * RegimeDetector
 * 
 * Classifies current market conditions into actionable regimes.
 * Used by the ensemble to weight strategies appropriately.
 */

import type { Symbol, Candle, Ticker, RegimeState, MarketRegime } from "@lighter-bot/common";
import { adx, atr, bollingerBands, standardDeviation, percentRank, sma, last } from "../indicators/index.js";

export class RegimeDetector {
  detect(
    symbol: Symbol,
    candles: Candle[],
    ticker: Ticker
  ): RegimeState {
    if (candles.length < 50) {
      return this.unknownRegime(symbol);
    }

    const closes = candles.map((c) => parseFloat(c.close));
    const highs = candles.map((c) => parseFloat(c.high));
    const lows = candles.map((c) => parseFloat(c.low));

    const { adx: adxArr, plusDI, minusDI } = adx(highs, lows, closes, 14);
    const atrArr = atr(highs, lows, closes, 14);
    const bb = bollingerBands(closes, 20, 2);
    const stdDevArr = standardDeviation(closes, 20);
    const volatilityRank = percentRank(atrArr, Math.min(atrArr.length, 100));

    const currentAdx = last(adxArr) ?? 0;
    const currentPlusDI = last(plusDI) ?? 0;
    const currentMinusDI = last(minusDI) ?? 0;
    const currentBandwidth = last(bb.bandwidth) ?? 0;
    const currentVolatilityRank = last(volatilityRank) ?? 50;
    const currentAtr = last(atrArr) ?? 0;

    // ─── Recent price trend ──────────────────────────────────────────────
    const sma20 = last(sma(closes, 20)) ?? 0;
    const sma50 = last(sma(closes, Math.min(50, closes.length))) ?? 0;
    const currentClose = parseFloat(ticker.lastPrice);
    const priceAboveSmas = currentClose > sma20 && sma20 > sma50;
    const priceBelowSmas = currentClose < sma20 && sma20 < sma50;

    // ─── Volatility assessment ────────────────────────────────────────────
    const isHighVolatility = currentVolatilityRank > 75;
    const isLowVolatility = currentVolatilityRank < 25;

    // ─── Trend strength ────────────────────────────────────────────────────
    const isTrending = currentAdx > 25;
    const isStrongTrend = currentAdx > 40;
    const trendStrength = Math.min(currentAdx / 60, 1);

    // ─── Breakout detection ───────────────────────────────────────────────
    const prevBandwidth = last(bb.bandwidth.slice(0, -1)) ?? currentBandwidth;
    const bandwidthExpanding = currentBandwidth > prevBandwidth * 1.2;
    const bandwidthContracted = currentBandwidth < 0.03; // tight range

    let regime: MarketRegime;
    let confidence: number;

    if (isHighVolatility && bandwidthExpanding) {
      regime = currentPlusDI > currentMinusDI ? "BREAKOUT" : "BREAKDOWN";
      confidence = Math.min(0.5 + (currentVolatilityRank - 75) / 100, 0.90);
    } else if (isTrending && priceAboveSmas && currentPlusDI > currentMinusDI) {
      regime = "TRENDING_BULLISH";
      confidence = Math.min(0.5 + trendStrength * 0.4, 0.92);
    } else if (isTrending && priceBelowSmas && currentMinusDI > currentPlusDI) {
      regime = "TRENDING_BEARISH";
      confidence = Math.min(0.5 + trendStrength * 0.4, 0.92);
    } else if (isHighVolatility) {
      regime = "HIGH_VOLATILITY";
      confidence = Math.min(0.5 + (currentVolatilityRank - 50) / 100, 0.85);
    } else if (isLowVolatility || bandwidthContracted) {
      regime = "LOW_VOLATILITY";
      confidence = Math.min(0.5 + (50 - currentVolatilityRank) / 100, 0.80);
    } else if (!isTrending) {
      regime = "RANGING";
      confidence = Math.min(0.5 + (25 - currentAdx) / 50, 0.80);
    } else {
      regime = "UNKNOWN";
      confidence = 0.3;
    }

    // Volume confirmation
    const volumes = candles.map((c) => parseFloat(c.volume));
    const avgVol = last(sma(volumes, 20)) ?? 0;
    const currentVol = last(volumes) ?? 0;
    const volumeConfirmation = currentVol > avgVol * 1.2;

    return {
      symbol,
      regime,
      confidence,
      volatilityPercentile: currentVolatilityRank,
      trendStrength,
      volumeConfirmation,
      detectedAt: Date.now(),
      indicators: {
        adx: currentAdx,
        plusDI: currentPlusDI,
        minusDI: currentMinusDI,
        bandwidth: currentBandwidth,
        atr: currentAtr,
        volatilityRank: currentVolatilityRank,
      },
    };
  }

  private unknownRegime(symbol: Symbol): RegimeState {
    return {
      symbol,
      regime: "UNKNOWN",
      confidence: 0,
      volatilityPercentile: 50,
      trendStrength: 0,
      volumeConfirmation: false,
      detectedAt: Date.now(),
      indicators: {},
    };
  }
}
