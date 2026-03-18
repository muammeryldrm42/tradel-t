/**
 * PaperTradingAdapter
 * 
 * Simulates order execution with realistic:
 * - Slippage modeling
 * - Fee calculation (maker/taker)
 * - Partial fill simulation
 * - Latency simulation
 * - Funding fee accumulation
 * 
 * This adapter is the DEFAULT when live trading is disabled.
 * It maintains an in-memory simulated portfolio.
 */

import { Decimal } from "decimal.js";
import { randomUUID } from "crypto";
import type {
  Symbol,
  Order,
  Position,
  OrderRequest,
  OrderResult,
  SimulatedTrade,
  TradingSignal,
  RiskAssessment,
  Ticker,
} from "@lighter-bot/common";
import {
  calcPnl,
  calcFee,
  calcLiquidationPrice,
  generateTradeId,
} from "@lighter-bot/common";
import { SYMBOL_CONTRACT_SPECS } from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { sleep } from "@lighter-bot/common";

const log = createChildLogger({ module: "paper-adapter" });

export interface PaperAdapterConfig {
  initialBalance: string;
  makerFeePct: number;
  takerFeePct: number;
  baseSlippageBps: number;
  latencyMs: number;
  simulatePartialFills: boolean;
}

const DEFAULT_CONFIG: PaperAdapterConfig = {
  initialBalance: "10000",
  makerFeePct: 0.0002,  // 2bps maker
  takerFeePct: 0.0005,  // 5bps taker
  baseSlippageBps: 5,
  latencyMs: 150,
  simulatePartialFills: false,
};

export class PaperTradingAdapter {
  private readonly config: PaperAdapterConfig;
  private balance: Decimal;
  private openPositions: Map<string, SimulatedPosition>;
  private orders: Map<string, Order>;
  private trades: SimulatedTrade[];
  private realizedPnl: Decimal;
  private totalFeePaid: Decimal;
  private totalFundingPaid: Decimal;

  constructor(config?: Partial<PaperAdapterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.balance = new Decimal(this.config.initialBalance);
    this.openPositions = new Map();
    this.orders = new Map();
    this.trades = [];
    this.realizedPnl = new Decimal(0);
    this.totalFeePaid = new Decimal(0);
    this.totalFundingPaid = new Decimal(0);

    log.info(
      { mode: "PAPER", initialBalance: this.config.initialBalance },
      "PaperTradingAdapter initialized — simulation mode active"
    );
  }

  // ─── Order Placement ──────────────────────────────────────────────────────

  async placeOrder(
    req: OrderRequest,
    currentTicker: Ticker,
    signal: TradingSignal,
    riskAssessment: RiskAssessment
  ): Promise<OrderResult> {
    // Simulate network latency
    await sleep(this.config.latencyMs + Math.random() * 50);

    const startTime = Date.now();

    // Apply slippage to get simulated fill price
    const fillPrice = this.simulateSlippage(
      parseFloat(currentTicker.lastPrice),
      req.side,
      req.type
    );

    // Calculate fee
    const isPostOnly = req.postOnly ?? req.type === "LIMIT";
    const feePct = isPostOnly ? this.config.makerFeePct : this.config.takerFeePct;
    const notional = new Decimal(req.size).mul(fillPrice);
    const fee = notional.mul(feePct);

    // Check available balance
    const leverage = riskAssessment.adjustedLeverage ?? 3;
    const requiredMargin = notional.div(leverage).plus(fee);

    if (requiredMargin.gt(this.balance)) {
      log.warn(
        { required: requiredMargin.toFixed(2), available: this.balance.toFixed(2) },
        "Paper trade rejected: insufficient margin"
      );
      return {
        success: false,
        error: "Insufficient margin for paper trade",
        simulated: true,
        mode: "PAPER",
      };
    }

    // Create the simulated order
    const orderId = `paper_${randomUUID().slice(0, 12)}`;
    const order: Order = {
      id: orderId,
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      timeInForce: req.timeInForce ?? "GTC",
      price: req.price ?? fillPrice.toFixed(8),
      size: req.size,
      filledSize: req.size,
      remainingSize: "0",
      avgFillPrice: fillPrice.toFixed(8),
      status: "FILLED",
      reduceOnly: req.reduceOnly ?? false,
      postOnly: req.postOnly ?? false,
      createdAt: startTime,
      updatedAt: Date.now(),
      fee: fee.toFixed(8),
      feeCurrency: "USDC",
    };

    this.orders.set(orderId, order);

    // Deduct fee
    this.balance = this.balance.minus(fee);
    this.totalFeePaid = this.totalFeePaid.plus(fee);

    // Open or close position
    if (req.reduceOnly) {
      await this.closePosition(req, fillPrice, fee, signal);
    } else {
      this.openPosition(req, fillPrice, fee, signal, riskAssessment, leverage);
    }

    log.info(
      {
        orderId,
        symbol: req.symbol,
        side: req.side,
        size: req.size,
        fillPrice: fillPrice.toFixed(2),
        fee: fee.toFixed(4),
        latencyMs: Date.now() - startTime,
      },
      "Paper order filled"
    );

    return {
      success: true,
      order,
      simulated: true,
      mode: "PAPER",
      latencyMs: Date.now() - startTime,
    };
  }

