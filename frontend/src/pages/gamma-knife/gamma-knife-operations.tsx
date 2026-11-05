import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorState, Input, LoadingState } from '@/components/shared';
import { gk, type OperationsDashboardData, type OperationsTask } from './api';
import { useGammaKnifeText } from './use-gamma-knife-text';

const PAGE_SIZE = 25;
const COUNT_LABELS: Array<[keyof OperationsDashboardData['counts'], string]> = [
  ['scheduledToday', "Today's scheduled treatments"], ['awaitingScheduling', 'Patients awaiting scheduling'], ['notReady', 'Not ready for treatment'], ['pendingMdt', 'Pending MDT decisions'],
  ['outstandingInvestigations', 'Outstanding investigations'], ['unfinalizedTreatmentReports', 'Unfinalized treatment reports'], ['overdueFollowups', 'Overdue follow-ups'], ['pendingCorrectionRequests', 'Administrative correction requests'],
];
const TASK_LABELS: Record<string, string> = {
  treatment: "Today's treatment", upcoming_treatment: 'Upcoming treatment', clinical_assessment: 'Pending clinical assessment', mdt_decision: 'Awaiting MDT decision',
  treatment_scheduling: 'Allocate treatment appointment', followup_booking: 'Allocate follow-up appointment', followup: 'Follow-up',
  entered_in_error: 'Entered-in-error referral needs resolution', interrupted_course: 'Treatment course interrupted', missing_report: 'Completed treatment is missing finalized documentation', identity_correction: 'Identity correction request awaiting review', scheduling_conflict: 'Same patient has overlapping appointments',
};
const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } as const;

function taskText(item: OperationsTask, tr: (message: string) => string) {
  const baseKey = item.taskKey.split(':', 1)[0]!;
  if (baseKey === 'investigation') return `${tr('Outstanding investigation')}: ${item.task.replace(/^Outstanding investigation:\s*/i, '')}`;
  if (baseKey === 'followup') return tr(item.task);
  if (TASK_LABELS[baseKey]) return tr(TASK_LABELS[baseKey]!);
  return tr(item.task);
}

