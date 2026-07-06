export type LogLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityDomain =
  | "appointments"
  | "doctor-portal"
  | "reporting-board"
  | "dicom"
  | "pacs"
  | "qr-patient-portal"
  | "comparison-requests"
  | "system"
  | (string & {});

export interface LoggerContext {
  requestId?: string;
  jobId?: string;
  domain?: ObservabilityDomain;
}

export interface LogEventInput {
  eventName: string;
  level?: LogLevel;
  requestId?: string;
  jobId?: string;
  domain?: ObservabilityDomain;
  fields?: Record<string, unknown>;
}

export interface LogRecord extends LoggerContext {
  timestamp: string;
  level: LogLevel;
  eventName: string;
  fields?: Record<string, unknown>;
}