  async closePosition(
    req: OrderRequest,
    fillPrice: Decimal,
    fee: Decimal,
    signal: TradingSignal
  ): Promise<void> {
    const posKey = `${req.symbol}_${req.side === "SELL" ? "LONG" : "SHORT"}`;
    const position = this.openPositions.get(posKey);

    if (!position) {
      log.warn({ posKey }, "Close order: no matching paper position found");
      return;
    }

    const exitSide = req.side === "SELL" ? "LONG" : "SHORT";
    const pnl = new Decimal(
      calcPnl(
        exitSide,
        position.entryPrice.toString(),
        fillPrice.toString(),
        req.size
      )
    );

    // Return margin + PnL - exit fee
    const returnedMargin = position.margin.plus(pnl).minus(fee);
    this.balance = this.balance.plus(returnedMargin);
    this.realizedPnl = this.realizedPnl.plus(pnl);

    // Complete the trade record
    const trade = this.trades.find((t) => t.id === position.tradeId);
    if (trade) {
      trade.exitPrice = fillPrice.toFixed(8);
      trade.exitFee = fee.toFixed(8);
      trade.realizedPnl = pnl.toFixed(8);
      trade.exitTime = Date.now();
      trade.holdDurationMs = trade.exitTime - trade.entryTime;
      trade.isOpen = false;
      trade.exitReason = signal.rationale;
      trade.lifecycleEvents.push({
        tradeId: trade.id,
        phase: "ORDER_FILLED",
        symbol: req.symbol,
        timestamp: Date.now(),
        data: { exitPrice: fillPrice.toFixed(8), pnl: pnl.toFixed(8) },
      });
    }

    this.openPositions.delete(posKey);
    log.info({ posKey, pnl: pnl.toFixed(4), balance: this.balance.toFixed(2) }, "Paper position closed");
  }

  private openPosition(
    req: OrderRequest,
    fillPrice: Decimal,
    fee: Decimal,
    signal: TradingSignal,
    riskAssessment: RiskAssessment,
    leverage: number
  ): void {
    const side = req.side === "BUY" ? "LONG" : "SHORT";
    const contractSpec = SYMBOL_CONTRACT_SPECS[req.symbol];
    const notional = new Decimal(req.size).mul(fillPrice);
    const margin = notional.div(leverage);

    this.balance = this.balance.minus(margin);

    const liqPrice = calcLiquidationPrice(
      fillPrice.toString(),
      leverage,
      side,
      contractSpec.maintenanceMarginRate
    );

    const posKey = `${req.symbol}_${side}`;
    const positionId = `pos_${randomUUID().slice(0, 12)}`;
    const tradeId = generateTradeId();

    this.openPositions.set(posKey, {
      id: positionId,
      tradeId,
      symbol: req.symbol,
      side,
      size: new Decimal(req.size),
      entryPrice: fillPrice,
      liquidationPrice: new Decimal(liqPrice),
      leverage,
      margin,
      entryFee: fee,
      openedAt: Date.now(),
    });

    const trade: SimulatedTrade = {
      id: tradeId,
      symbol: req.symbol,
      side,
      entryPrice: fillPrice.toFixed(8),
      size: req.size,
      leverage,
      entryFee: fee.toFixed(8),
      exitFee: "0",
      fundingFees: "0",
      entryTime: Date.now(),
      signal,
      riskAssessment,
      isOpen: true,
      lifecycleEvents: [
        {
          tradeId,
          phase: "POSITION_OPEN",
          symbol: req.symbol,
          timestamp: Date.now(),
          data: {
            entryPrice: fillPrice.toFixed(8),
            size: req.size,
            leverage,
            liquidationPrice: liqPrice,
          },
        },
      ],
    };

    this.trades.push(trade);
    log.info({ posKey, entryPrice: fillPrice.toFixed(2), leverage, liqPrice }, "Paper position opened");
  }

  // ─── Funding Fee Simulation ────────────────────────────────────────────────

