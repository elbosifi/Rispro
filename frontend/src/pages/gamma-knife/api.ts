import { api } from '@/lib/api-client';
export { PERMISSIONS, CATEGORIES, STATUS_LABELS, nextAction } from '../../../../src/modules/gamma-knife/gamma-knife-types';
export type { Config, Episode, Clinical, Permission, EpisodeDocument } from '../../../../src/modules/gamma-knife/gamma-knife-types';
import type { Config, Episode, Permission, EpisodeDocument } from '../../../../src/modules/gamma-knife/gamma-knife-types';
export type Appointment = { id: number; date: string; time: string | null; status: string; examTypeId: number };
export type Profile = { episode: Episode; config: Config; permissions: Permission[]; documents: EpisodeDocument[]; appointments: Appointment[]; nextAction: string; history: { revision: number; action: string; actor: string; createdAt: string; snapshot: { reason?: string; data: Episode['data']; status: string } }[]; episodes: { id: number; status: string }[] };
export type Settings = { config: Config; users: { id: number; name: string; role: string; active: boolean; permissions: Permission[] }[]; exams: { id: number; name: string; arabicName: string | null }[]; smsAvailable: false };
export type PublicView = { progress: string; appointments: { purpose: string; date: string; time: string | null }[]; actions: string; instructions: string; documents: { id: number; name: string }[] };
export const gk = <T,>(path: string, body?: unknown, method = 'POST') => api<T>(`/gamma-knife${path}`, body === undefined ? {} : { method, body: JSON.stringify(body) });
export const action = (episode: Episode, name: string, body: object = {}) => gk<{ episode: Episode; token?: string; url?: string; qrImage?: string }>(`/episodes/${episode.id}/actions/${name}`, { ...body, revision: episode.revision });
export const publicView = (token: string) => api<PublicView>('/public/gamma-knife', { headers: { Authorization: `Bearer ${token}` } });
export async function loadPublicDocument(token: string, id: number): Promise<Blob> {
  const response = await fetch(`/api/public/gamma-knife/documents/${id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!response.ok) throw new Error('Document is unavailable.');
  return response.blob();
}
export const splitLines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