function Queue({ title, items, owners, canAssign, assign }: {
  title: string;
  items: OperationsTask[];
  owners: Array<{ id: number; name: string }>;
  canAssign: boolean;
  assign: (item: OperationsTask, form: HTMLFormElement) => Promise<void>;
}) {
  const { tr, dateText, statusText, patientName } = useGammaKnifeText();
  return <Card><h2 className="text-lg font-semibold">{tr(title)}</h2>{items.length ? <ul className="mt-3 space-y-3">{items.map((item, index) => <li key={`${item.taskKey}-${item.episodeId}-${item.bookingId ?? index}`} className="rounded-md border border-border p-3">
    <Link className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" to={`/gamma-knife/episodes/${item.episodeId}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{patientName(item)}</p><p className="text-xs text-muted-foreground">{tr('MRN')} <bdi dir="ltr">{item.mrn}</bdi></p></div><Badge>{tr(PRIORITY_LABELS[item.priority])}</Badge></div>
      <p className="mt-2 text-sm">{taskText(item, tr)}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{tr('Responsible person')}: {item.owner ?? tr('Unassigned')}</span><span>{tr('Due date')}: {item.dueDate ? dateText(item.dueDate) : tr('Due date not set')}</span><span>{tr('Status')}: {statusText(item.status)}</span>{item.appointmentDate && <span>{tr('Appointment')}: {dateText(item.appointmentDate)} {item.appointmentTime?.slice(0,5) ?? ''}</span>}{item.ready !== undefined && <span>{tr('Preparation status')}: {tr(item.ready ? 'Ready' : 'Not ready')}</span>}{item.nextAction && <span className="font-medium">{tr('Next action:')} {tr(item.nextAction)}</span>}</div>
    </Link>
    {canAssign && <form className="mt-3 grid items-end gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_9rem_8rem_auto]" onSubmit={event => { event.preventDefault(); void assign(item, event.currentTarget); }}>
      <label className="block text-sm">{tr('Responsible person')}<select className="input-premium w-full" name="ownerUserId" defaultValue={item.ownerUserId ?? ''}><option value="">{tr('Unassigned')}</option>{owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label className="block text-sm">{tr('Due date')}<Input type="date" name="dueDate" defaultValue={item.dueDate ?? ''}/></label>
      <label className="block text-sm">{tr('Priority')}<select className="input-premium w-full" name="priority" defaultValue={item.priority}>{(['low','normal','high','urgent'] as const).map(priority => <option key={priority} value={priority}>{tr(PRIORITY_LABELS[priority])}</option>)}</select></label>
      <Button size="sm" variant="secondary" disabled={!owners.length}>{tr('Save task assignment')}</Button>
    </form>}
  </li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{tr('No outstanding items.')}</p>}</Card>;
}

export function GammaKnifeOperations() {
  const { tr, errorText } = useGammaKnifeText();
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['gamma-knife','operations',offset], queryFn: () => gk<OperationsDashboardData>(`/operations?limit=${PAGE_SIZE}&offset=${offset}`, undefined, 'GET'), retry: false, refetchInterval: 60_000 });
  const owners = useQuery({ queryKey: ['gamma-knife','investigation-assignees'], queryFn: () => gk<{ users: Array<{ id: number; name: string }> }>('/investigation-assignees', undefined, 'GET'), retry: false });
  const [saveError, setSaveError] = useState('');
  const assign = async (item: OperationsTask, form: HTMLFormElement) => {
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setSaveError('');
    try {
      await gk(`/episodes/${item.episodeId}/operation-tasks`, { revision: item.episodeRevision, taskKey: item.taskKey, ownerUserId: values.ownerUserId || null, dueDate: values.dueDate || null, priority: values.priority }, 'PUT');
      await queryClient.invalidateQueries({ queryKey: ['gamma-knife','operations'] });
    } catch (error) { setSaveError(error instanceof Error ? errorText(error.message) : tr('Save failed.')); }
  };
  if (query.isPending) return <LoadingState message={tr('Loading…')}/>;
  if (query.error) return <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={() => void query.refetch()}/>;
  const data = query.data;
  const queues = [data.queues.todayTreatments,data.queues.upcomingTreatments,data.queues.awaitingAction,data.queues.followUp,data.queues.exceptions];
  const canAssign = Boolean(owners.data?.users.length);
  return <div className="space-y-4" data-testid="gamma-knife-operations-dashboard">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-semibold">{tr('Operations dashboard')}</h2><p className="mt-1 text-sm text-muted-foreground">{tr('Live Gamma Knife workload and next actions.')}</p></div><Button variant="secondary" size="sm" onClick={() => void query.refetch()}>{tr('Refresh')}</Button></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={tr('Live workload counts')}>{COUNT_LABELS.map(([key,label]) => <Card key={key} className="space-y-1"><p className="text-sm text-muted-foreground">{tr(label)}</p><p className="text-3xl font-semibold tabular-nums" aria-live="polite">{data.counts[key]}</p></Card>)}</section>
    {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
    {owners.error && <p role="status" className="text-sm text-muted-foreground">{tr('Task assignment controls are unavailable.')}</p>}
    <Queue title="Today's treatments" items={data.queues.todayTreatments} owners={owners.data?.users ?? []} canAssign={canAssign} assign={assign}/>
    <Queue title="Upcoming treatments" items={data.queues.upcomingTreatments} owners={owners.data?.users ?? []} canAssign={canAssign} assign={assign}/>
    <Queue title="Awaiting action" items={data.queues.awaitingAction} owners={owners.data?.users ?? []} canAssign={canAssign} assign={assign}/>
    <Queue title="Follow-up workload" items={data.queues.followUp} owners={owners.data?.users ?? []} canAssign={canAssign} assign={assign}/>
    <Queue title="Exceptions" items={data.queues.exceptions} owners={owners.data?.users ?? []} canAssign={canAssign} assign={assign}/>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{tr('Page')} {Math.floor(offset / PAGE_SIZE) + 1} · {tr('Each queue is loaded from the server in pages.')}</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{tr('Previous')}</Button><Button variant="secondary" size="sm" disabled={queues.every(rows => rows.length < PAGE_SIZE)} onClick={() => setOffset(offset + PAGE_SIZE)}>{tr('Next')}</Button></div></div>
  </div>;
}