  applyFunding(symbol: Symbol, fundingRate: number, ticker: Ticker): void {
    for (const [, position] of this.openPositions) {
      if (position.symbol !== symbol) continue;
      const notional = position.size.mul(parseFloat(ticker.markPrice));
      const fundingAmount = notional.mul(fundingRate);
      // Long pays positive funding, short pays negative
      const cost = position.side === "LONG" ? fundingAmount : fundingAmount.negated();
      this.balance = this.balance.minus(cost);
      this.totalFundingPaid = this.totalFundingPaid.plus(cost);

      const trade = this.trades.find((t) => t.id === position.tradeId);
      if (trade) {
        trade.fundingFees = new Decimal(trade.fundingFees).plus(cost).toFixed(8);
      }
    }
  }

  // ─── Mark-to-Market ────────────────────────────────────────────────────────

  markToMarket(tickers: Record<Symbol, Ticker>): void {
    for (const [, position] of this.openPositions) {
      const ticker = tickers[position.symbol];
      if (!ticker) continue;

      const markPrice = parseFloat(ticker.markPrice);
      const unrealizedPnl = new Decimal(
        calcPnl(
          position.side,
          position.entryPrice.toString(),
          markPrice.toString(),
          position.size.toString()
        )
      );

      // Check liquidation
      const liqPrice = position.liquidationPrice.toNumber();
      const isLiquidated =
        position.side === "LONG" ? markPrice <= liqPrice : markPrice >= liqPrice;

      if (isLiquidated) {
        log.warn(
          { symbol: position.symbol, side: position.side, markPrice, liqPrice },
          "SIMULATED LIQUIDATION — position liquidated"
        );
        this.openPositions.delete(`${position.symbol}_${position.side}`);
        const trade = this.trades.find((t) => t.id === position.tradeId);
        if (trade) {
          trade.exitPrice = liqPrice.toFixed(8);
          trade.realizedPnl = position.margin.negated().toFixed(8);
          trade.exitTime = Date.now();
          trade.isOpen = false;
          trade.exitReason = "LIQUIDATED";
          trade.lifecycleEvents.push({
            tradeId: trade.id,
            phase: "LIQUIDATED",
            symbol: position.symbol,
            timestamp: Date.now(),
            data: { markPrice, liqPrice },
          });
        }
      }

      const trade = this.trades.find((t) => t.id === position.tradeId);
      if (trade && trade.isOpen) {
        trade.unrealizedPnl = unrealizedPnl.toFixed(8);
      }
    }
  }

  // ─── Slippage Model ───────────────────────────────────────────────────────

  private simulateSlippage(
    price: number,
    side: "BUY" | "SELL",
    orderType: string
  ): Decimal {
    if (orderType === "LIMIT") return new Decimal(price); // limit = no slippage

    const slippageBps = this.config.baseSlippageBps * (0.8 + Math.random() * 0.4);
    const slippage = (slippageBps / 10000) * price;
    return new Decimal(side === "BUY" ? price + slippage : price - slippage);
  }

  // ─── State Queries ─────────────────────────────────────────────────────────

  getBalance(): string {
    return this.balance.toFixed(2);
  }

  getOpenPositions(): Position[] {
    return Array.from(this.openPositions.values()).map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      size: p.size.toString(),
      entryPrice: p.entryPrice.toString(),
      markPrice: p.entryPrice.toString(),
      liquidationPrice: p.liquidationPrice.toString(),
      unrealizedPnl: "0",
      realizedPnl: "0",
      leverage: p.leverage,
      margin: p.margin.toString(),
      marginType: "ISOLATED" as const,
      fundingFee: "0",
      openedAt: p.openedAt,
      updatedAt: p.openedAt,
      isOpen: true,
    }));
  }

  getTrades(): SimulatedTrade[] {
    return [...this.trades];
  }

  getSummary() {
    const closedTrades = this.trades.filter((t) => !t.isOpen);
    return {
      balance: this.balance.toFixed(2),
      realizedPnl: this.realizedPnl.toFixed(2),
      totalFeePaid: this.totalFeePaid.toFixed(2),
      totalFundingPaid: this.totalFundingPaid.toFixed(2),
      totalTrades: closedTrades.length,
      openPositions: this.openPositions.size,
    };
  }

  reset(): void {
    this.balance = new Decimal(this.config.initialBalance);
    this.openPositions.clear();
    this.orders.clear();
    this.trades = [];
    this.realizedPnl = new Decimal(0);
    this.totalFeePaid = new Decimal(0);
    this.totalFundingPaid = new Decimal(0);
    log.info("Paper trading state reset");
  }
}

interface SimulatedPosition {
  id: string;
  tradeId: string;
  symbol: Symbol;
  side: "LONG" | "SHORT";
  size: Decimal;
  entryPrice: Decimal;
  liquidationPrice: Decimal;
  leverage: number;
  margin: Decimal;
  entryFee: Decimal;
  openedAt: number;
}
