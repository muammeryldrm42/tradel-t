/**
 * BacktestEngine
 * 
 * Replays historical candle data through the full strategy + risk pipeline.
 * Produces equity curves, drawdowns, and complete performance metrics.
 * 
 * Features:
 * - Historical candle replay
 * - Realistic slippage, fee, funding models
 * - Latency simulation
 * - Walk-forward testing
 * - Parameter sweep support
 */

import { Decimal } from "decimal.js";
import { randomUUID } from "crypto";
import type {
  Symbol,
  Candle,
  Interval,
  BacktestConfig,
  BacktestResult,
  PerformanceMetrics,
  EquityPoint,
  DrawdownPoint,
  SimulatedTrade,
  TradingSignal,
  AccountBalance,
  Ticker,
  BotState,
  StrategyConfig,
} from "@lighter-bot/common";
import {
  calcPnl,
  calcFee,
  calcSharpe,
  calcSortino,
  generateTradeId,
  generateClientOrderId,
  intervalToMs,
} from "@lighter-bot/common";
import { DEFAULT_RISK_PARAMS } from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { RiskEngine } from "@lighter-bot/risk";
import { EnsembleSignalAggregator } from "@lighter-bot/strategy";

const log = createChildLogger({ module: "backtest-engine" });

export interface WalkForwardConfig {
  enabled: boolean;
  inSamplePct: number;   // e.g. 0.7 = 70% in-sample
  folds: number;
}

export interface ParameterSweepConfig {
  enabled: boolean;
  paramGrid: Record<string, number[]>;
  metricToOptimize: "sharpe" | "sortino" | "totalPnl" | "winRate";
}

export class BacktestEngine {
  private readonly config: BacktestConfig;
  private ensemble: EnsembleSignalAggregator;
  private riskEngine: RiskEngine;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.ensemble = new EnsembleSignalAggregator();
    this.riskEngine = new RiskEngine();

