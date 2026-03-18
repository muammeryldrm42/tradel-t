/**
 * LighterClient - Clean adapter for the Lighter perpetuals platform.
 * 
 * Separates public market data from authenticated private endpoints.
 * All authentication is encapsulated here — no auth logic leaks elsewhere.
 * 
 * TODO: Adjust exact endpoint paths once official Lighter API docs confirm them.
 * All method signatures match the expected domain interface; stubs are marked.
 */

import {
  type Symbol,
  type Interval,
  type Candle,
  type Ticker,
  type OrderBook,
  type Trade,
  type Position,
  type Order,
  type AccountBalance,
  type OrderRequest,
  SUPPORTED_SYMBOLS,
} from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { sleep } from "@lighter-bot/common";

const log = createChildLogger({ module: "lighter-client" });

// ─── Config ───────────────────────────────────────────────────────────────────

export interface LighterClientConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  apiKey: string | null;
  subAccountId: string | null;
  requestTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface LighterApiError {
  code: string;
  message: string;
  details?: unknown;
}

interface ApiResponse<T> {
  data?: T;
  error?: LighterApiError;
  statusCode: number;
}

// ─── Symbol Mapping ───────────────────────────────────────────────────────────

// TODO: Verify exact market IDs with Lighter API documentation
const SYMBOL_TO_MARKET_ID: Record<Symbol, string> = {
  BTC: "BTC-PERP",
  ETH: "ETH-PERP",
  SOL: "SOL-PERP",
};

const INTERVAL_MAP: Record<Interval, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "1440",
  "1w": "10080",
};

// ─── LighterClient ────────────────────────────────────────────────────────────

export class LighterClient {
  private readonly config: LighterClientConfig;
  private isAuthenticated: boolean;

  constructor(config: LighterClientConfig) {
    this.config = config;
    this.isAuthenticated = !!config.apiKey;
    log.info(
      {
        apiBaseUrl: config.apiBaseUrl,
        authenticated: this.isAuthenticated,
        subAccount: config.subAccountId ?? "none",
      },
      "LighterClient initialized"
    );
  }

  // ─── Public Market Data ────────────────────────────────────────────────────

  async getMarkets(): Promise<Array<{ id: string; symbol: Symbol; active: boolean }>> {
    const resp = await this.publicGet<{ markets: Array<{ id: string; name: string; status: string }> }>(
      "/v1/markets"
    );
    if (!resp.data) throw new Error("Failed to fetch markets");

    return resp.data.markets
      .filter((m) => m.status === "active")
      .map((m) => ({
        id: m.id,
        symbol: this.marketIdToSymbol(m.name),
        active: true,
      }))
      .filter((m): m is typeof m & { symbol: Symbol } =>
        SUPPORTED_SYMBOLS.includes(m.symbol as Symbol)
      );
  }

  async getTicker(symbol: Symbol): Promise<Ticker> {
    const marketId = SYMBOL_TO_MARKET_ID[symbol];
    // TODO: Confirm exact Lighter ticker endpoint path
    const resp = await this.publicGet<LighterTickerRaw>(`/v1/markets/${marketId}/ticker`);

    if (!resp.data) {
      throw new Error(`Failed to fetch ticker for ${symbol}`);
    }

    return this.normalizeTicker(symbol, resp.data);
  }

  async getAllTickers(): Promise<Record<Symbol, Ticker>> {
    const tickers: Partial<Record<Symbol, Ticker>> = {};
    await Promise.all(
      SUPPORTED_SYMBOLS.map(async (symbol) => {
        try {
          tickers[symbol] = await this.getTicker(symbol);
        } catch (err) {
          log.warn({ symbol, err }, "Failed to fetch ticker, skipping");
        }
      })
    );
    return tickers as Record<Symbol, Ticker>;
  }

  async getOrderBook(symbol: Symbol, depth = 20): Promise<OrderBook> {
    const marketId = SYMBOL_TO_MARKET_ID[symbol];
    const resp = await this.publicGet<LighterOrderBookRaw>(
      `/v1/markets/${marketId}/orderbook?depth=${depth}`
    );
    if (!resp.data) throw new Error(`Failed to fetch order book for ${symbol}`);
    return this.normalizeOrderBook(symbol, resp.data);
  }

  async getCandles(
    symbol: Symbol,
    interval: Interval,
    limit = 200,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const marketId = SYMBOL_TO_MARKET_ID[symbol];
    const intervalStr = INTERVAL_MAP[interval];

    const params = new URLSearchParams({
      interval: intervalStr,
      limit: limit.toString(),
    });
    if (startTime) params.set("startTime", startTime.toString());
    if (endTime) params.set("endTime", endTime.toString());

    // TODO: Confirm candles endpoint path and response shape
    const resp = await this.publicGet<{ candles: LighterCandleRaw[] }>(
      `/v1/markets/${marketId}/candles?${params.toString()}`
    );
    if (!resp.data) throw new Error(`Failed to fetch candles for ${symbol}`);

    return resp.data.candles.map((c) => this.normalizeCandle(symbol, interval, c));
  }

