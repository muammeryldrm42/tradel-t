/**
 * Fastify API Server
 * Backend control plane for the trading bot dashboard.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { loadAppConfig } from "@lighter-bot/common";
import { createChildLogger } from "@lighter-bot/common";
import { BotOrchestrator } from "./services/BotOrchestrator.js";

import { registerBotRoutes } from "./routes/bot.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerRiskRoutes } from "./routes/risk.js";
import { registerTradeRoutes } from "./routes/trades.js";
import { registerBacktestRoutes } from "./routes/backtests.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerAuditRoutes } from "./routes/audit.js";

const log = createChildLogger({ module: "api-server" });

export async function createServer() {
  const config = loadAppConfig();

  const app = Fastify({
    logger: config.logging.level !== "info" ? {
      level: config.logging.level,
      transport: config.logging.pretty ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      } : undefined,
    } : false,
    trustProxy: true,
  });

  // ── CORS ───────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: config.api.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  // ── JWT ────────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: config.api.jwtSecret,
  });

  // ── WebSocket ──────────────────────────────────────────────────────────────
  await app.register(websocket);

  // ── Global error handler ───────────────────────────────────────────────────
 app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
  log.error({ err: error, url: request.url }, "Request error");
  reply.status((error as any).statusCode ?? 500).send({
    error: { message: error.message, code: (error as any).code ?? "INTERNAL_ERROR" },
  });
});

  // ── Initialize bot orchestrator ────────────────────────────────────────────
  const orchestrator = new BotOrchestrator();

  // ── Health check ───────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    mode: config.execution.mode,
    dryRun: config.execution.dryRun,
    botStatus: orchestrator.getBotState().status,
    timestamp: new Date().toISOString(),
  }));

  // ── Metrics endpoint ───────────────────────────────────────────────────────
  app.get("/metrics", async () => {
    const state = orchestrator.getBotState();
    const summary = orchestrator.getPaperSummary();
    return {
      bot_status: state.status,
      bot_mode: state.mode,
      active_positions: state.activePositions,
      daily_trades: state.dailyTrades,
      kill_switch: state.killSwitchActive,
      circuit_breaker: state.circuitBreakerTripped,
      paper_balance: summary.balance,
      paper_realized_pnl: summary.realizedPnl,
      paper_open_positions: summary.openPositions,
      uptime_ms: state.startedAt ? Date.now() - state.startedAt : 0,
    };
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(
    async (api) => {
      await registerBotRoutes(api, orchestrator);
      await registerMarketRoutes(api, orchestrator);
      await registerRiskRoutes(api, orchestrator);
      await registerTradeRoutes(api, orchestrator);
      await registerBacktestRoutes(api);
      await registerMetricsRoutes(api, orchestrator);
      await registerAuditRoutes(api);
    },
    { prefix: "/api/v1" }
  );

  // ── WebSocket live updates ─────────────────────────────────────────────────
  app.register(async (wsApp) => {
    wsApp.get("/ws", { websocket: true }, (socket) => {
      log.info("WebSocket client connected to API");

      const interval = setInterval(() => {
        const state = orchestrator.getBotState();
        const summary = orchestrator.getPaperSummary();
        socket.send(JSON.stringify({
          type: "state_update",
          botState: state,
          paperSummary: summary,
          timestamp: Date.now(),
        }));
      }, 2000);

     socket.on("message", (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString()) as { action: string; reason?: string };
          if (msg.action === "kill_switch") {
            orchestrator.activateKillSwitch(msg.reason ?? "Operator via WS");
          } else if (msg.action === "reset_circuit_breaker") {
            orchestrator.resetCircuitBreaker();
          }
        } catch {}
      });

      socket.on("close", () => {
        clearInterval(interval);
      });
    });
  });

  return { app, orchestrator, config };
}

// ── Server entry point ────────────────────────────────────────────────────────

async function main() {
  const { app, config } = await createServer();

  try {
   await app.listen({
  port: parseInt(process.env["PORT"] ?? String(config.api.port)),
  host: config.api.host,
});
    });
    log.info(
      { port: config.api.port, mode: config.execution.mode },
      `Lighter Bot API listening`
    );
  } catch (err) {
    log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

main();