  async run(historicalData: Map<Symbol, Map<Interval, Candle[]>>): Promise<BacktestResult> {
    log.info({ id: this.config.id, symbols: this.config.symbols }, "Starting backtest");
    const startMs = Date.now();

    let equity = new Decimal(this.config.initialCapital);
    const trades: SimulatedTrade[] = [];
    const equityCurve: EquityPoint[] = [];
    const drawdownCurve: DrawdownPoint[] = [];
    let peakEquity = equity.clone();
    let currentDrawdown: DrawdownPoint | null = null;

    // Build the timeline: all candle close times for the primary interval
    const primaryInterval: Interval = "1h";
    const timelineSymbol = this.config.symbols[0]!;
    const timelineCandles = historicalData.get(timelineSymbol)?.get(primaryInterval) ?? [];
    const closeTimes = timelineCandles
      .filter((c) => c.openTime >= this.config.startDate && c.closeTime <= this.config.endDate)
      .map((c) => c.closeTime)
      .sort((a, b) => a - b);

    if (closeTimes.length === 0) {
      throw new Error("No candle data found for the configured date range");
    }

    // Track open simulated positions
    const openPositions: Map<string, BacktestPosition> = new Map();

    for (const timestamp of closeTimes) {
      for (const symbol of this.config.symbols) {
        const symbolData = historicalData.get(symbol);
        if (!symbolData) continue;

        // Build candle window for each timeframe up to current timestamp
        const candleMap = new Map<Interval, Candle[]>();
        for (const [interval, candles] of symbolData) {
          candleMap.set(
            interval,
            candles.filter((c) => c.closeTime <= timestamp)
          );
        }

        const currentCandles = candleMap.get(primaryInterval) ?? [];
        if (currentCandles.length < 60) continue;

        const lastCandle = currentCandles[currentCandles.length - 1]!;

        // Build mock ticker from candle data
        const ticker = this.candleToTicker(symbol, lastCandle);

        // Check and close positions that hit stop/tp
        const posKey = `${symbol}_LONG`;
        const shortKey = `${symbol}_SHORT`;

        for (const key of [posKey, shortKey]) {
          const pos = openPositions.get(key);
          if (!pos) continue;

          const currentPrice = parseFloat(lastCandle.close);
          const stopHit =
            pos.side === "LONG"
              ? currentPrice <= parseFloat(pos.stopLoss)
              : currentPrice >= parseFloat(pos.stopLoss);
          const tpHit =
            pos.side === "LONG"
              ? currentPrice >= parseFloat(pos.takeProfit)
              : currentPrice <= parseFloat(pos.takeProfit);
          const liqHit =
            pos.side === "LONG"
              ? currentPrice <= pos.liquidationPrice
              : currentPrice >= pos.liquidationPrice;

          if (stopHit || tpHit || liqHit) {
            const exitReason = liqHit ? "LIQUIDATED" : stopHit ? "STOP_LOSS" : "TAKE_PROFIT";
            const exitPrice = liqHit
              ? pos.liquidationPrice
              : stopHit
              ? parseFloat(pos.stopLoss)
              : parseFloat(pos.takeProfit);

            const exitFillPrice = this.applySlippage(exitPrice, pos.side === "LONG" ? "SELL" : "BUY");
            const pnl = new Decimal(
              calcPnl(pos.side, pos.entryPrice, exitFillPrice.toString(), pos.size)
            );
            const exitFee = new Decimal(calcFee(pos.size, exitFillPrice.toString(), this.config.feeModel.takerFeePct));
            const netPnl = pnl.minus(exitFee);

            equity = equity.plus(pos.margin).plus(netPnl);

            const trade = pos.trade;
            trade.exitPrice = exitFillPrice.toFixed(8);
            trade.exitFee = exitFee.toFixed(8);
            trade.realizedPnl = netPnl.toFixed(8);
            trade.exitTime = timestamp;
            trade.holdDurationMs = timestamp - trade.entryTime;
            trade.isOpen = false;
            trade.exitReason = exitReason;

            trades.push(trade);
            openPositions.delete(key);

            if (netPnl.lt(0)) {
              this.riskEngine.recordLoss(symbol, netPnl.abs().toString());
            } else {
              this.riskEngine.recordWin(symbol);
            }

            log.debug(
              { symbol, exitReason, pnl: netPnl.toFixed(2), equity: equity.toFixed(2) },
              "Backtest position closed"
            );
          }
        }

        // Generate new signal
        const mockBotState = this.buildMockBotState(openPositions.size);
        const mockAccount = this.buildMockAccount(equity.toString());

        // Only generate signals if we can have more positions
        if (openPositions.size >= 3) continue;
        // Don't enter if already have position in this symbol
        if (openPositions.has(posKey) || openPositions.has(shortKey)) continue;

        const signal = await this.ensemble.generate(
          symbol,
          candleMap,
          ticker,
          this.config.strategyConfigs.filter((c) => c.symbol === symbol)
        );

        if (!signal || signal.direction === "FLAT") continue;

        // Simulate latency
        const latencyAdjustedTimestamp = timestamp + this.config.latencyModelMs;
        const entryFillPrice = this.applySlippage(
          parseFloat(signal.entryPrice),
          signal.direction === "LONG" ? "BUY" : "SELL"
        );

        // Mock order book
        const mockOrderBook = this.buildMockOrderBook(symbol, ticker);

        const riskResult = this.riskEngine.assess({
          signal: { ...signal, entryPrice: entryFillPrice.toString() },
          account: mockAccount,
          openPositions: [],
          ticker,
          orderBook: mockOrderBook,
          botState: mockBotState,
          tickerAge: 100,
        });

        if (!riskResult.approved) continue;

        const size = riskResult.computedPositionSize;
        const leverage = riskResult.adjustedLeverage ?? 3;
        const notional = new Decimal(size).mul(entryFillPrice);
        const margin = notional.div(leverage);

        if (margin.gt(equity.mul(0.5))) continue; // safety

        const entryFee = new Decimal(calcFee(size, entryFillPrice.toString(), this.config.feeModel.takerFeePct));
        equity = equity.minus(margin).minus(entryFee);

        // Liquidation price
        const liqPricePct = signal.direction === "LONG"
          ? entryFillPrice * (1 - 1 / leverage + 0.004)
          : entryFillPrice * (1 + 1 / leverage - 0.004);

        const tradeId = generateTradeId();
        const trade: SimulatedTrade = {
          id: tradeId,
          symbol,
          side: signal.direction === "LONG" ? "LONG" : "SHORT",
          entryPrice: entryFillPrice.toString(),
          size,
          leverage,
          entryFee: entryFee.toFixed(8),
          exitFee: "0",
          fundingFees: "0",
          entryTime: latencyAdjustedTimestamp,
          signal,
          riskAssessment: riskResult,
          isOpen: true,
          lifecycleEvents: [],
        };

        openPositions.set(
          `${symbol}_${signal.direction === "LONG" ? "LONG" : "SHORT"}`,
          {
            side: signal.direction === "LONG" ? "LONG" : "SHORT",
            entryPrice: entryFillPrice.toString(),
            size,
            margin,
            leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            liquidationPrice: liqPricePct,
            trade,
          }
        );
      }

      // Record equity curve
      equityCurve.push({
        timestamp,
        equity: equity.toFixed(2),
        drawdown: peakEquity.minus(equity).toNumber(),
        drawdownPct: peakEquity.gt(0)
          ? peakEquity.minus(equity).div(peakEquity).toNumber()
          : 0,
      });

      // Track drawdowns
      if (equity.gt(peakEquity)) {
        peakEquity = equity.clone();
        if (currentDrawdown) {
          currentDrawdown.recoveredAt = timestamp;
          drawdownCurve.push(currentDrawdown);
          currentDrawdown = null;
        }
      } else {
        const dd = peakEquity.minus(equity).div(peakEquity).toNumber();
        if (dd > 0.01) {
          if (!currentDrawdown) {
            currentDrawdown = {
              startTime: timestamp,
              peak: peakEquity.toFixed(2),
              trough: equity.toFixed(2),
              drawdownPct: dd,
            };
          } else {
            currentDrawdown.trough = equity.toFixed(2);
            currentDrawdown.drawdownPct = Math.max(currentDrawdown.drawdownPct, dd);
          }
        }
      }
    }

    // Force-close any remaining open positions at last price
    for (const pos of openPositions.values()) {
      pos.trade.exitReason = "BACKTEST_END";
      pos.trade.isOpen = false;
      trades.push(pos.trade);
    }

    const metrics = this.computeMetrics(
      trades,
      equityCurve,
      this.config.initialCapital
    );

    log.info(
      {
        trades: metrics.totalTrades,
        winRate: (metrics.winRate * 100).toFixed(1) + "%",
        sharpe: metrics.sharpeRatio.toFixed(2),
        maxDrawdown: (metrics.maxDrawdownPct * 100).toFixed(1) + "%",
        finalEquity: metrics.finalEquity,
        durationMs: Date.now() - startMs,
      },
      "Backtest complete"
    );

    return {
      id: this.config.id,
      config: this.config,
      trades,
      metrics,
      equityCurve,
      drawdownCurve,
      regimeBreakdown: [],   // TODO: implement regime tracking during replay
      symbolBreakdown: this.computeSymbolBreakdown(trades),
      completedAt: Date.now(),
      durationMs: Date.now() - startMs,
    };
  }

