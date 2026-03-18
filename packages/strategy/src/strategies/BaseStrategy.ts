/**
 * Base strategy interface - all strategies implement this contract.
 */

import { randomUUID } from "crypto";
import type {
  Symbol,
  Candle,
  Ticker,
  TradingSignal,
  SignalDirection,
  StrategyConfig,
  Interval,
} from "@lighter-bot/common";

export interface StrategyInput {
  symbol: Symbol;
  candles: Map<Interval, Candle[]>;
  ticker: Ticker;
  config: StrategyConfig;
}

export interface StrategyOutput {
  direction: SignalDirection;
  confidence: number;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  riskRewardRatio: number;
  rationale: string;
  invalidationCondition: string;
  tags: string[];
}

export interface IStrategy {
  readonly name: string;
  readonly type: string;
  generate(input: StrategyInput): Promise<StrategyOutput | null>;
}

// ─── Base Strategy ────────────────────────────────────────────────────────────

export abstract class BaseStrategy implements IStrategy {
  abstract readonly name: string;
  abstract readonly type: string;

  abstract generate(input: StrategyInput): Promise<StrategyOutput | null>;

  protected buildSignal(
    input: StrategyInput,
    output: StrategyOutput
  ): TradingSignal {
    const now = Date.now();
    const signalAgeMs = 5 * 60 * 1000; // 5 min TTL

    return {
      id: randomUUID(),
      symbol: input.symbol,
      direction: output.direction,
      confidence: Math.max(0, Math.min(1, output.confidence)),
      entryPrice: output.entryPrice,
      stopLoss: output.stopLoss,
      takeProfit: output.takeProfit,
      riskRewardRatio: output.riskRewardRatio,
      strategyName: this.name,
      rationale: output.rationale,
      invalidationCondition: output.invalidationCondition,
      timeframe: input.config.timeframes[0] ?? "1h",
      generatedAt: now,
      expiresAt: now + signalAgeMs,
      tags: output.tags,
    };
  }

  protected extractClosePrices(candles: Candle[]): number[] {
    return candles.map((c) => parseFloat(c.close));
  }

  protected extractHighPrices(candles: Candle[]): number[] {
    return candles.map((c) => parseFloat(c.high));
  }

  protected extractLowPrices(candles: Candle[]): number[] {
    return candles.map((c) => parseFloat(c.low));
  }

  protected extractVolumes(candles: Candle[]): number[] {
    return candles.map((c) => parseFloat(c.volume));
  }
}
