import pino from "pino";

let _logger: pino.Logger | null = null;

export function createLogger(level: string, format: string): pino.Logger {
  _logger = pino({
    level,
    transport: format === "pretty" ? { target: "pino-pretty" } : undefined,
  });
  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({ level: "info" });
  }
  return _logger;
}
