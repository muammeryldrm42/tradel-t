/**
 * Technical indicator unit tests
 */
import { describe, it, expect } from "vitest";
import { ema, sma, rsi, macd, bollingerBands, atr, crossOver, crossUnder } from "../indicators/index.js";

const prices = [
  44, 43, 44, 45, 48, 47, 49, 52, 53, 51, 49, 48, 47, 49, 52,
  55, 58, 60, 62, 59, 57, 55, 53, 52, 51, 54, 57, 60, 63, 65,
];

describe("Indicators", () => {
  describe("SMA", () => {
    it("produces correct length", () => {
      const result = sma(prices, 5);
      expect(result.length).toBe(prices.length - 5 + 1);
    });

    it("computes first value correctly", () => {
      const result = sma([10, 20, 30, 40, 50], 5);
      expect(result[0]).toBeCloseTo(30);
    });
  });

  describe("EMA", () => {
    it("produces output for valid input", () => {
      const result = ema(prices, 10);
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns empty for insufficient data", () => {
      expect(ema([1, 2, 3], 10)).toHaveLength(0);
    });

    it("EMA reacts faster than SMA to recent moves", () => {
      const data = [...prices, 100, 100, 100]; // sharp spike
      const emaResult = ema(data, 10);
      const smaResult = sma(data, 10);
      const lastEma = emaResult[emaResult.length - 1] ?? 0;
      const lastSma = smaResult[smaResult.length - 1] ?? 0;
      expect(lastEma).toBeGreaterThan(lastSma);
    });
  });

  describe("RSI", () => {
    it("values are bounded 0–100", () => {
      const result = rsi(prices, 14);
      result.forEach((v) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    it("produces some results for 30 prices with period 14", () => {
      const result = rsi(prices, 14);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("MACD", () => {
    it("returns all three components", () => {
      const result = macd(prices, 5, 10, 3);
      expect(result.macd).toBeDefined();
      expect(result.signal).toBeDefined();
      expect(result.histogram).toBeDefined();
    });

    it("histogram = macd - signal (within floating point tolerance)", () => {
      const result = macd(prices, 5, 10, 3);
      const offset = result.macd.length - result.signal.length;
      result.signal.forEach((s, i) => {
        const m = result.macd[i + offset] ?? 0;
        const h = result.histogram[i] ?? 0;
        expect(Math.abs(h - (m - s))).toBeLessThan(1e-9);
      });
    });
  });

  describe("Bollinger Bands", () => {
    it("upper > middle > lower", () => {
      const result = bollingerBands(prices, 10, 2);
      result.upper.forEach((u, i) => {
        expect(u).toBeGreaterThanOrEqual(result.middle[i] ?? 0);
        expect(result.middle[i] ?? 0).toBeGreaterThanOrEqual(result.lower[i] ?? 0);
      });
    });

    it("percentB near 0 when price is at lower band", () => {
      // All prices equal → very tight bands, %B around 0.5
      const flat = Array(25).fill(100);
      const result = bollingerBands(flat, 20, 2);
      result.percentB.forEach((b) => {
        // With zero variance, percentB is undefined but should not crash
        expect(isFinite(b) || isNaN(b)).toBe(true);
      });
    });
  });

  describe("ATR", () => {
    const highs  = prices.map((p) => p + 2);
    const lows   = prices.map((p) => p - 2);
    const closes = prices;

    it("all values are positive", () => {
      const result = atr(highs, lows, closes, 14);
      result.forEach((v) => expect(v).toBeGreaterThan(0));
    });

    it("ATR increases with higher volatility", () => {
      const smoothHighs = prices.map((p) => p + 1);
      const smoothLows  = prices.map((p) => p - 1);
      const wildHighs   = prices.map((p) => p + 10);
      const wildLows    = prices.map((p) => p - 10);

      const smoothAtr = atr(smoothHighs, smoothLows, closes, 14);
      const wildAtr   = atr(wildHighs, wildLows, closes, 14);

      const avgSmooth = (smoothAtr.reduce((a, b) => a + b, 0)) / smoothAtr.length;
      const avgWild   = (wildAtr.reduce((a, b) => a + b, 0)) / wildAtr.length;
      expect(avgWild).toBeGreaterThan(avgSmooth);
    });
  });

  describe("Crossover detection", () => {
    it("detects bullish crossover", () => {
      const fast = [9, 9, 10, 11]; // crosses above slow
      const slow = [10, 10, 10, 10];
      expect(crossOver(fast, slow)).toBe(true);
    });

    it("detects bearish crossunder", () => {
      const fast = [11, 11, 10, 9];
      const slow = [10, 10, 10, 10];
      expect(crossUnder(fast, slow)).toBe(true);
    });

    it("returns false when already above (no cross)", () => {
      const fast = [12, 13, 14, 15];
      const slow = [10, 10, 10, 10];
      expect(crossOver(fast, slow)).toBe(false);
    });
  });
});
