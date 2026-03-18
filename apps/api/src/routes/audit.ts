import type { FastifyInstance } from "fastify";
export async function registerAuditRoutes(app: FastifyInstance) {
  app.get("/audit", async () => ({
    events: [],
    message: "Connect Prisma to list audit events.",
  }));
}
