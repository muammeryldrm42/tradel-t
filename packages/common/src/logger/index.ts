import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  transport: process.env["LOG_PRETTY"] === "true" ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } } : undefined,
  base: { service: "lighter-bot" },
  redact: { paths: ["*.apiKey", "*.privateKey", "*.secret", "*.password", "*.token"], censor: "[REDACTED]" },
});

export function createChildLogger(context: Record<string, string>) {
  return logger.child(context);
}
export type Logger = typeof logger;
