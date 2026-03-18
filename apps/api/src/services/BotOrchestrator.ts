/**
 * BotOrchestrator
 * 
 * Central coordination layer that:
 * 1. Subscribes to market data
 * 2. Runs the signal generation loop
 * 3. Routes signals through the risk engine
 * 4. Dispatches approved trades to execution adapters
 * 5. Manages position lifecycle
 * 6. Monitors bot health
 */

import type {
  Symbol,
  Candle,
  Ticker,
  Interval,
  BotState,
  AccountBalance,
  Position,
  OrderRequest,
  EnsembleSignal,
  ExecutionContext,
} from "@lighter-bot/common";
import {
  SUPPORTED_SYMBOLS,
  loadAppConfig,
  generateClientOrderId,
} from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { sleep } from "@lighter-bot/common";
import { DEFAULT_RISK_PARAMS } from "@lighter-bot/common";
import { RiskEngine } from "@lighter-bot/risk";
import { EnsembleSignalAggregator } from "@lighter-bot/strategy";
import { PaperTradingAdapter } from "@lighter-bot/execution";

import { LighterClient } from "../lighter/LighterClient.js";
import { LighterWebSocketFeed } from "../lighter/LighterWebSocketFeed.js";

const log = createChildLogger({ module: "orchestrator" });

export class BotOrchestrator {
  private readonly config = loadAppConfig();
  private readonly client: LighterClient;
  private readonly wsFeed: LighterWebSocketFeed;
  private readonly riskEngine: RiskEngine;
  private readonly ensemble: EnsembleSignalAggregator;
  private readonly paperAdapter: PaperTradingAdapter;

  private botState: BotState;
  private tickers: Partial<Record<Symbol, Ticker>>;
  private tickerTimestamps: Partial<Record<Symbol, number>>;
  private candleCache: Map<Symbol, Map<Interval, Candle[]>>;
  private signalLoopTimer: ReturnType<typeof setInterval> | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;

  constructor() {
    const cfg = this.config;

    this.client = new LighterClient({
      apiBaseUrl: cfg.lighter.apiBaseUrl,
      wsBaseUrl: cfg.lighter.wsBaseUrl,
      apiKey: cfg.lighter.apiKey,
      subAccountId: cfg.lighter.subAccountId,
      requestTimeoutMs: cfg.lighter.requestTimeoutMs,
      maxRetries: cfg.lighter.maxRetries,
      retryDelayMs: cfg.lighter.retryDelayMs,
    });

    this.wsFeed = new LighterWebSocketFeed({
      wsBaseUrl: cfg.lighter.wsBaseUrl,
      apiKey: cfg.lighter.apiKey,
      symbols: cfg.bot.enabledSymbols,
      reconnectDelayMs: 2000,
      maxReconnectAttempts: 20,
      pingIntervalMs: 30_000,
    });

    this.riskEngine = new RiskEngine();
    this.ensemble = new EnsembleSignalAggregator();
    this.paperAdapter = new PaperTradingAdapter({
      initialBalance: "10000",
    });

    this.tickers = {};
    this.tickerTimestamps = {};
    this.candleCache = new Map();
    this.signalLoopTimer = null;
    this.heartbeatTimer = null;

    this.botState = {
      status: "STOPPED",
      mode: cfg.execution.mode,
      lastHeartbeat: Date.now(),
      activePositions: 0,
      dailyPnl: "0",
      dailyLoss: "0",
      dailyTrades: 0,
      consecutiveLosses: 0,
      circuitBreakerTripped: false,
      killSwitchActive: false,
    };

    log.info(
      {
        mode: cfg.execution.mode,
        dryRun: cfg.execution.dryRun,
        symbols: cfg.bot.enabledSymbols,
      },
      "BotOrchestrator created"
    );
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.botState.status === "RUNNING") {
      log.warn("Bot already running");
      return;
    }

    this.botState.status = "STARTING";
    log.info({ mode: this.config.execution.mode }, "Starting bot...");

