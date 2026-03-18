import type { FastifyInstance } from "fastify";
import type { BotOrchestrator } from "../services/BotOrchestrator.js";

export async function registerMetricsRoutes(app: FastifyInstance, orchestrator: BotOrchestrator) {
  app.get("/metrics/performance", async () => {
    const trades = orchestrator.getPaperTrades().filter((t) => !t.isOpen);
    const wins = trades.filter((t) => parseFloat(t.realizedPnl ?? "0") > 0);
    const losses = trades.filter((t) => parseFloat(t.realizedPnl ?? "0") <= 0);

    const totalPnl = trades.reduce((s, t) => s + parseFloat(t.realizedPnl ?? "0"), 0);
    const totalFees = trades.reduce((s, t) => s + parseFloat(t.entryFee) + parseFloat(t.exitFee), 0);
    const avgHoldMs = trades.length > 0
      ? trades.reduce((s, t) => s + (t.holdDurationMs ?? 0), 0) / trades.length : 0;

    return {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      totalPnl: totalPnl.toFixed(2),
      totalFees: totalFees.toFixed(2),
      avgHoldHours: (avgHoldMs / 3600_000).toFixed(2),
      winningTrades: wins.length,
      losingTrades: losses.length,
      openTrades: orchestrator.getPaperTrades().filter((t) => t.isOpen).length,
    };
  });
}

export async function registerAuditRoutes(app: FastifyInstance) {
  // TODO: Query from Prisma AuditEvent table
  app.get("/audit", async () => ({
    events: [],
    message: "Connect Prisma to list audit events",
  }));
}