  async getRecentTrades(symbol: Symbol, limit = 50): Promise<Trade[]> {
    const marketId = SYMBOL_TO_MARKET_ID[symbol];
    const resp = await this.publicGet<{ trades: LighterTradeRaw[] }>(
      `/v1/markets/${marketId}/trades?limit=${limit}`
    );
    if (!resp.data) throw new Error(`Failed to fetch trades for ${symbol}`);
    return resp.data.trades.map((t) => this.normalizeTrade(symbol, t));
  }

  // ─── Private Authenticated Endpoints ──────────────────────────────────────

  async getAccountBalance(): Promise<AccountBalance> {
    this.requireAuth();
    // TODO: Confirm balance endpoint path
    const resp = await this.privateGet<LighterAccountRaw>("/v1/account/balance");
    if (!resp.data) throw new Error("Failed to fetch account balance");
    return this.normalizeBalance(resp.data);
  }

  async getOpenPositions(): Promise<Position[]> {
    this.requireAuth();
    const resp = await this.privateGet<{ positions: LighterPositionRaw[] }>(
      "/v1/account/positions?status=open"
    );
    if (!resp.data) return [];
    return resp.data.positions.map((p) => this.normalizePosition(p));
  }

  async getOpenOrders(symbol?: Symbol): Promise<Order[]> {
    this.requireAuth();
    const path = symbol
      ? `/v1/account/orders?status=open&market=${SYMBOL_TO_MARKET_ID[symbol]}`
      : "/v1/account/orders?status=open";
    const resp = await this.privateGet<{ orders: LighterOrderRaw[] }>(path);
    if (!resp.data) return [];
    return resp.data.orders.map((o) => this.normalizeOrder(o));
  }

  async placeOrder(req: OrderRequest): Promise<Order> {
    this.requireAuth();
    const marketId = SYMBOL_TO_MARKET_ID[req.symbol];

    const body = {
      market: marketId,
      side: req.side === "BUY" ? "buy" : "sell",
      type: req.type.toLowerCase(),
      size: req.size,
      price: req.price,
      stopPrice: req.stopPrice,
      timeInForce: req.timeInForce ?? "GTC",
      reduceOnly: req.reduceOnly ?? false,
      postOnly: req.postOnly ?? false,
      clientOrderId: req.clientOrderId,
      leverage: req.leverage,
    };

    log.info(
      { symbol: req.symbol, side: req.side, type: req.type, size: req.size, clientOrderId: req.clientOrderId },
      "Placing order on Lighter"
    );

    // TODO: Confirm order placement endpoint and request shape
    const resp = await this.privatePost<{ order: LighterOrderRaw }>("/v1/orders", body);
    if (!resp.data) {
      throw new Error(`Order placement failed: ${resp.error?.message ?? "unknown"}`);
    }
    return this.normalizeOrder(resp.data.order);
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.requireAuth();
    // TODO: Confirm cancel endpoint
    await this.privateDelete(`/v1/orders/${orderId}`);
    log.info({ orderId }, "Order cancelled");
  }

  async cancelAllOrders(symbol?: Symbol): Promise<void> {
    this.requireAuth();
    const path = symbol
      ? `/v1/orders?market=${SYMBOL_TO_MARKET_ID[symbol]}`
      : "/v1/orders";
    await this.privateDelete(path);
    log.info({ symbol: symbol ?? "ALL" }, "All orders cancelled");
  }

  async getOrder(orderId: string): Promise<Order | null> {
    this.requireAuth();
    const resp = await this.privateGet<{ order: LighterOrderRaw }>(`/v1/orders/${orderId}`);
    if (!resp.data) return null;
    return this.normalizeOrder(resp.data.order);
  }

  // ─── HTTP Helpers ──────────────────────────────────────────────────────────

