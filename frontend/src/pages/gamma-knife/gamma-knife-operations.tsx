import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Input, LoadingState } from '@/components/shared';
import { gk, type OperationsDashboardData, type OperationsTask } from './api';
import { useGammaKnifeText } from './use-gamma-knife-text';

const PAGE_SIZE = 25;
type QueueName = keyof OperationsDashboardData['queues'];
type Offsets = Record<QueueName, number>;
type Owner = { id: number; name: string };
const COUNT_LABELS: Array<[keyof OperationsDashboardData['counts'], string]> = [
  ['scheduledToday', "Today's scheduled treatments"], ['awaitingScheduling', 'Patients awaiting scheduling'], ['notReady', 'Not ready for treatment'], ['pendingMdt', 'Pending MDT decisions'],
  ['outstandingInvestigations', 'Outstanding investigations'], ['unfinalizedTreatmentReports', 'Unfinalized treatment reports'], ['overdueFollowups', 'Overdue follow-ups'], ['pendingCorrectionRequests', 'Administrative correction requests'],
];
const TASK_LABELS: Record<string, string> = {
  treatment: 'Today treatment', upcoming_treatment: 'Upcoming treatment', clinical_assessment: 'Pending clinical assessment', mdt_decision: 'Awaiting MDT decision',
  treatment_scheduling: 'Allocate treatment appointment', followup_booking: 'Allocate follow-up appointment', entered_in_error: 'Entered-in-error referral needs resolution',
  interrupted_course: 'Treatment course interrupted', missing_report: 'Completed treatment is missing finalized documentation', identity_correction: 'Identity correction request awaiting review',
  appointment_reconciliation: 'Appointment needs reconciliation', scheduling_conflict: 'Same patient has overlapping appointments',
};
const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } as const;
const QUEUE_TITLES: Record<QueueName, string> = { todayTreatments: "Today's treatments", upcomingTreatments: 'Upcoming treatments', awaitingAction: 'Awaiting action', followUp: 'Follow-up workload', exceptions: 'Exceptions' };

function taskText(item: OperationsTask, tr: (message: string) => string) {
  const baseKey = item.taskKey.split(':', 1)[0]!;
  if (baseKey === 'investigation') return `${tr('Outstanding investigation')}: ${item.task.replace(/^Outstanding investigation:\s*/i, '')}`;
  if (TASK_LABELS[baseKey]) return tr(TASK_LABELS[baseKey]!);
  return tr(item.task);
}
function rowKey(item: OperationsTask) { return `${item.episodeId}:${item.taskKey}`; }

