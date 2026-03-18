/**
 * LiveExecutionAdapter
 * CRITICAL: Constructor throws if any of the 3 unlock conditions is missing.
 */
import type { OrderRequest, OrderResult, ExecutionContext, Symbol } from "@lighter-bot/common";
import { createChildLogger, sleep } from "@lighter-bot/common";

const log = createChildLogger({ module: "live-adapter" });

export interface ILighterClient {
  placeOrder(req: OrderRequest): Promise<import("@lighter-bot/common").Order>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(symbol?: Symbol): Promise<void>;
}

export class LiveExecutionAdapter {
  private readonly client: ILighterClient;
  private readonly context: ExecutionContext;
  private orderCount: number = 0;
  private lastOrderTime: number = 0;
  private readonly minOrderIntervalMs = 500;

  constructor(client: ILighterClient, context: ExecutionContext) {
    if (!context.liveEnabled) {
      throw new Error("LiveExecutionAdapter: ENABLE_LIVE_TRADING is not true. Live execution is disabled by default.");
    }
    if (!context.acknowledgedRisk) {
      throw new Error("LiveExecutionAdapter: I_UNDERSTAND_THIS_MAY_LOSE_REAL_MONEY must be true.");
    }
    if (!context.operatorConfirmationToken) {
      throw new Error("LiveExecutionAdapter: OPERATOR_CONFIRMATION_TOKEN is required.");
    }
    this.client = client;
    this.context = context;
    log.warn({ mode: "LIVE", symbolAllowlist: context.symbolAllowlist }, "⚠️ LiveExecutionAdapter initialized — REAL MONEY");
  }

  async placeOrder(req: OrderRequest): Promise<OrderResult> {
    if (!this.context.symbolAllowlist.includes(req.symbol)) {
      return { success: false, error: `Symbol ${req.symbol} not in allowlist`, simulated: false, mode: "LIVE" };
    }
    const timeSinceLast = Date.now() - this.lastOrderTime;
    if (timeSinceLast < this.minOrderIntervalMs) await sleep(this.minOrderIntervalMs - timeSinceLast);
    if (!req.riskAssessment?.approved) {
      return { success: false, error: "Risk assessment must be approved before live order", simulated: false, mode: "LIVE" };
    }
    const startTime = Date.now();
    this.lastOrderTime = startTime;
    this.orderCount++;
    try {
      const order = await this.client.placeOrder(req);
      log.info({ orderId: order.id, status: order.status, latencyMs: Date.now() - startTime }, "LIVE order confirmed");
      return { success: true, order, simulated: false, mode: "LIVE", latencyMs: Date.now() - startTime };
    } catch (err) {
      log.error({ err, req }, "LIVE order failed");
      return { success: false, error: err instanceof Error ? err.message : "Unknown error", simulated: false, mode: "LIVE" };
    }
  }

  async emergencyFlattenAll(symbols: Symbol[]): Promise<void> {
    log.warn({ symbols }, "EMERGENCY FLATTEN: cancelling all orders");
    for (const symbol of symbols) {
      try { await this.client.cancelAllOrders(symbol); } catch (err) { log.error({ symbol, err }, "Cancel failed during emergency flatten"); }
    }
  }

  getOrderCount(): number { return this.orderCount; }
}
