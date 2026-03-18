import type { FastifyInstance } from "fastify";

export async function registerBacktestRoutes(app: FastifyInstance) {
  app.get("/backtests", async () => ({
    backtests: [],
    message: "Backtest feature coming soon.",
  }));

  app.post("/backtests/run", async () => ({
    message: "Backtest feature coming soon.",
  }));
}
