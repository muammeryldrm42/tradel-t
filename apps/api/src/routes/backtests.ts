import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BacktestEngine } from "@lighter-bot/backtest";
import type { BacktestConfig, Symbol, Interval } from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";

const log = createChildLogger({ module: "routes/backtests" });

export async function registerBacktestRoutes(app: FastifyInstance) {
  const RunSchema = z.object({
    name: z.string().min(1).max(200),
    symbols: z.array(z.enum(["BTC", "ETH", "SOL"])).min(1),
    startDate: z.number().int(),
    endDate: z.number().int(),
    interval: z.string().default("1h"),
    initialCapital: z.string().default("10000"),
  });

  // POST /backtests/run
  app.post("/backtests/run", async (req, reply) => {
    const parsed = RunSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: parsed.error.message } });
    }

    const { name, symbols, startDate, endDate, interval, initialCapital } = parsed.data;

    const config: BacktestConfig = {
      id: `bt_${Date.now()}`,
      name,
      symbols: symbols as Symbol[],
      startDate,
      endDate,
      interval: interval as Interval,
      initialCapital,
      strategyConfigs: symbols.flatMap((symbol) => [
        { type: "TREND_FOLLOWING" as const, symbol: symbol as Symbol, enabled: true, weight: 0.35, params: {}, timeframes: ["1h" as Interval] },
        { type: "MOMENTUM" as const, symbol: symbol as Symbol, enabled: true, weight: 0.30, params: {}, timeframes: ["15m" as Interval, "1h" as Interval] },
        { type: "BREAKOUT" as const, symbol: symbol as Symbol, enabled: true, weight: 0.20, params: {}, timeframes: ["1h" as Interval] },
        { type: "MEAN_REVERSION" as const, symbol: symbol as Symbol, enabled: true, weight: 0.15, params: {}, timeframes: ["15m" as Interval] },
      ]),
      riskParams: {},
      feeModel: { makerFeePct: 0.0002, takerFeePct: 0.0005, usePostOnly: true },
      slippageModel: { baseSlippageBps: 5, volumeImpactFactor: 0.1, maxSlippageBps: 30 },
      fundingModel: { intervalHours: 8, useHistoricalRates: false, fallbackRateHourly: 0.0001 },
      latencyModelMs: 150,
    };

    log.info({ name, symbols, startDate: new Date(startDate).toISOString().slice(0,10), endDate: new Date(endDate).toISOString().slice(0,10) }, "Backtest run requested");

    // NOTE: Requires pre-loaded historical data
    // In production this fetches from DB or file; stub returns config
    return {
      message: "Backtest queued. In production, fetch historical data and call BacktestEngine.run()",
      config,
      // result: await engine.run(historicalData),
    };
  });

  // GET /backtests - list past runs from DB
  app.get("/backtests", async () => {
    // TODO: Query from Prisma BacktestRun table
    return { backtests: [], message: "Connect Prisma to list historical backtest runs" };
  });
}
