/**
 * LighterWebSocketFeed - Real-time market data via WebSocket.
 * Handles reconnection, subscription management, and event emission.
 */

import { EventEmitter } from "events";
import type { Symbol, Ticker, OrderBook, Trade, Candle } from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { sleep } from "@lighter-bot/common";

const log = createChildLogger({ module: "ws-feed" });

export type WsFeedEvent =
  | { type: "ticker"; symbol: Symbol; data: Ticker }
  | { type: "orderbook"; symbol: Symbol; data: OrderBook }
  | { type: "trade"; symbol: Symbol; data: Trade }
  | { type: "candle"; symbol: Symbol; data: Candle }
  | { type: "connected" }
  | { type: "disconnected"; reason: string }
  | { type: "error"; error: Error };

export interface WsFeedConfig {
  wsBaseUrl: string;
  apiKey?: string | null;
  symbols: Symbol[];
  reconnectDelayMs: number;
  maxReconnectAttempts: number;
  pingIntervalMs: number;
}

export class LighterWebSocketFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WsFeedConfig;
  private reconnectAttempts: number;
  private pingInterval: ReturnType<typeof setInterval> | null;
  private isShuttingDown: boolean;
  private subscriptions: Set<string>;
  private lastMessageAt: number;
  private staleCheckInterval: ReturnType<typeof setInterval> | null;

  constructor(config: WsFeedConfig) {
    super();
    this.config = config;
    this.reconnectAttempts = 0;
    this.pingInterval = null;
    this.isShuttingDown = false;
    this.subscriptions = new Set();
    this.lastMessageAt = 0;
    this.staleCheckInterval = null;
  }

  connect(): void {
    if (this.isShuttingDown) return;
    log.info({ url: this.config.wsBaseUrl }, "Connecting to Lighter WebSocket");

    try {
      this.ws = new WebSocket(this.config.wsBaseUrl);
      this.attachHandlers();
    } catch (err) {
      log.error({ err }, "WebSocket construction failed");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.isShuttingDown = true;
    this.clearIntervals();
    if (this.ws) {
      this.ws.close(1000, "Graceful shutdown");
      this.ws = null;
    }
    log.info("WebSocket disconnected gracefully");
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getDataStalenessMs(): number {
    if (this.lastMessageAt === 0) return Infinity;
    return Date.now() - this.lastMessageAt;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private attachHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      log.info("WebSocket connected");
      this.emit("event", { type: "connected" } as WsFeedEvent);

      // Authenticate if API key provided
      if (this.config.apiKey) {
        this.send({ type: "auth", apiKey: this.config.apiKey });
      }

      // Subscribe to all configured symbols
      this.subscribeAll();
      this.startPing();
      this.startStaleCheck();
    };

    this.ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        this.handleMessage(msg);
      } catch (err) {
        log.warn({ err }, "Failed to parse WebSocket message");
      }
    };

    this.ws.onerror = (event) => {
      log.error({ event }, "WebSocket error");
      this.emit("event", { type: "error", error: new Error("WebSocket error") } as WsFeedEvent);
    };

    this.ws.onclose = (event) => {
      this.clearIntervals();
      log.warn(
        { code: event.code, reason: event.reason },
        "WebSocket closed"
      );
      this.emit("event", {
        type: "disconnected",
        reason: event.reason ?? "closed",
      } as WsFeedEvent);

      if (!this.isShuttingDown) {
        this.scheduleReconnect();
      }
    };
  }

  private subscribeAll(): void {
    for (const symbol of this.config.symbols) {
      this.subscribeSymbol(symbol);
    }
  }

  private subscribeSymbol(symbol: Symbol): void {
    const streams = [
      `${symbol.toLowerCase()}-perp@ticker`,
      `${symbol.toLowerCase()}-perp@orderbook`,
      `${symbol.toLowerCase()}-perp@trades`,
    ];

    for (const stream of streams) {
      if (!this.subscriptions.has(stream)) {
        this.send({ type: "subscribe", channel: stream });
        this.subscriptions.add(stream);
        log.debug({ stream }, "Subscribed to stream");
      }
    }
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case "ticker":
        if (msg.symbol && msg.data) {
          this.emit("event", {
            type: "ticker",
            symbol: msg.symbol as Symbol,
            data: msg.data as Ticker,
          } as WsFeedEvent);
        }
        break;
      case "orderbook":
        if (msg.symbol && msg.data) {
          this.emit("event", {
            type: "orderbook",
            symbol: msg.symbol as Symbol,
            data: msg.data as OrderBook,
          } as WsFeedEvent);
        }
        break;
      case "trade":
        if (msg.symbol && msg.data) {
          this.emit("event", {
            type: "trade",
            symbol: msg.symbol as Symbol,
            data: msg.data as Trade,
          } as WsFeedEvent);
        }
        break;
      case "pong":
        // Heartbeat acknowledged
        break;
      case "error":
        log.error({ msg }, "Server sent error message");
        break;
      default:
        log.trace({ msg }, "Unknown message type");
    }
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, this.config.pingIntervalMs);
  }

  private startStaleCheck(): void {
    this.staleCheckInterval = setInterval(() => {
      const staleMs = this.getDataStalenessMs();
      if (staleMs > 60_000 && !this.isShuttingDown) {
        log.warn({ staleMs }, "No WebSocket data for 60s — reconnecting");
        this.ws?.close();
      }
    }, 30_000);
  }

  private clearIntervals(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      log.error(
        { attempts: this.reconnectAttempts },
        "Max reconnect attempts reached — giving up"
      );
      this.emit("event", {
        type: "error",
        error: new Error("Max reconnect attempts exceeded"),
      } as WsFeedEvent);
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      30_000
    );
    this.reconnectAttempts++;
    log.info(
      { attempt: this.reconnectAttempts, delay },
      "Scheduling WebSocket reconnect"
    );
    await sleep(delay);
    this.connect();
  }
}

interface WsMessage {
  type: string;
  symbol?: string;
  channel?: string;
  data?: unknown;
  code?: number;
  message?: string;
}