    try {
      // Warm up candle cache
      await this.warmUpCandleCache();

      // Connect WebSocket feed
      this.wsFeed.connect();
      this.wsFeed.on("event", (event) => this.handleWsEvent(event));

      // Start signal loop
      this.signalLoopTimer = setInterval(
        () => this.runSignalLoop().catch((err) => log.error({ err }, "Signal loop error")),
        this.config.bot.signalIntervalMs
      );

      // Heartbeat
      this.heartbeatTimer = setInterval(
        () => {
          this.botState.lastHeartbeat = Date.now();
          const riskState = this.riskEngine.getState();
          this.botState.circuitBreakerTripped = riskState.circuitBreakerTripped;
          this.botState.killSwitchActive = riskState.killSwitchActive;
        },
        this.config.bot.heartbeatIntervalMs
      );

      this.botState.status = "RUNNING";
      this.botState.startedAt = Date.now();
      log.info("Bot running");
    } catch (err) {
      this.botState.status = "ERROR";
      this.botState.error = err instanceof Error ? err.message : "Unknown startup error";
      log.error({ err }, "Bot failed to start");
      throw err;
    }
  }

  async stop(): Promise<void> {
    log.info("Stopping bot...");
    if (this.signalLoopTimer) {
      clearInterval(this.signalLoopTimer);
      this.signalLoopTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wsFeed.disconnect();
    this.botState.status = "STOPPED";
    log.info("Bot stopped");
  }

  activateKillSwitch(reason: string): void {
    this.riskEngine.activateKillSwitch(reason);
    this.botState.killSwitchActive = true;
    this.botState.status = "KILL_SWITCH_ACTIVE";
    log.warn({ reason }, "Kill switch activated via orchestrator");
  }

  deactivateKillSwitch(): void {
    this.riskEngine.deactivateKillSwitch();
    this.botState.killSwitchActive = false;
    if (this.botState.status === "KILL_SWITCH_ACTIVE") {
      this.botState.status = "RUNNING";
    }
  }

  resetCircuitBreaker(): void {
    this.riskEngine.resetCircuitBreaker();
    this.botState.circuitBreakerTripped = false;
    if (this.botState.status === "CIRCUIT_BREAKER_TRIPPED") {
      this.botState.status = "RUNNING";
    }
  }

  // ─── Signal Loop ──────────────────────────────────────────────────────────

  private async runSignalLoop(): Promise<void> {
    if (this.botState.status !== "RUNNING") return;

    for (const symbol of this.config.bot.enabledSymbols) {
      try {
        await this.processSymbol(symbol);
      } catch (err) {
        log.error({ symbol, err }, "Error processing symbol in signal loop");
      }
    }
  }

  private async processSymbol(symbol: Symbol): Promise<void> {
    const ticker = this.tickers[symbol];
    const tickerAge = this.tickerTimestamps[symbol]
      ? Date.now() - (this.tickerTimestamps[symbol] ?? 0)
      : Infinity;

    if (!ticker || tickerAge > 30_000) {
      // Fall back to REST if WebSocket data is stale
      try {
        const freshTicker = await this.client.getTicker(symbol);
        this.tickers[symbol] = freshTicker;
        this.tickerTimestamps[symbol] = Date.now();
        log.debug({ symbol }, "Refreshed ticker via REST");
      } catch {
        log.warn({ symbol }, "Failed to refresh ticker — skipping symbol this cycle");
        return;
      }
    }

    const currentTicker = this.tickers[symbol]!;
    const candleMap = this.candleCache.get(symbol) ?? new Map();

    // Generate strategy configs for this symbol
    const strategyConfigs = this.buildDefaultStrategyConfigs(symbol);

    // Generate ensemble signal
    const signal = await this.ensemble.generate(symbol, candleMap, currentTicker, strategyConfigs);
    if (!signal) return;

    // Get account state
    let account: AccountBalance;
    let openPositions: Position[];

    if (this.config.execution.dryRun || this.config.execution.paperTrading) {
      // Use paper state
      const summary = this.paperAdapter.getSummary();
      account = {
        currency: "USDC",
        total: summary.balance,
        available: summary.balance,
        locked: "0",
        unrealizedPnl: "0",
        marginUsed: "0",
        marginAvailable: summary.balance,
        accountEquity: summary.balance,
        maintenanceMargin: "0",
        initialMargin: "0",
        accountHealth: 100,
      };
      openPositions = this.paperAdapter.getOpenPositions();
    } else {
      account = await this.client.getAccountBalance();
      openPositions = await this.client.getOpenPositions();
    }

    // Risk assessment
    const riskResult = this.riskEngine.assess({
      signal,
      account,
      openPositions,
      ticker: currentTicker,
      orderBook: { // simplified
        symbol,
        bids: [{ price: currentTicker.bestBid, size: currentTicker.bestBidSize }],
        asks: [{ price: currentTicker.bestAsk, size: currentTicker.bestAskSize }],
        lastUpdateId: 0,
        timestamp: Date.now(),
      },
      botState: this.botState,
      tickerAge: tickerAge === Infinity ? 999_999 : tickerAge,
    });

    if (!riskResult.approved) {
      log.debug({ symbol, reasons: riskResult.reasons }, "Signal rejected by risk engine");
      return;
    }

    // Build order request
    const orderReq: OrderRequest = {
      symbol,
      side: signal.direction === "LONG" ? "BUY" : "SELL",
      type: "LIMIT",
      size: riskResult.computedPositionSize,
      price: signal.entryPrice,
      timeInForce: "POST_ONLY",
      postOnly: true,
      clientOrderId: generateClientOrderId(symbol, signal.direction),
      leverage: riskResult.adjustedLeverage,
      reduceOnly: false,
      signal,
      riskAssessment: riskResult,
    };

    // Execute
    if (this.config.execution.dryRun) {
      log.info(
        {
          mode: "DRY_RUN",
          symbol,
          direction: signal.direction,
          size: riskResult.computedPositionSize,
          leverage: riskResult.adjustedLeverage,
          confidence: signal.confidence.toFixed(3),
          riskScore: riskResult.score,
        },
        "DRY_RUN: Would place order"
      );
    } else if (this.config.execution.paperTrading) {
      const result = await this.paperAdapter.placeOrder(
        orderReq,
        currentTicker,
        signal,
        riskResult
      );
      if (result.success) {
        this.botState.dailyTrades++;
        this.botState.activePositions = this.paperAdapter.getSummary().openPositions;
      }
    } else if (this.config.execution.liveEnabled) {
      // TODO: Route to LiveExecutionAdapter
      log.warn({ symbol }, "Live execution path not yet connected in orchestrator");
    }

    this.botState.lastSignalAt = {
      ...this.botState.lastSignalAt,
      [symbol]: Date.now(),
    };
  }

  // ─── WebSocket Handler ────────────────────────────────────────────────────

  private handleWsEvent(event: { type: string; symbol?: Symbol; data?: unknown }): void {
    if (event.type === "ticker" && event.symbol && event.data) {
      this.tickers[event.symbol] = event.data as Ticker;
      this.tickerTimestamps[event.symbol] = Date.now();
    }
  }

  // ─── Candle Cache Warmup ──────────────────────────────────────────────────

  private async warmUpCandleCache(): Promise<void> {
    const intervals: Interval[] = ["15m", "1h", "4h"];

    for (const symbol of this.config.bot.enabledSymbols) {
      const symbolMap = new Map<Interval, Candle[]>();
      for (const interval of intervals) {
        try {
          const candles = await this.client.getCandles(symbol, interval, 200);
          symbolMap.set(interval, candles);
          log.debug({ symbol, interval, count: candles.length }, "Candle cache warmed");
          await sleep(200); // Rate limit protection
        } catch (err) {
          log.warn({ symbol, interval, err }, "Failed to warm candle cache");
        }
      }
      this.candleCache.set(symbol, symbolMap);
    }
  }

  // ─── Default Strategy Configs ─────────────────────────────────────────────

  private buildDefaultStrategyConfigs(symbol: Symbol) {
    return [
      {
        type: "TREND_FOLLOWING" as const,
        symbol,
        enabled: true,
        weight: 0.35,
        params: {},
        timeframes: ["1h" as Interval, "4h" as Interval],
      },
      {
        type: "MOMENTUM" as const,
        symbol,
        enabled: true,
        weight: 0.30,
        params: {},
        timeframes: ["15m" as Interval, "1h" as Interval],
      },
      {
        type: "BREAKOUT" as const,
        symbol,
        enabled: true,
        weight: 0.20,
        params: {},
        timeframes: ["1h" as Interval],
      },
      {
        type: "MEAN_REVERSION" as const,
        symbol,
        enabled: true,
        weight: 0.15,
        params: {},
        timeframes: ["15m" as Interval],
      },
    ];
  }

  // ─── State Access ─────────────────────────────────────────────────────────

  getBotState(): BotState {
    return { ...this.botState };
  }

  getPaperSummary() {
    return this.paperAdapter.getSummary();
  }

  getPaperTrades() {
    return this.paperAdapter.getTrades();
  }

  getClient(): LighterClient {
    return this.client;
  }

  getRiskEngine(): RiskEngine {
    return this.riskEngine;
  }
}
