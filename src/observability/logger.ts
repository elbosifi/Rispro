import type { LogEventInput, LogLevel, LogRecord, LoggerContext } from "./events.js";

const PHI_FIELD_PATTERN = /(^|_)(patient|name|national.?id|mrn|medical.?record|phone|accession|clinical|note|free.?text)($|_)/i;

function sanitizeFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (PHI_FIELD_PATTERN.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = PHI_FIELD_PATTERN.test(key) ? "[redacted]" : sanitizeValue(nestedValue);
  }
  return sanitized;
}

export function buildLogRecord(input: LogEventInput, context: LoggerContext = {}): LogRecord {
  const fields = sanitizeFields(input.fields);
  return {
    timestamp: new Date().toISOString(),
    level: input.level ?? "info",
    eventName: input.eventName,
    domain: input.domain ?? context.domain,
    requestId: input.requestId ?? context.requestId,
    jobId: input.jobId ?? context.jobId,
    ...(fields && Object.keys(fields).length ? { fields } : {})
  };
}

export function logEvent(input: LogEventInput, context: LoggerContext = {}): void {
  writeLine(input.level ?? "info", JSON.stringify(buildLogRecord(input, context)));
}

export function createLogger(context: LoggerContext = {}) {
  return {
    event(input: LogEventInput): void {
      logEvent(input, context);
    },
    debug(eventName: string, fields?: Record<string, unknown>): void {
      logEvent({ eventName, level: "debug", fields }, context);
    },
    info(eventName: string, fields?: Record<string, unknown>): void {
      logEvent({ eventName, level: "info", fields }, context);
    },
    warn(eventName: string, fields?: Record<string, unknown>): void {
      logEvent({ eventName, level: "warn", fields }, context);
    },
    error(eventName: string, fields?: Record<string, unknown>): void {
      logEvent({ eventName, level: "error", fields }, context);
    }
  };
}

function writeLine(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