  private async publicGet<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, null, false);
  }

  private async privateGet<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, null, true);
  }

  private async privatePost<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, body, true);
  }

  private async privateDelete<T = void>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path, null, true);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    requiresAuth: boolean,
    attempt = 1
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (requiresAuth) {
      headers["X-API-Key"] = this.config.apiKey!;
      if (this.config.subAccountId) {
        headers["X-Sub-Account-Id"] = this.config.subAccountId;
      }
      // TODO: If Lighter uses HMAC signing, implement here:
      // headers["X-Signature"] = this.signRequest(method, path, body);
      // headers["X-Timestamp"] = Date.now().toString();
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.requestTimeoutMs
      );

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const statusCode = response.status;

      if (response.status === 429 || response.status >= 500) {
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          log.warn(
            { statusCode, attempt, delay, path },
            "Retrying request after backoff"
          );
          await sleep(delay);
          return this.request<T>(method, path, body, requiresAuth, attempt + 1);
        }
      }

      if (!response.ok) {
        let error: LighterApiError = { code: "HTTP_ERROR", message: response.statusText };
        try {
          const errBody = await response.json() as { error?: LighterApiError };
          if (errBody.error) error = errBody.error;
        } catch {}
        log.error({ statusCode, error, path }, "API error response");
        return { statusCode, error };
      }

      const data = await response.json() as T;
      return { statusCode, data };
    } catch (err) {
      if (attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        log.warn({ err, attempt, delay, path }, "Request failed, retrying");
        await sleep(delay);
        return this.request<T>(method, path, body, requiresAuth, attempt + 1);
      }
      log.error({ err, path, method }, "Request permanently failed");
      throw err;
    }
  }

  private requireAuth(): void {
    if (!this.config.apiKey) {
      throw new Error(
        "LighterClient: private endpoint requires LIGHTER_API_KEY to be configured"
      );
    }
  }

  // ─── Normalizers (adapt raw API shapes to our domain types) ───────────────

  private normalizeTicker(symbol: Symbol, raw: LighterTickerRaw): Ticker {
    return {
      symbol,
      lastPrice: raw.lastPrice,
      markPrice: raw.markPrice ?? raw.lastPrice,
      indexPrice: raw.indexPrice ?? raw.lastPrice,
      fundingRate: raw.fundingRate ?? "0",
      nextFundingTime: raw.nextFundingTime ?? 0,
      openInterest: raw.openInterest ?? "0",
      volume24h: raw.volume24h ?? "0",
      priceChange24h: raw.priceChange24h ?? "0",
      priceChangePct24h: raw.priceChangePct24h ?? "0",
      high24h: raw.high24h ?? raw.lastPrice,
      low24h: raw.low24h ?? raw.lastPrice,
      bestBid: raw.bestBid ?? raw.lastPrice,
      bestAsk: raw.bestAsk ?? raw.lastPrice,
      bestBidSize: raw.bestBidSize ?? "0",
      bestAskSize: raw.bestAskSize ?? "0",
      timestamp: raw.timestamp ?? Date.now(),
    };
  }

  private normalizeOrderBook(symbol: Symbol, raw: LighterOrderBookRaw): OrderBook {
    return {
      symbol,
      bids: (raw.bids ?? []).map(([price, size]) => ({ price, size })),
      asks: (raw.asks ?? []).map(([price, size]) => ({ price, size })),
      lastUpdateId: raw.lastUpdateId ?? 0,
      timestamp: raw.timestamp ?? Date.now(),
    };
  }

  private normalizeCandle(symbol: Symbol, interval: Interval, raw: LighterCandleRaw): Candle {
    return {
      symbol,
      interval,
      openTime: raw.openTime,
      closeTime: raw.closeTime,
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      volume: raw.volume,
      quoteVolume: raw.quoteVolume ?? raw.volume,
      trades: raw.trades ?? 0,
      isClosed: raw.isClosed ?? true,
    };
  }

  private normalizeTrade(symbol: Symbol, raw: LighterTradeRaw): Trade {
    return {
      id: raw.id,
      symbol,
      price: raw.price,
      size: raw.size,
      side: raw.side === "buy" ? "BUY" : "SELL",
      timestamp: raw.timestamp,
    };
  }

  private normalizeBalance(raw: LighterAccountRaw): AccountBalance {
    const equity = raw.equity ?? raw.balance;
    const marginUsed = raw.marginUsed ?? raw.initialMargin ?? "0";
    const available = raw.availableBalance ?? raw.balance;
    const mmMargin = raw.maintenanceMargin ?? "0";

    const accountHealth = raw.accountHealth != null
      ? raw.accountHealth
      : parseFloat(equity) > 0
      ? Math.round((parseFloat(available) / parseFloat(equity)) * 100)
      : 100;

    return {
      currency: raw.currency ?? "USDC",
      total: raw.balance,
      available,
      locked: raw.locked ?? "0",
      unrealizedPnl: raw.unrealizedPnl ?? "0",
      marginUsed,
      marginAvailable: available,
      accountEquity: equity,
      maintenanceMargin: mmMargin,
      initialMargin: marginUsed,
      accountHealth: Math.min(100, Math.max(0, accountHealth)),
    };
  }

  private normalizePosition(raw: LighterPositionRaw): Position {
    return {
      id: raw.id,
      symbol: this.marketIdToSymbol(raw.market),
      side: raw.side === "long" ? "LONG" : "SHORT",
      size: raw.size,
      entryPrice: raw.entryPrice,
      markPrice: raw.markPrice,
      liquidationPrice: raw.liquidationPrice,
      unrealizedPnl: raw.unrealizedPnl,
      realizedPnl: raw.realizedPnl ?? "0",
      leverage: raw.leverage ?? 1,
      margin: raw.margin,
      marginType: raw.marginType === "cross" ? "CROSS" : "ISOLATED",
      fundingFee: raw.fundingFee ?? "0",
      openedAt: raw.openedAt,
      updatedAt: raw.updatedAt ?? raw.openedAt,
      isOpen: raw.status === "open",
    };
  }

  private normalizeOrder(raw: LighterOrderRaw): Order {
    return {
      id: raw.id,
      clientOrderId: raw.clientOrderId ?? "",
      symbol: this.marketIdToSymbol(raw.market),
      side: raw.side === "buy" ? "BUY" : "SELL",
      type: raw.type.toUpperCase() as Order["type"],
      timeInForce: (raw.timeInForce?.toUpperCase() ?? "GTC") as Order["timeInForce"],
      price: raw.price,
      stopPrice: raw.stopPrice,
      size: raw.size,
      filledSize: raw.filledSize ?? "0",
      remainingSize: raw.remainingSize ?? raw.size,
      avgFillPrice: raw.avgFillPrice,
      status: this.normalizeOrderStatus(raw.status),
      reduceOnly: raw.reduceOnly ?? false,
      postOnly: raw.postOnly ?? false,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt ?? raw.createdAt,
      fee: raw.fee,
      feeCurrency: raw.feeCurrency,
    };
  }

  private normalizeOrderStatus(status: string): Order["status"] {
    const map: Record<string, Order["status"]> = {
      pending: "PENDING",
      open: "OPEN",
      partial: "PARTIALLY_FILLED",
      filled: "FILLED",
      cancelled: "CANCELLED",
      rejected: "REJECTED",
      expired: "EXPIRED",
    };
    return map[status.toLowerCase()] ?? "OPEN";
  }

  private marketIdToSymbol(marketId: string): Symbol {
    const entry = Object.entries(SYMBOL_TO_MARKET_ID).find(([, v]) => v === marketId);
    if (entry) return entry[0] as Symbol;
    // Fallback: strip -PERP suffix
    const base = marketId.replace(/-PERP$/i, "").toUpperCase();
    if (base === "BTC" || base === "ETH" || base === "SOL") return base;
    throw new Error(`Unknown market ID: ${marketId}`);
  }
}