function Queue({ name, items, page, owners, canAssign, savingKey, saveErrors, saveSuccess, assign, onPage }: {
  name: QueueName;
  items: OperationsTask[];
  page: OperationsDashboardData['pagination'][QueueName];
  owners: Owner[];
  canAssign: boolean;
  savingKey: string | null;
  saveErrors: Record<string, string>;
  saveSuccess: string | null;
  assign: (item: OperationsTask, form: HTMLFormElement) => Promise<void>;
  onPage: (name: QueueName, offset: number) => void;
}) {
  const { tr, dateText, statusText, patientName } = useGammaKnifeText();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const title = QUEUE_TITLES[name];
  return <Card><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{tr(title)}</h2><p className="text-xs text-muted-foreground">{tr('Showing')} {page.total === 0 ? 0 : page.offset + 1}–{Math.min(page.offset + items.length, page.total)} {tr('of')} {page.total}</p></div>
    {items.length ? <ul className="mt-3 space-y-3">{items.map(item => {
      const key = rowKey(item);
      return <li key={key} className="rounded-md border border-border p-3">
        <Link className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" to={`/gamma-knife/episodes/${item.episodeId}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{patientName(item)}</p><p className="text-xs text-muted-foreground">{tr('MRN')} <bdi dir="ltr">{item.mrn}</bdi></p></div><Badge>{tr(PRIORITY_LABELS[item.priority])}</Badge></div>
          <p className="mt-2 text-sm">{taskText(item, tr)}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{tr('Responsible person')}: {item.owner ?? tr('Unassigned')}</span><span>{tr('Due date')}: {item.dueDate ? dateText(item.dueDate) : tr('Due date not set')}</span><span>{tr('Workflow status')}: {statusText(item.status)}</span><span>{tr('Task status')}: {statusText(item.assignmentStatus ?? 'open')}</span>{item.appointmentDate && <span>{tr('Appointment')}: {dateText(item.appointmentDate)} {item.appointmentTime?.slice(0,5) ?? ''}</span>}{item.ready !== undefined && <span>{tr('Preparation status')}: {tr(item.ready ? 'Ready' : 'Not ready')}</span>}{item.nextAction && <span className="font-medium">{tr('Next action:')} {tr(item.nextAction)}</span>}</div>
        </Link>
        {canAssign && <Button className="mt-3" size="sm" variant="secondary" aria-expanded={editingKey === key} onClick={() => setEditingKey(editingKey === key ? null : key)}>{tr(editingKey === key ? 'Close task editor' : 'Manage task')}</Button>}
        {canAssign && editingKey === key && <form className="mt-3 grid items-end gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_8rem_8rem_9rem_auto]" onSubmit={event => { event.preventDefault(); void assign(item, event.currentTarget); }}>
          <label className="block text-sm">{tr('Responsible person')}<select className="input-premium w-full" name="ownerUserId" defaultValue={item.ownerUserId ?? ''}><option value="">{tr('Unassigned')}</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          <label className="block text-sm">{tr('Due date')}<Input type="date" name="dueDate" defaultValue={item.dueDate ?? ''}/></label>
          <label className="block text-sm">{tr('Priority')}<select className="input-premium w-full" name="priority" defaultValue={item.priority}>{(['low','normal','high','urgent'] as const).map(priority => <option key={priority} value={priority}>{tr(PRIORITY_LABELS[priority])}</option>)}</select></label>
          <label className="block text-sm">{tr('Task status')}<select className="input-premium w-full" name="status" defaultValue={item.assignmentStatus ?? 'open'}>{(['open','in_progress','resolved','cancelled'] as const).map(status => <option key={status} value={status}>{statusText(status)}</option>)}</select></label>
          <Button size="sm" variant="secondary" disabled={savingKey === key || !owners.length}>{savingKey === key ? tr('Saving…') : tr('Save task')}</Button>
        </form>}
        {!owners.length && canAssign && <p className="mt-2 text-xs text-muted-foreground">{tr('No active Gamma Knife team members are available for assignment.')}</p>}
        {saveErrors[key] && <p role="alert" className="mt-2 text-sm text-destructive">{saveErrors[key]}</p>}
        {saveSuccess === key && <p role="status" className="mt-2 text-sm text-emerald-800">{tr('Task assignment saved.')}</p>}
      </li>;
    })}</ul> : <p className="mt-3 text-sm text-muted-foreground">{tr('No outstanding items.')}</p>}
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3"><p className="text-xs text-muted-foreground">{tr('Page')} {Math.floor(page.offset / page.limit) + 1}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page.offset === 0} onClick={() => onPage(name, Math.max(0, page.offset - page.limit))}>{tr('Previous')}</Button><Button variant="secondary" size="sm" disabled={page.offset + items.length >= page.total} onClick={() => onPage(name, page.offset + page.limit)}>{tr('Next')}</Button></div></div>
  </Card>;
}