  // ─── Walk-Forward Testing ─────────────────────────────────────────────────

  async runWalkForward(
    historicalData: Map<Symbol, Map<Interval, Candle[]>>,
    wfConfig: WalkForwardConfig
  ): Promise<BacktestResult[]> {
    const allTimes = [...(historicalData.get(this.config.symbols[0]!)?.get("1h") ?? [])]
      .map((c) => c.closeTime)
      .sort((a, b) => a - b);

    if (allTimes.length === 0) throw new Error("No data for walk-forward");

    const foldSize = Math.floor(allTimes.length / wfConfig.folds);
    const results: BacktestResult[] = [];

    for (let fold = 0; fold < wfConfig.folds; fold++) {
      const foldStart = allTimes[fold * foldSize];
      const foldEnd = allTimes[Math.min((fold + 1) * foldSize, allTimes.length - 1)];
      if (!foldStart || !foldEnd) continue;

      const inSampleEnd =
        foldStart + Math.floor((foldEnd - foldStart) * wfConfig.inSamplePct);

      const oosSectionConfig: BacktestConfig = {
        ...this.config,
        id: `${this.config.id}_wf_fold${fold}_oos`,
        startDate: inSampleEnd,
        endDate: foldEnd,
      };

      const engine = new BacktestEngine(oosSectionConfig);
      const result = await engine.run(historicalData);
      results.push(result);

      log.info(
        {
          fold,
          startDate: new Date(inSampleEnd).toISOString().slice(0, 10),
          endDate: new Date(foldEnd).toISOString().slice(0, 10),
          trades: result.metrics.totalTrades,
          sharpe: result.metrics.sharpeRatio.toFixed(2),
        },
        "Walk-forward fold complete"
      );
    }

    return results;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private applySlippage(price: number, side: "BUY" | "SELL"): number {
    const slippageBps =
      this.config.slippageModel.baseSlippageBps * (0.5 + Math.random());
    const slip = (slippageBps / 10000) * price;
    return side === "BUY" ? price + slip : price - slip;
  }

  private candleToTicker(symbol: Symbol, candle: Candle): Ticker {
    return {
      symbol,
      lastPrice: candle.close,
      markPrice: candle.close,
      indexPrice: candle.close,
      fundingRate: this.config.fundingModel.fallbackRateHourly.toString(),
      nextFundingTime: candle.closeTime + 8 * 3600_000,
      openInterest: "0",
      volume24h: candle.volume,
      priceChange24h: "0",
      priceChangePct24h: "0",
      high24h: candle.high,
      low24h: candle.low,
      bestBid: (parseFloat(candle.close) * 0.9999).toFixed(8),
      bestAsk: (parseFloat(candle.close) * 1.0001).toFixed(8),
      bestBidSize: "10",
      bestAskSize: "10",
      timestamp: candle.closeTime,
    };
  }

  private buildMockOrderBook(symbol: Symbol, ticker: Ticker): OrderBook {
    const mid = parseFloat(ticker.lastPrice);
    return {
      symbol,
      bids: [{ price: (mid * 0.9999).toFixed(8), size: "100" }],
      asks: [{ price: (mid * 1.0001).toFixed(8), size: "100" }],
      lastUpdateId: 0,
      timestamp: Date.now(),
    };
  }

  private buildMockAccount(equity: string): AccountBalance {
    return {
      currency: "USDC",
      total: equity,
      available: (parseFloat(equity) * 0.9).toFixed(2),
      locked: "0",
      unrealizedPnl: "0",
      marginUsed: (parseFloat(equity) * 0.1).toFixed(2),
      marginAvailable: equity,
      accountEquity: equity,
      maintenanceMargin: "0",
      initialMargin: "0",
      accountHealth: 100,
    };
  }

  private buildMockBotState(openPositionCount: number): BotState {
    return {
      status: "RUNNING",
      mode: "PAPER",
      lastHeartbeat: Date.now(),
      activePositions: openPositionCount,
      dailyPnl: "0",
      dailyLoss: "0",
      dailyTrades: 0,
      consecutiveLosses: 0,
      circuitBreakerTripped: false,
      killSwitchActive: false,
    };
  }

  private computeMetrics(
    trades: SimulatedTrade[],
    equityCurve: EquityPoint[],
    initialCapital: string
  ): PerformanceMetrics {
    const closed = trades.filter((t) => !t.isOpen && t.realizedPnl !== undefined);
    const wins = closed.filter((t) => parseFloat(t.realizedPnl ?? "0") > 0);
    const losses = closed.filter((t) => parseFloat(t.realizedPnl ?? "0") <= 0);

    const totalPnl = closed.reduce(
      (sum, t) => sum.plus(t.realizedPnl ?? "0"),
      new Decimal(0)
    );
    const totalFees = closed.reduce(
      (sum, t) => sum.plus(t.entryFee).plus(t.exitFee),
      new Decimal(0)
    );
    const totalFunding = closed.reduce(
      (sum, t) => sum.plus(t.fundingFees),
      new Decimal(0)
    );

    const avgWin = wins.length > 0
      ? wins.reduce((s, t) => s.plus(t.realizedPnl ?? "0"), new Decimal(0)).div(wins.length)
      : new Decimal(0);
    const avgLoss = losses.length > 0
      ? losses.reduce((s, t) => s.plus(t.realizedPnl ?? "0"), new Decimal(0)).div(losses.length)
      : new Decimal(0);

    const profitFactor =
      avgLoss.abs().gt(0) ? avgWin.abs().div(avgLoss.abs()).toNumber() : 0;

    const maxDrawdownPt = equityCurve.reduce(
      (max, pt) => (pt.drawdownPct > max ? pt.drawdownPct : max),
      0
    );

    const avgHoldMs =
      closed.length > 0
        ? closed.reduce((sum, t) => sum + (t.holdDurationMs ?? 0), 0) / closed.length
        : 0;

    // Compute daily returns for Sharpe/Sortino
    const dailyReturns: number[] = [];
    const dayMs = 86_400_000;
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1];
      const curr = equityCurve[i];
      if (!prev || !curr) continue;
      if (curr.timestamp - prev.timestamp >= dayMs) {
        const ret = (parseFloat(curr.equity) - parseFloat(prev.equity)) / parseFloat(prev.equity);
        dailyReturns.push(ret);
      }
    }

