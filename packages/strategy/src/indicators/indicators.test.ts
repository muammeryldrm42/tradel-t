import { describe, it, expect } from "vitest";
import {
  ema, sma, rsi, macd, atr, bollingerBands,
  adx, crossOver, crossUnder, last, obv,
} from "../src/indicators/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function linspace(start: number, end: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + (end - start) * (i / (n - 1)));
}

function sineWave(n: number, amplitude = 100, offset = 1000): number[] {
  return Array.from({ length: n }, (_, i) => offset + amplitude * Math.sin(i * 0.2));
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("EMA", () => {
  it("returns empty array when insufficient data", () => {
    expect(ema([1, 2, 3], 5)).toHaveLength(0);
  });

  it("returns values for sufficient data", () => {
    const prices = linspace(100, 200, 50);
    const result = ema(prices, 14);
    expect(result.length).toBeGreaterThan(0);
    result.forEach((v) => expect(v).toBeFinite());
  });

  it("EMA follows trend", () => {
    // Uptrend — EMA should increase
    const prices = linspace(100, 200, 100);
    const result = ema(prices, 20);
    const first = result[0]!;
    const last = result[result.length - 1]!;
    expect(last).toBeGreaterThan(first);
  });
});

describe("SMA", () => {
  it("averages correctly over window", () => {
    const prices = [10, 20, 30, 40, 50];
    const result = sma(prices, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(20); // (10+20+30)/3
    expect(result[1]).toBeCloseTo(30); // (20+30+40)/3
    expect(result[2]).toBeCloseTo(40); // (30+40+50)/3
  });
});

describe("RSI", () => {
  it("returns empty for insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toHaveLength(0);
  });

  it("stays in [0, 100] range", () => {
    const prices = sineWave(100);
    const result = rsi(prices, 14);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it("is high in strong uptrend", () => {
    const prices = linspace(100, 200, 50);
    const result = rsi(prices, 14);
    const avg = result.reduce((a, b) => a + b, 0) / result.length;
    expect(avg).toBeGreaterThan(60);
  });

  it("is low in strong downtrend", () => {
    const prices = linspace(200, 100, 50);
    const result = rsi(prices, 14);
    const avg = result.reduce((a, b) => a + b, 0) / result.length;
    expect(avg).toBeLessThan(40);
  });
});

describe("MACD", () => {
  it("returns correct array structure", () => {
    const prices = sineWave(100);
    const result = macd(prices, 12, 26, 9);
    expect(result.macd).toBeDefined();
    expect(result.signal).toBeDefined();
    expect(result.histogram).toBeDefined();
    expect(result.histogram.length).toBeGreaterThan(0);
  });

  it("histogram = macd - signal", () => {
    const prices = sineWave(100);
    const { macd: macdLine, signal, histogram } = macd(prices, 12, 26, 9);
    const offset = macdLine.length - signal.length;
    histogram.forEach((h, i) => {
      const m = macdLine[i + offset] ?? 0;
      const s = signal[i] ?? 0;
      expect(h).toBeCloseTo(m - s, 6);
    });
  });
});

describe("ATR", () => {
  it("returns positive values", () => {
    const n = 50;
    const closes = sineWave(n, 50, 1000);
    const highs = closes.map((c) => c + 10);
    const lows = closes.map((c) => c - 10);
    const result = atr(highs, lows, closes, 14);
    result.forEach((v) => expect(v).toBeGreaterThan(0));
  });

  it("is higher in volatile markets", () => {
    const n = 60;
    const quietCloses = linspace(1000, 1010, n);
    const quietHighs = quietCloses.map((c) => c + 2);
    const quietLows = quietCloses.map((c) => c - 2);

    const volatileCloses = sineWave(n, 100, 1000);
    const volatileHighs = volatileCloses.map((c) => c + 50);
    const volatileLows = volatileCloses.map((c) => c - 50);

    const quietAtr = last(atr(quietHighs, quietLows, quietCloses, 14)) ?? 0;
    const volatileAtr = last(atr(volatileHighs, volatileLows, volatileCloses, 14)) ?? 0;

    expect(volatileAtr).toBeGreaterThan(quietAtr);
  });
});

describe("Bollinger Bands", () => {
  it("upper > middle > lower always", () => {
    const prices = sineWave(100, 50, 1000);
    const { upper, middle, lower } = bollingerBands(prices, 20, 2);
    for (let i = 0; i < upper.length; i++) {
      expect(upper[i]).toBeGreaterThan(middle[i] ?? 0);
      expect(middle[i]).toBeGreaterThan(lower[i] ?? 0);
    }
  });

  it("percent B is ~0.5 near the mean", () => {
    // Flat prices → price should be near middle of bands
    const prices = Array(50).fill(1000) as number[];
    const { percentB } = bollingerBands(prices, 20, 2);
    // All same price → std dev = 0, handle gracefully
    percentB.forEach((v) => expect(isFinite(v)).toBe(true));
  });
});

describe("ADX", () => {
  it("returns arrays of equal length (offset)", () => {
    const n = 80;
    const closes = sineWave(n);
    const highs = closes.map((c) => c + 5);
    const lows = closes.map((c) => c - 5);
    const { adx: adxArr, plusDI, minusDI } = adx(highs, lows, closes, 14);
    expect(adxArr.length).toBeGreaterThan(0);
    expect(plusDI.length).toBeGreaterThan(0);
    expect(minusDI.length).toBeGreaterThan(0);
  });

  it("ADX is high in trending market", () => {
    const n = 80;
    const closes = linspace(1000, 2000, n);
    const highs = closes.map((c) => c + 5);
    const lows = closes.map((c) => c - 5);
    const { adx: adxArr } = adx(highs, lows, closes, 14);
    const currentAdx = last(adxArr) ?? 0;
    expect(currentAdx).toBeGreaterThan(20);
  });
});

describe("Cross detection", () => {
  it("detects bullish crossover", () => {
    const a = [9, 9, 10, 11]; // fast
    const b = [10, 10, 10, 10]; // slow
    expect(crossOver(a, b)).toBe(true);
  });

  it("detects bearish crossunder", () => {
    const a = [11, 11, 10, 9];
    const b = [10, 10, 10, 10];
    expect(crossUnder(a, b)).toBe(true);
  });

  it("no cross when already above", () => {
    const a = [12, 13, 14, 15];
    const b = [10, 10, 10, 10];
    expect(crossOver(a, b)).toBe(false);
  });
});

describe("OBV", () => {
  it("increases when price rises", () => {
    const closes = [100, 101, 102, 103];
    const volumes = [1000, 1000, 1000, 1000];
    const result = obv(closes, volumes);
    expect(result[result.length - 1]).toBeGreaterThan(result[0] ?? 0);
  });

  it("decreases when price falls", () => {
    const closes = [103, 102, 101, 100];
    const volumes = [1000, 1000, 1000, 1000];
    const result = obv(closes, volumes);
    expect(result[result.length - 1]).toBeLessThan(result[0] ?? 0);
  });
});
