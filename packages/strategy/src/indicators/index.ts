/**
 * Technical Indicators
 * Pure functions operating on price arrays.
 * All inputs validated, all outputs are numbers.
 */

// ─── Moving Averages ──────────────────────────────────────────────────────────

export function ema(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaVal = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(emaVal);
  for (let i = period; i < prices.length; i++) {
    emaVal = (prices[i]! - emaVal) * k + emaVal;
    result.push(emaVal);
  }
  return result;
}

export function sma(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function wma(prices: number[], period: number): number[] {
  const result: number[] = [];
  const weights = Array.from({ length: period }, (_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const weighted = slice.reduce((sum, price, idx) => sum + price * (weights[idx] ?? 1), 0);
    result.push(weighted / weightSum);
  }
  return result;
}

// ─── Momentum ─────────────────────────────────────────────────────────────────

export function rsi(prices: number[], period = 14): number[] {
  if (prices.length < period + 1) return [];

  const changes = prices.slice(1).map((p, i) => p - (prices[i] ?? 0));
  const result: number[] = [];

  let avgGain =
    changes.slice(0, period).filter((c) => c > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss =
    changes.slice(0, period).filter((c) => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;

  const rs = avgGain / (avgLoss || 1e-10);
  result.push(100 - 100 / (1 + rs));

  for (let i = period; i < changes.length; i++) {
    const change = changes[i] ?? 0;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsiVal = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
    result.push(rsiVal);
  }
  return result;
}

export function macd(
  prices: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEma = ema(prices, fast);
  const slowEma = ema(prices, slow);

  const offset = slowEma.length - fastEma.length;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEma.length; i++) {
    macdLine.push((fastEma[i + offset] ?? 0) - (slowEma[i] ?? 0));
  }

  const signalLine = ema(macdLine, signal);
  const signalOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((s, i) => (macdLine[i + signalOffset] ?? 0) - s);

  return { macd: macdLine, signal: signalLine, histogram };
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...highSlice);
    const lowest = Math.min(...lowSlice);
    const close = closes[i] ?? 0;
    rawK.push(highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100);
  }
  const d = sma(rawK, dPeriod);
  return { k: rawK, d };
}

// ─── Volatility ───────────────────────────────────────────────────────────────

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number[] {
  if (highs.length < 2) return [];
  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl = (highs[i] ?? 0) - (lows[i] ?? 0);
    const hpc = Math.abs((highs[i] ?? 0) - (closes[i - 1] ?? 0));
    const lpc = Math.abs((lows[i] ?? 0) - (closes[i - 1] ?? 0));
    trueRanges.push(Math.max(hl, hpc, lpc));
  }
  return ema(trueRanges, period);
}

export function bollingerBands(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[]; percentB: number[] } {
  const middle = sma(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  const percentB: number[] = [];

  for (let i = 0; i < middle.length; i++) {
    const slice = prices.slice(i, i + period);
    const mean = middle[i] ?? 0;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    const up = mean + stdDevMultiplier * stdDev;
    const lo = mean - stdDevMultiplier * stdDev;
    upper.push(up);
    lower.push(lo);
    bandwidth.push((up - lo) / mean);
    percentB.push(up === lo ? 0.5 : ((prices[i + period - 1] ?? mean) - lo) / (up - lo));
  }

  return { upper, middle, lower, bandwidth, percentB };
}

export function standardDeviation(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
    result.push(Math.sqrt(variance));
  }
  return result;
}

// ─── Trend ────────────────────────────────────────────────────────────────────

export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  if (highs.length < period + 1) return { adx: [], plusDI: [], minusDI: [] };

  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = (highs[i] ?? 0) - (highs[i - 1] ?? 0);
    const downMove = (lows[i - 1] ?? 0) - (lows[i] ?? 0);
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const hl = (highs[i] ?? 0) - (lows[i] ?? 0);
    const hpc = Math.abs((highs[i] ?? 0) - (closes[i - 1] ?? 0));
    const lpc = Math.abs((lows[i] ?? 0) - (closes[i - 1] ?? 0));
    trs.push(Math.max(hl, hpc, lpc));
  }

  const smoothTR = smoothed(trs, period);
  const smoothPlus = smoothed(plusDMs, period);
  const smoothMinus = smoothed(minusDMs, period);

  const plusDI = smoothPlus.map((v, i) => (smoothTR[i] ? (v / smoothTR[i]!) * 100 : 0));
  const minusDI = smoothMinus.map((v, i) => (smoothTR[i] ? (v / smoothTR[i]!) * 100 : 0));

  const dx = plusDI.map((p, i) => {
    const m = minusDI[i] ?? 0;
    const sum = p + m;
    return sum === 0 ? 0 : (Math.abs(p - m) / sum) * 100;
  });

  const adxLine = sma(dx, period);

  return { adx: adxLine, plusDI, minusDI };
}

function smoothed(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const result: number[] = [];
  let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
  result.push(sum);
  for (let i = period; i < values.length; i++) {
    sum = sum - sum / period + (values[i] ?? 0);
    result.push(sum);
  }
  return result;
}

// ─── Volume ───────────────────────────────────────────────────────────────────

export function obv(closes: number[], volumes: number[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1] ?? 0;
    const curr = closes[i] ?? 0;
    const vol = volumes[i] ?? 0;
    if (curr > prev) result.push((result[result.length - 1] ?? 0) + vol);
    else if (curr < prev) result.push((result[result.length - 1] ?? 0) - vol);
    else result.push(result[result.length - 1] ?? 0);
  }
  return result;
}

export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): number[] {
  const result: number[] = [];
  let cumVol = 0;
  let cumTPV = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = ((highs[i] ?? 0) + (lows[i] ?? 0) + (closes[i] ?? 0)) / 3;
    const vol = volumes[i] ?? 0;
    cumTPV += tp * vol;
    cumVol += vol;
    result.push(cumVol === 0 ? tp : cumTPV / cumVol);
  }
  return result;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function percentRank(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const current = slice[slice.length - 1] ?? 0;
    const below = slice.filter((v) => v < current).length;
    result.push((below / (period - 1)) * 100);
  }
  return result;
}

export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

export function prev<T>(arr: T[], n = 1): T | undefined {
  return arr[arr.length - 1 - n];
}

export function crossOver(a: number[], b: number[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  return (
    (a[a.length - 2] ?? 0) <= (b[b.length - 2] ?? 0) &&
    (a[a.length - 1] ?? 0) > (b[b.length - 1] ?? 0)
  );
}

export function crossUnder(a: number[], b: number[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  return (
    (a[a.length - 2] ?? 0) >= (b[b.length - 2] ?? 0) &&
    (a[a.length - 1] ?? 0) < (b[b.length - 1] ?? 0)
  );
}
