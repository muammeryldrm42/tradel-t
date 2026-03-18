import type { FastifyInstance } from "fastify";
import { SUPPORTED_SYMBOLS } from "@lighter-bot/common";
import type { Symbol, Interval } from "@lighter-bot/common";
import type { BotOrchestrator } from "../services/BotOrchestrator.js";

export async function registerMarketRoutes(app: FastifyInstance, orchestrator: BotOrchestrator) {
  const client = orchestrator.getClient();

  // GET /markets
  app.get("/markets", async () => {
    const markets = await client.getMarkets();
    return { markets };
  });

  // GET /markets/:symbol/ticker
  app.get<{ Params: { symbol: string } }>("/markets/:symbol/ticker", async (req, reply) => {
    const { symbol } = req.params;
    if (!SUPPORTED_SYMBOLS.includes(symbol.toUpperCase() as Symbol)) {
      return reply.status(400).send({ error: { message: `Unsupported symbol: ${symbol}` } });
    }
    const ticker = await client.getTicker(symbol.toUpperCase() as Symbol);
    return { ticker };
  });

  // GET /markets/:symbol/orderbook
  app.get<{ Params: { symbol: string }; Querystring: { depth?: string } }>(
    "/markets/:symbol/orderbook",
    async (req, reply) => {
      const { symbol } = req.params;
      const depth = parseInt(req.query.depth ?? "20");
      if (!SUPPORTED_SYMBOLS.includes(symbol.toUpperCase() as Symbol)) {
        return reply.status(400).send({ error: { message: `Unsupported symbol: ${symbol}` } });
      }
      const orderBook = await client.getOrderBook(symbol.toUpperCase() as Symbol, depth);
      return { orderBook };
    }
  );

  // GET /markets/:symbol/candles
  app.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; limit?: string; startTime?: string; endTime?: string };
  }>("/markets/:symbol/candles", async (req, reply) => {
    const { symbol } = req.params;
    const { interval = "1h", limit = "200", startTime, endTime } = req.query;
    if (!SUPPORTED_SYMBOLS.includes(symbol.toUpperCase() as Symbol)) {
      return reply.status(400).send({ error: { message: `Unsupported symbol: ${symbol}` } });
    }
    const candles = await client.getCandles(
      symbol.toUpperCase() as Symbol,
      interval as Interval,
      parseInt(limit),
      startTime ? parseInt(startTime) : undefined,
      endTime ? parseInt(endTime) : undefined
    );
    return { candles };
  });
}
