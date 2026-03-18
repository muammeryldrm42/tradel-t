import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BotOrchestrator } from "../services/BotOrchestrator.js";
import { createChildLogger } from "@lighter-bot/common";

const log = createChildLogger({ module: "routes/bot" });

export async function registerBotRoutes(app: FastifyInstance, orchestrator: BotOrchestrator) {
  // GET /bot/state
  app.get("/bot/state", async () => {
    return {
      botState: orchestrator.getBotState(),
      paperSummary: orchestrator.getPaperSummary(),
      riskState: orchestrator.getRiskEngine().getState(),
    };
  });

  // POST /bot/start
  app.post("/bot/start", async (req, reply) => {
    try {
      await orchestrator.start();
      return { success: true, message: "Bot started" };
    } catch (err) {
      reply.status(500).send({ error: { message: (err as Error).message } });
    }
  });

  // POST /bot/stop
  app.post("/bot/stop", async () => {
    await orchestrator.stop();
    return { success: true, message: "Bot stopped" };
  });

  // POST /bot/kill-switch
  const killSwitchSchema = z.object({
    reason: z.string().min(3).max(500),
  });

  app.post("/bot/kill-switch", async (req, reply) => {
    const body = killSwitchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { message: "reason required" } });
    }
    orchestrator.activateKillSwitch(body.data.reason);
    log.warn({ reason: body.data.reason }, "Kill switch activated via API");
    return { success: true, message: "Kill switch activated" };
  });

  // DELETE /bot/kill-switch (deactivate)
  app.delete("/bot/kill-switch", async () => {
    orchestrator.deactivateKillSwitch();
    return { success: true, message: "Kill switch deactivated" };
  });

  // POST /bot/reset-circuit-breaker
  app.post("/bot/reset-circuit-breaker", async () => {
    orchestrator.resetCircuitBreaker();
    return { success: true, message: "Circuit breaker reset" };
  });
}
