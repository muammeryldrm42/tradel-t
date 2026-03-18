import type { FastifyInstance } from "fastify";
import type { BotOrchestrator } from "../services/BotOrchestrator.js";

export async function registerTradeRoutes(app: FastifyInstance, orchestrator: BotOrchestrator) {
  // GET /trades - simulated/paper trades
  app.get<{ Querystring: { open?: string; limit?: string } }>("/trades", async (req) => {
    const all = orchestrator.getPaperTrades();
    const onlyOpen = req.query.open === "true";
    const limit = parseInt(req.query.limit ?? "100");
    const filtered = onlyOpen ? all.filter((t) => t.isOpen) : all;
    return {
      trades: filtered.slice(-limit).reverse(),
      total: filtered.length,
    };
  });

  // GET /trades/summary
  app.get("/trades/summary", async () => ({
    summary: orchestrator.getPaperSummary(),
  }));

  // GET /positions - open paper positions
  app.get("/positions", async () => {
    // Exposed via paper adapter
    const trades = orchestrator.getPaperTrades().filter((t) => t.isOpen);
    return { positions: trades };
  });
}
