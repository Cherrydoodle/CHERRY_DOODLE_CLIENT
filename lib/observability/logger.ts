import "server-only";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const candidate = process.env.LOG_LEVEL;
  return candidate === "debug" || candidate === "warn" || candidate === "error" ? candidate : "info";
}

function write(level: LogLevel, message: string, fields: LogFields = {}) {
  if (priorities[level] < priorities[configuredLevel()]) return;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    deploymentVersion: process.env.DEPLOYMENT_VERSION ?? "development",
    ...fields,
  });

  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
