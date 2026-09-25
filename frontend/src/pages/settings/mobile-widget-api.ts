import { api } from "@/lib/api-client";
export interface WidgetCounts {
  totalAppointments: number; scheduled: number; arrived: number; waiting: number; inProgress: number;
  inQueue: number; completed: number; noShow: number; cancelled: number; discontinued: number; voided: number; walkIn: number;
}
export interface WidgetSummary {
  schemaVersion: 1; date: string; timezone: string; generatedAt: string; totals: WidgetCounts;
  waiting: { count: number; oldestWaitingMinutes: number | null; over30Minutes: number; over60Minutes: number; unknownDurationCount: number };
  modalities: (WidgetCounts & { modalityId: number; code: string; nameEn: string; nameAr: string })[];
}
export interface WidgetToken {
  id: string; deviceName: string; tokenPrefix: string; scope: string; createdAt: string;
  createdBy: string; createdByName: string; expiresAt: string; lastUsedAt: string | null;
  revokedAt: string | null; status: "active" | "expired" | "revoked";
}
export const widgetKeys = { tokens: ["settings", "mobile-widget", "tokens"], preview: ["settings", "mobile-widget", "preview"] };
const root = "/settings/mobile-widget";
export const fetchWidgetTokens = () => api<{ tokens: WidgetToken[] }>(`${root}/tokens`);
export const fetchWidgetPreview = () => api<WidgetSummary>(`${root}/preview`);
export const mutateWidgetToken = (path: string, body: unknown) => api<{ secret?: string }>(`${root}/tokens${path}`, { method: "POST", body: JSON.stringify(body) });
