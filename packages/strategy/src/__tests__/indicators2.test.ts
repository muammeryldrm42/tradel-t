import { describe, it, expect } from "vitest";
import { ema, sma, rsi, macd, bollingerBands, atr, crossOver, crossUnder, last } from "../indicators/index.js";

function linearPrices(start: number, slope: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => start + slope * i);
}
function randomWalk(start: number, n: number): number[] {
  let val = start; const out = [val]; let s = 42;
  for (let i = 1; i < n; i++) { s = (s * 1664525 + 1013904223) & 0xffffffff; val += ((s >>> 0) / 0xffffffff - 0.5) * 20; out.push(Math.max(1, val)); }
  return out;
}

describe("Indicators", () => {
  it("EMA: returns n-period+1 values", () => {
    expect(ema(linearPrices(100,1,50), 10).length).toBe(41);
  });
  it("EMA: empty when insufficient data", () => {
    expect(ema([1,2,3], 10)).toEqual([]);
  });
  it("SMA: correct rolling average", () => {
    const r = sma([1,2,3,4,5,6], 3);
    expect(r[0]).toBeCloseTo(2.0);
    expect(r[1]).toBeCloseTo(3.0);
  });
  it("RSI: stays between 0 and 100", () => {
    const r = rsi(randomWalk(50000, 100), 14);
    for (const v of r) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
  });
  it("RSI: high in strong uptrend", () => {
    expect(last(rsi(linearPrices(100,10,50), 14)) ?? 0).toBeGreaterThan(80);
  });
  it("RSI: low in strong downtrend", () => {
    expect(last(rsi(linearPrices(1000,-10,50), 14)) ?? 100).toBeLessThan(20);
  });
  it("MACD: histogram = macd - signal", () => {
    const prices = randomWalk(50000, 100);
    const m = macd(prices);
    const offset = m.macd.length - m.histogram.length;
    for (let i = 0; i < m.histogram.length; i++) {
      expect(m.histogram[i]).toBeCloseTo((m.macd[i+offset]??0) - (m.signal[i]??0), 5);
    }
  });
  it("BB: upper >= middle >= lower", () => {
    const bb = bollingerBands(randomWalk(50000, 80), 20, 2);
    for (let i = 0; i < bb.middle.length; i++) {
      expect(bb.upper[i]??0).toBeGreaterThanOrEqual(bb.middle[i]??0);
      expect(bb.middle[i]??0).toBeGreaterThanOrEqual(bb.lower[i]??0);
    }
  });
  it("ATR: positive values", () => {
    const p = randomWalk(50000, 50);
    const r = atr(p, p, p, 14);
    for (const v of r) expect(v).toBeGreaterThanOrEqual(0);
  });
  it("crossOver: detects correctly", () => {
    expect(crossOver([10,10,11],[10,10,10])).toBe(true);
    expect(crossOver([12,12,12],[10,10,10])).toBe(false);
  });
  it("crossUnder: detects correctly", () => {
    expect(crossUnder([10,10,9],[10,10,10])).toBe(true);
    expect(crossUnder([8,8,8],[10,10,10])).toBe(false);
  });
});
