import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Checkbox, DisclosureSection, EmptyState, Input, Textarea } from '@/components/shared';
import { gk, type Profile, type ReadinessItem } from './api';
import { useGammaKnifeText } from './use-gamma-knife-text';

type ResourceCommand = (path: string, body: object, method?: 'POST' | 'PATCH' | 'PUT') => Promise<void>;
function values(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; }

export function ReadinessPanel({ profile, busy, run }: { profile: Profile; busy: boolean; run: ResourceCommand }) {
  const { tr, dateText } = useGammaKnifeText();
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const canManage = profile.permissions.includes('scheduling') && profile.episode.active;
  const owners = useQuery({ queryKey: ['gamma-knife', 'investigation-assignees'], queryFn: () => gk<{ users: Array<{ id: number; name: string }> }>('/investigation-assignees'), enabled: canManage, retry: false });
  if (!profile.readinessItems.length && !canManage) return null;
  return <Card><DisclosureSection title={tr('Treatment readiness checklist')}>
    <p className="mb-3 text-sm text-muted-foreground">{tr('Required operational items must be completed before readiness can be confirmed. Physician approval, treatment verification and machine QA remain separate gates.')}</p>
    {profile.readinessItems.length ? <ul className="space-y-2">{profile.readinessItems.map((item: ReadinessItem) => <li key={item.id} className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{tr(item.label)}</p><p className="text-xs text-muted-foreground">{tr(item.required ? 'Required' : 'Optional')} · {tr(item.status)} · {item.responsibleName ?? tr('Unassigned')}{item.dueDate ? ` · ${dateText(item.dueDate)}` : ''}{item.completedAt ? ` · ${tr('Completed by')} ${item.completedBy ?? tr('Unknown')} ${dateText(item.completedAt.slice(0,10))}` : ''}</p>{item.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>}</div>{canManage && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setAddingItem(false); setEditingItem(editingItem === item.id ? null : item.id); }}>{tr(editingItem === item.id ? 'Close item editor' : 'Edit checklist item')}</Button>}</div>
      {canManage && editingItem === item.id && <form className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1.2fr)_8rem_9rem_9rem_minmax(10rem,1fr)_auto]" onSubmit={event => { const f = values(event); void run(`/episodes/${profile.episode.id}/readiness/${item.id}`, { required: f.required === 'on', status: f.status, responsibleUserId: f.responsibleUserId || null, dueDate: f.dueDate || null, priority: f.priority, notes: f.notes, reason: f.reason }, 'PUT'); }}>
        <label className="flex items-center gap-2 text-sm"><Checkbox name="required" defaultChecked={item.required}/>{tr('Required')}</label>
        <label className="block text-sm">{tr('Status')}<select name="status" className="input-premium w-full" defaultValue={item.status}><option value="pending">{tr('Pending')}</option><option value="in_progress">{tr('In progress')}</option><option value="completed">{tr('Completed')}</option></select></label>
        <label className="block text-sm">{tr('Responsible person')}<select name="responsibleUserId" className="input-premium w-full" defaultValue={item.responsibleUserId ?? ''}><option value="">{tr('Unassigned')}</option>{owners.data?.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><label className="block text-sm">{tr('Due date')}<Input name="dueDate" type="date" defaultValue={item.dueDate ?? ''}/></label><label className="block text-sm">{tr('Priority')}<select name="priority" className="input-premium w-full" defaultValue={item.priority}>{['low','normal','high','urgent'].map(priority => <option key={priority} value={priority}>{tr(priority)}</option>)}</select></label></div>
        <label className="block text-sm">{tr('Notes')}<Input name="notes" defaultValue={item.notes}/></label>
        <label className="block text-sm lg:col-span-5">{tr('Reason for readiness change')}<Input name="reason" required maxLength={1000}/></label>
        <div className="flex gap-2 lg:col-span-6"><Button disabled={busy}>{tr('Save readiness item')}</Button><Button type="button" variant="secondary" onClick={() => setEditingItem(null)}>{tr('Cancel')}</Button></div>
      </form>}
    </li>)}</ul> : <EmptyState message={tr('No readiness items recorded.')}/>}
    {canManage && <div className="mt-3 border-t border-border pt-3">{!addingItem ? <Button variant="secondary" disabled={busy} onClick={() => { setEditingItem(null); setAddingItem(true); }}>{tr('Add readiness item')}</Button> : <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { const f = values(event); void run(`/episodes/${profile.episode.id}/readiness`, { label: f.label, required: f.required === 'on', responsibleUserId: f.responsibleUserId || null, dueDate: f.dueDate || null, priority: f.priority, notes: f.notes, reason: f.reason }); }}>
      <label className="block text-sm sm:col-span-2">{tr('Additional readiness item')}<Input name="label" required maxLength={250}/></label><label className="flex items-center gap-2 text-sm"><Checkbox name="required" defaultChecked/>{tr('Required')}</label>
      <label className="block text-sm">{tr('Responsible person')}<select name="responsibleUserId" className="input-premium w-full" defaultValue=""><option value="">{tr('Unassigned')}</option>{owners.data?.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label className="block text-sm">{tr('Due date')}<Input name="dueDate" type="date"/></label><label className="block text-sm">{tr('Priority')}<select name="priority" className="input-premium w-full" defaultValue="normal">{['low','normal','high','urgent'].map(priority => <option key={priority} value={priority}>{tr(priority)}</option>)}</select></label>
      <label className="block text-sm sm:col-span-2">{tr('Notes')}<Textarea name="notes" dir="auto" rows={2}/></label><label className="block text-sm sm:col-span-2">{tr('Reason')}<Input name="reason" required maxLength={1000}/></label><div className="flex gap-2 sm:col-span-2"><Button disabled={busy}>{tr('Add readiness item')}</Button><Button type="button" variant="secondary" onClick={() => setAddingItem(false)}>{tr('Cancel')}</Button></div>
    </form>}</div>}
  </DisclosureSection></Card>;
}

