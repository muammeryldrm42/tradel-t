import { Decimal } from "decimal.js";
import { randomUUID } from "crypto";

export function spreadBps(bid: string, ask: string): number {
  const mid = new Decimal(bid).plus(new Decimal(ask)).div(2);
  return new Decimal(ask).minus(new Decimal(bid)).div(mid).mul(10000).toNumber();
}

export function calcLiquidationPrice(
  entryPrice: string,
  leverage: number,
  side: "LONG" | "SHORT",
  maintenanceMarginRate: number
): string {
  const entry = new Decimal(entryPrice);
  const lev = new Decimal(leverage);
  if (side === "LONG") {
    return entry
      .mul(new Decimal(1).minus(new Decimal(1).div(lev)).plus(maintenanceMarginRate))
      .toFixed(8);
  }
  return entry
    .mul(new Decimal(1).plus(new Decimal(1).div(lev)).minus(maintenanceMarginRate))
    .toFixed(8);
}

export function liquidationDistancePct(
  entryPrice: string,
  liquidationPrice: string,
  side: "LONG" | "SHORT"
): number {
  const entry = new Decimal(entryPrice);
  const liq = new Decimal(liquidationPrice);
  if (side === "LONG") return entry.minus(liq).div(entry).toNumber();
  return liq.minus(entry).div(entry).toNumber();
}

export function calcPositionSize(
  accountEquity: string,
  riskPct: number,
  entryPrice: string,
  stopLoss: string
): string {
  const equity = new Decimal(accountEquity);
  const riskAmount = equity.mul(riskPct);
  const priceDiff = new Decimal(entryPrice).minus(new Decimal(stopLoss)).abs();
  if (priceDiff.isZero()) return "0";
  return riskAmount.div(priceDiff).toFixed(8);
}

export function calcPnl(
  side: "LONG" | "SHORT",
  entryPrice: string,
  exitPrice: string,
  size: string
): string {
  const entry = new Decimal(entryPrice);
  const exit = new Decimal(exitPrice);
  const qty = new Decimal(size);
  const direction = side === "LONG" ? 1 : -1;
  return exit.minus(entry).mul(qty).mul(direction).toFixed(8);
}

export function calcFee(size: string, price: string, feePct: number): string {
  return new Decimal(size).mul(new Decimal(price)).mul(feePct).toFixed(8);
}

export function calcSharpe(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return ((avg - riskFreeRate) / stdDev) * Math.sqrt(365);
}

export function calcSortino(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const negReturns = returns.filter((r) => r < riskFreeRate);
  if (negReturns.length === 0) return Infinity;
  const downVar =
    negReturns.reduce((sum, r) => sum + Math.pow(r - riskFreeRate, 2), 0) /
    negReturns.length;
  const downDev = Math.sqrt(downVar);
  if (downDev === 0) return 0;
  return ((avg - riskFreeRate) / downDev) * Math.sqrt(365);
}

export function generateClientOrderId(symbol: string, side: string): string {
  const ts = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, "").slice(0, 8);
  return `ltbot_${symbol.toLowerCase()}_${side.toLowerCase()}_${ts}_${rand}`;
}

export function generateTradeId(): string {
  return `trade_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60000,
    "5m": 300000,
    "15m": 900000,
    "30m": 1800000,
    "1h": 3600000,
    "4h": 14400000,
    "1d": 86400000,
  };
  return map[interval] ?? 60000;
}
