import type { DicomGatewayServer } from "./dicom-gateway-service.js";
import type { ChildProcess } from "child_process";

// ---------------------------------------------------------------------------
// Service registry for managing DICOM gateway processes
// ---------------------------------------------------------------------------

interface ServiceEntry {
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  process: ChildProcess | null;
  server: DicomGatewayServer | null;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
}

interface ServiceRegistry {
  mwl: ServiceEntry;
  mpps: ServiceEntry;
  worklistBuilder: ServiceEntry;
  mppsProcessor: ServiceEntry;
}

// In-memory registry (will be populated from server.ts)
const registry: ServiceRegistry = {
  mwl: { status: "stopped", process: null, server: null, pid: null, startedAt: null, lastError: null },
  mpps: { status: "stopped", process: null, server: null, pid: null, startedAt: null, lastError: null },
  worklistBuilder: { status: "stopped", process: null, server: null, pid: null, startedAt: null, lastError: null },
  mppsProcessor: { status: "stopped", process: null, server: null, pid: null, startedAt: null, lastError: null }
};

export function getServiceStatus(serviceName: keyof ServiceRegistry): ServiceEntry {
  return registry[serviceName];
}

export function getAllServiceStatuses(): Record<string, ServiceEntry> {
  return { ...registry };
}

export function setServiceProcess(
  serviceName: keyof ServiceRegistry,
  process: ChildProcess | null,
  server: DicomGatewayServer | null
): void {
  const entry = registry[serviceName];
  entry.process = process;
  entry.server = server;
  entry.pid = process?.pid ?? null;
  entry.status = process ? "running" : "stopped";
  entry.startedAt = process ? new Date().toISOString() : null;
  entry.lastError = null;
}

export function setServiceError(serviceName: keyof ServiceRegistry, error: string): void {
  const entry = registry[serviceName];
  entry.status = "error";
  entry.lastError = error;
}

export function setServiceStatus(serviceName: keyof ServiceRegistry, status: ServiceEntry["status"]): void {
  registry[serviceName].status = status;
}

export function getServiceServer(serviceName: keyof ServiceRegistry): DicomGatewayServer | null {
  return registry[serviceName].server;
}

export function getServiceProcess(serviceName: keyof ServiceRegistry): ChildProcess | null {
  return registry[serviceName].process;
}