export function CommunicationPanel({ profile, busy, run, defaultOpen = false }: { profile: Profile; busy: boolean; run: ResourceCommand; defaultOpen?: boolean }) {
  const { tr, dateText, language } = useGammaKnifeText();
  const canManage = profile.permissions.includes('scheduling');
  return <Card><DisclosureSection title={tr('Patient communication log')} defaultOpen={defaultOpen}>
    {profile.communications.length ? <ol className="space-y-3">{profile.communications.map(item => <li key={item.id} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{tr(item.kind)} · {item.createdBy}</p><time className="text-sm text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(language === 'ar' ? 'ar-LY' : 'en-GB', { timeZone: 'Africa/Tripoli' })}</time></div><p className="text-sm">{tr('Outcome')}: {item.outcome}</p>{item.notes && <p className="whitespace-pre-wrap text-sm">{item.notes}</p>}{item.nextAction && <p className="text-sm">{tr('Next action')}: {item.nextAction}{item.nextActionDate ? ` · ${dateText(item.nextActionDate)}` : ''}</p>}</li>)}</ol> : <EmptyState message={tr('No communication entries recorded.')}/>}
    {canManage && <form className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2" onSubmit={event => { const f = values(event); void run(`/episodes/${profile.episode.id}/communications`, { kind: f.kind, outcome: f.outcome, notes: f.notes, nextAction: f.nextAction, nextActionDate: f.nextActionDate || null }); }}>
      <label className="block text-sm">{tr('Communication type')}<select name="kind" className="input-premium w-full"><option value="telephone_attempt">{tr('Telephone contact attempt')}</option><option value="successful_contact">{tr('Successful patient contact')}</option><option value="appointment_confirmed">{tr('Appointment confirmed')}</option><option value="unreachable">{tr('Patient unavailable or unreachable')}</option><option value="postponement_requested">{tr('Patient requested postponement')}</option><option value="treatment_declined">{tr('Patient declined treatment')}</option><option value="followup_reminder">{tr('Follow-up reminder')}</option></select></label>
      <label className="block text-sm">{tr('Outcome')}<Input name="outcome" required maxLength={250}/></label><label className="block text-sm sm:col-span-2">{tr('Notes')}<Textarea name="notes" dir="auto" rows={2}/></label><label className="block text-sm">{tr('Next action')}<Input name="nextAction" maxLength={250}/></label><label className="block text-sm">{tr('Next action date')}<Input name="nextActionDate" type="date"/></label><Button className="sm:col-span-2" disabled={busy}>{tr('Record communication')}</Button>
    </form>}
  </DisclosureSection></Card>;
}