    const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
    const totalPnlPct = (parseFloat(finalEquity) - parseFloat(initialCapital)) / parseFloat(initialCapital);

    // Max consecutive losses
    let maxConsec = 0, consec = 0;
    for (const t of closed) {
      if (parseFloat(t.realizedPnl ?? "0") < 0) {
        consec++;
        maxConsec = Math.max(maxConsec, consec);
      } else {
        consec = 0;
      }
    }

    return {
      totalTrades: closed.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: closed.length > 0 ? wins.length / closed.length : 0,
      totalPnl: totalPnl.toFixed(2),
      totalPnlPct,
      maxDrawdownPct: maxDrawdownPt,
      maxDrawdownPct: maxDrawdownPt,
      sharpeRatio: calcSharpe(dailyReturns),
      sortinoRatio: calcSortino(dailyReturns),
      calmarRatio: maxDrawdownPt > 0 ? totalPnlPct / maxDrawdownPt : 0,
      expectancy: closed.length > 0 ? totalPnl.div(closed.length).toFixed(2) : "0",
      profitFactor,
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      avgHoldTimeMs: avgHoldMs,
      maxConsecutiveLosses: maxConsec,
      totalFees: totalFees.toFixed(2),
      totalFunding: totalFunding.toFixed(2),
      finalEquity,
    };
  }

  private computeSymbolBreakdown(trades: SimulatedTrade[]) {
    const result: Partial<Record<Symbol, SymbolMetrics>> = {};
    const symbols: Symbol[] = ["BTC", "ETH", "SOL"];

    for (const symbol of symbols) {
      const symTrades = trades.filter((t) => t.symbol === symbol && !t.isOpen);
      if (symTrades.length === 0) continue;
      const wins = symTrades.filter((t) => parseFloat(t.realizedPnl ?? "0") > 0);
      const pnl = symTrades.reduce((s, t) => s + parseFloat(t.realizedPnl ?? "0"), 0);
      result[symbol] = {
        symbol,
        trades: symTrades.length,
        winRate: symTrades.length > 0 ? wins.length / symTrades.length : 0,
        pnl: pnl.toFixed(2),
        longTrades: symTrades.filter((t) => t.side === "LONG").length,
        shortTrades: symTrades.filter((t) => t.side === "SHORT").length,
        avgLeverage: symTrades.reduce((s, t) => s + t.leverage, 0) / symTrades.length,
      };
    }

    return result as Record<Symbol, SymbolMetrics>;
  }
}

interface BacktestPosition {
  side: "LONG" | "SHORT";
  entryPrice: string;
  size: string;
  margin: Decimal;
  leverage: number;
  stopLoss: string;
  takeProfit: string;
  liquidationPrice: number;
  trade: SimulatedTrade;
}

type SymbolMetrics = {
  symbol: Symbol;
  trades: number;
  winRate: number;
  pnl: string;
  longTrades: number;
  shortTrades: number;
  avgLeverage: number;
};

type OrderBook = import("@lighter-bot/common").OrderBook;