// ─── Raw API Response Types (adapt as needed when docs are confirmed) ─────────

interface LighterTickerRaw {
  lastPrice: string;
  markPrice?: string;
  indexPrice?: string;
  fundingRate?: string;
  nextFundingTime?: number;
  openInterest?: string;
  volume24h?: string;
  priceChange24h?: string;
  priceChangePct24h?: string;
  high24h?: string;
  low24h?: string;
  bestBid?: string;
  bestAsk?: string;
  bestBidSize?: string;
  bestAskSize?: string;
  timestamp?: number;
}

interface LighterOrderBookRaw {
  bids?: [string, string][];
  asks?: [string, string][];
  lastUpdateId?: number;
  timestamp?: number;
}

interface LighterCandleRaw {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume?: string;
  trades?: number;
  isClosed?: boolean;
}

interface LighterTradeRaw {
  id: string;
  price: string;
  size: string;
  side: string;
  timestamp: number;
}

interface LighterAccountRaw {
  balance: string;
  equity?: string;
  availableBalance?: string;
  unrealizedPnl?: string;
  marginUsed?: string;
  initialMargin?: string;
  maintenanceMargin?: string;
  locked?: string;
  currency?: string;
  accountHealth?: number;
}

interface LighterPositionRaw {
  id: string;
  market: string;
  side: string;
  size: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  unrealizedPnl: string;
  realizedPnl?: string;
  leverage?: number;
  margin: string;
  marginType?: string;
  fundingFee?: string;
  openedAt: number;
  updatedAt?: number;
  status: string;
}

interface LighterOrderRaw {
  id: string;
  clientOrderId?: string;
  market: string;
  side: string;
  type: string;
  timeInForce?: string;
  price?: string;
  stopPrice?: string;
  size: string;
  filledSize?: string;
  remainingSize?: string;
  avgFillPrice?: string;
  status: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  createdAt: number;
  updatedAt?: number;
  fee?: string;
  feeCurrency?: string;
}
