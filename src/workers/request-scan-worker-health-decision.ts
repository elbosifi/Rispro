export type RequestScanWorkerHealthRuntime = {
  worker_id: string | null;
  worker_heartbeat_at: string | null;
  cycle_started_at: string | null;
  cycle_completed_at: string | null;
};

export function decideRequestScanWorkerHealth(runtime: RequestScanWorkerHealthRuntime, now = new Date(), staleMs = 60_000): { healthy: boolean; message: string } {
  if (!runtime.worker_id) return { healthy: false, message: "Request Scan worker is not registered." };
  if (!runtime.worker_heartbeat_at || now.getTime() - new Date(runtime.worker_heartbeat_at).getTime() >= staleMs) return { healthy: false, message: "Request Scan worker heartbeat is stale." };
  if (runtime.cycle_started_at && runtime.cycle_completed_at && new Date(runtime.cycle_completed_at) > new Date(runtime.cycle_started_at)) return { healthy: false, message: "Request Scan worker runtime cycle state is invalid." };
  return { healthy: true, message: "Request Scan worker heartbeat is healthy." };
}