export function GammaKnifeOperations() {
  const { tr, errorText } = useGammaKnifeText();
  const [offsets, setOffsets] = useState<Offsets>({ todayTreatments: 0, upcomingTreatments: 0, awaitingAction: 0, followUp: 0, exceptions: 0 });
  const [filters, setFilters] = useState({ responsibleUserId: '', status: '', priority: '', dueAfter: '', dueBefore: '' });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), todayOffset: String(offsets.todayTreatments), upcomingOffset: String(offsets.upcomingTreatments), awaitingOffset: String(offsets.awaitingAction), followUpOffset: String(offsets.followUp), exceptionsOffset: String(offsets.exceptions), ...Object.fromEntries(Object.entries(filters).filter(([,value]) => value)) });
  const query = useQuery({ queryKey: ['gamma-knife','operations',offsets,filters], queryFn: () => gk<OperationsDashboardData>(`/operations?${params}`, undefined, 'GET'), retry: false, refetchInterval: 60_000 });
  const owners = useQuery({ queryKey: ['gamma-knife','investigation-assignees'], queryFn: () => gk<{ users: Owner[] }>('/investigation-assignees', undefined, 'GET'), retry: false });
  const assign = async (item: OperationsTask, form: HTMLFormElement) => {
    const key = rowKey(item);
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setSaveErrors(current => ({ ...current, [key]: '' })); setSaveSuccess(null); setSavingKey(key);
    try {
      await gk(`/episodes/${item.episodeId}/operation-tasks`, { revision: item.episodeRevision, taskKey: item.taskKey, ownerUserId: values.ownerUserId || null, dueDate: values.dueDate || null, priority: values.priority, status: values.status }, 'PUT');
      await queryClient.invalidateQueries({ queryKey: ['gamma-knife','operations'] });
      setSaveSuccess(key);
    } catch (error) { setSaveErrors(current => ({ ...current, [key]: error instanceof Error ? errorText(error.message) : tr('Save failed.') })); }
    finally { setSavingKey(null); }
  };
  if (query.isPending) return <LoadingState message={tr('Loading…')}/>;
  if (query.error) return <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={() => void query.refetch()}/>;
  const data = query.data;
  const canAssign = true;
  const setOffset = (name: QueueName, offset: number) => setOffsets(previous => ({ ...previous, [name]: offset }));
  const renderQueue = (name: QueueName) => <Queue key={name} name={name} items={data.queues[name]} page={data.pagination[name]} owners={owners.data?.users ?? []} canAssign={canAssign} savingKey={savingKey} saveErrors={saveErrors} saveSuccess={saveSuccess} assign={assign} onPage={setOffset}/>;
  return <div className="space-y-4" data-testid="gamma-knife-operations-dashboard">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-semibold">{tr('Operations dashboard')}</h2><p className="mt-1 text-sm text-muted-foreground">{tr('Live Gamma Knife workload and next actions.')}</p></div><Button variant="secondary" size="sm" onClick={() => void query.refetch()}>{tr('Refresh')}</Button></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={tr('Live workload counts')}>{COUNT_LABELS.map(([key,label]) => <Card key={key} className="space-y-1"><p className="text-sm text-muted-foreground">{tr(label)}</p><p className="text-3xl font-semibold tabular-nums" aria-live="polite">{data.counts[key]}</p></Card>)}</section>
    <Card><h2 className="font-semibold">{tr('Filter work queues')}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <label className="block text-sm">{tr('Responsible person')}<select className="input-premium w-full" value={filters.responsibleUserId} onChange={event => { setFilters({...filters,responsibleUserId:event.target.value}); setOffsets({todayTreatments:0,upcomingTreatments:0,awaitingAction:0,followUp:0,exceptions:0}); }}><option value="">{tr('All responsible people')}</option>{owners.data?.users.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label className="block text-sm">{tr('Task status')}<select className="input-premium w-full" value={filters.status} onChange={event => setFilters({...filters,status:event.target.value})}><option value="">{tr('All task statuses')}</option>{(['open','in_progress','resolved','cancelled'] as const).map(status => <option key={status} value={status}>{tr(status)}</option>)}</select></label>
      <label className="block text-sm">{tr('Priority')}<select className="input-premium w-full" value={filters.priority} onChange={event => setFilters({...filters,priority:event.target.value})}><option value="">{tr('All priorities')}</option>{(['low','normal','high','urgent'] as const).map(priority => <option key={priority} value={priority}>{tr(PRIORITY_LABELS[priority])}</option>)}</select></label>
      <label className="block text-sm">{tr('Due from')}<Input type="date" value={filters.dueAfter} onChange={event => setFilters({...filters,dueAfter:event.target.value})}/></label>
      <label className="block text-sm">{tr('Due through')}<Input type="date" value={filters.dueBefore} onChange={event => setFilters({...filters,dueBefore:event.target.value})}/></label>
    </div>{owners.error && <p role="status" className="mt-2 text-sm text-muted-foreground">{tr('Task assignment controls are unavailable.')}</p>}</Card>
    {renderQueue('todayTreatments')}{renderQueue('upcomingTreatments')}{renderQueue('awaitingAction')}{renderQueue('followUp')}{renderQueue('exceptions')}
  </div>;
}
