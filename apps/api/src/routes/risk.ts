// risk.ts
import type { FastifyInstance } from "fastify";
import { DEFAULT_RISK_PARAMS, LEVERAGE_POLICY } from "@lighter-bot/common";
import type { BotOrchestrator } from "../services/BotOrchestrator.js";

export async function registerRiskRoutes(app: FastifyInstance, orchestrator: BotOrchestrator) {
  app.get("/risk/state", async () => ({
    riskState: orchestrator.getRiskEngine().getState(),
    defaultParams: DEFAULT_RISK_PARAMS,
    leveragePolicy: LEVERAGE_POLICY,
  }));

  app.get("/risk/params", async () => ({
    params: DEFAULT_RISK_PARAMS,
    leveragePolicy: LEVERAGE_POLICY,
  }));
}
