import { useGammaKnifeText } from './use-gamma-knife-text';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, DisclosureSection, EmptyState, ErrorState, Input, LoadingState, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/shared';
import { ClinicalEditor } from './clinical-editor';
import { InvestigationPanel, ReassessmentPanel, ReassessmentRequest, TreatmentCourses } from './clinical-workflow-panels';
import { scanAppointmentRequest } from '@/lib/naps2-webscan';
import { ScanOptionsDisclosure } from '@/components/documents/scan-options-disclosure';
import { resolveEffectiveNaps2Endpoint } from '@/services/scanning/workstation-naps2-settings';
import { resolveEffectiveNaps2ScanPreferences, type Naps2ScanPreferenceOverrides } from '@/services/scanning/workstation-naps2-settings';
import { CATEGORIES, STATUS_LABELS, action, gk, splitLines, today, type Clinical, type Episode, type Profile } from './api';
type Command = (name: string, body: object) => Promise<void>;
type ResourceCommand = (path: string, body: object, method?: 'POST' | 'PATCH') => Promise<void>;
const PROFILE_TABS = ['Clinical', 'MDT', 'Treatment', 'Documents', 'Follow-up'] as const;
function historyAction(value: string, tr: (message: string) => string) {
    const labels: Record<string, string> = { referral: 'Register referral', clinical: 'Save draft', submit: 'Clinical assessment submitted', mdt: 'Record MDT decision', investigations: 'Investigations received', preparation: 'Preparation updated', appointment: 'Link appointment', confirm_appointment: 'Confirm appointment', postpone: 'Record postponement', completion: 'Record completed treatment', course_created: 'Treatment course created', course_complete: 'Treatment course completed', report: 'Finalize treatment documentation', followup: 'Save follow-up visit', followup_correct: 'Correct follow-up record', followup_void: 'Mark follow-up entered in error', close: 'Episode closed', document_visibility: 'Patient document visibility updated', document_correct: 'Correct document information', document_remove: 'Remove document from episode', document_upload: 'Document uploaded', qr_replace: 'QR code replaced', qr_revoke: 'QR code revoked' };
    return tr(labels[value] ?? 'Episode history');
}
function formValues(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; }
function StructuredClinicalSummary({ clinical }: { clinical?: Clinical }) {
    const { tr } = useGammaKnifeText(); const detail = clinical?.structuredDetails;
    if (!clinical?.diagnosisDetails && !detail) return null;
    return <DisclosureSection title={tr('Diagnosis-specific information')}><div className="space-y-2 text-sm">
      {detail?.diagnosis === 'brain_metastases' && <><h4 className="font-medium">{tr('Individual lesion documentation')} ({detail.lesions.length})</h4>{detail.lesions.map(lesion => <dl key={lesion.identifier} className="grid gap-x-4 gap-y-1 border-t border-border pt-2 sm:grid-cols-2"><dt>{tr('Lesion identifier')}</dt><dd>{lesion.identifier}</dd><dt>{tr('Lesion location')}</dt><dd>{lesion.location || tr('Not recorded')}</dd><dt>{tr('Measurements (mm)')}</dt><dd>{[lesion.lengthMm,lesion.widthMm,lesion.depthMm].map(value => value ?? '—').join(' × ')}</dd></dl>)}</>}
      {detail?.diagnosis === 'vestibular_schwannoma' && <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2"><dt>{tr('Laterality')}</dt><dd>{tr(detail.laterality || 'Not recorded')}</dd><dt>{tr('CPA/IAC imaging details')}</dt><dd className="whitespace-pre-wrap">{detail.cpaIacDetails || tr('Not recorded')}</dd><dt>{tr('Hearing assessment')}</dt><dd className="whitespace-pre-wrap">{detail.hearingAssessment || tr('Not recorded')}</dd><dt>{tr('Audiology or hearing test information')}</dt><dd className="whitespace-pre-wrap">{detail.audiology || tr('Not recorded')}</dd></dl>}
      {detail?.diagnosis === 'pituitary_parasellar' && <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2"><dt>{tr('Optic apparatus relationship')}</dt><dd className="whitespace-pre-wrap">{detail.opticApparatusRelationship || tr('Not recorded')}</dd><dt>{tr('Additional pituitary/parasellar assessment')}</dt><dd className="whitespace-pre-wrap">{detail.additionalAssessment || tr('Not recorded')}</dd></dl>}
      {detail?.diagnosis === 'trigeminal_neuralgia' && <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2"><dt>{tr('Pain history')}</dt><dd className="whitespace-pre-wrap">{detail.painHistory || tr('Not recorded')}</dd><dt>{tr('Pain assessment')}</dt><dd className="whitespace-pre-wrap">{detail.painAssessment || tr('Not recorded')}</dd><dt>{tr('Response to prior treatment')}</dt><dd className="whitespace-pre-wrap">{detail.priorTreatmentResponse || tr('Not recorded')}</dd></dl>}
      {clinical.diagnosisDetails && <p className="whitespace-pre-wrap border-t border-border pt-2">{clinical.diagnosisDetails}</p>}
    </div></DisclosureSection>;
}
function BookingLink({ profile, purpose, run, busy }: {
    profile: Profile;
    purpose: 'treatment' | 'followup';
    run: Command;
    busy: boolean;
}) {
    const { tr, statusText, dateText } = useGammaKnifeText();
    const { episode, config } = profile;
    const link = purpose === 'treatment' ? episode.data.treatmentAppointment : episode.data.followupAppointment;
    const expectedExam = purpose === 'treatment' ? config.treatmentExamTypeId : config.followupExamTypeId;
    const booking = profile.appointments.find(a => a.id === link?.bookingId);
    const editable = !profile.gammaKnifeOnly && profile.permissions.includes('scheduling') && episode.active && (purpose === 'treatment' ? ['preparation', 'treatment'].includes(episode.status) : episode.status === 'followup');
    return <section className="space-y-3 border-t border-border pt-3"><h3 className="font-semibold">{purpose === 'treatment' ? tr("Treatment appointment") : tr("Next follow-up appointment")}</h3>
    {link && <p className="text-sm">{booking ? `${dateText(booking.date)} ${booking.time?.slice(0, 5) ?? ''} · ${statusText(booking.status)}` : tr("Linked appointment")} · {link.postponed ? tr("Postponed") : link.confirmed ? tr("Confirmed") : tr("Tentative")}</p>}
    {purpose === 'treatment' && episode.data.treatment?.completed && booking?.status === 'scheduled' && <p role="status" className="text-sm border-s-2 border-border ps-3">{tr('Treatment completion is recorded, but this RISpro booking is still marked scheduled. Reconcile the appointment status with the treatment record.')}{' '}{!profile.gammaKnifeOnly && profile.permissions.includes('scheduling') ? <a className="underline" href={`/appointments?patientId=${episode.patientId}`} target="_blank" rel="noreferrer">{tr('Review booking in RISpro')}</a> : tr('Ask an authorized scheduling user to review this booking.')}</p>}
      {!link && !editable && <p className="text-sm text-muted-foreground">{tr(profile.gammaKnifeOnly ? 'Contact the authorized coordinator to arrange or link this appointment.' : purpose === 'treatment' ? 'No treatment appointment linked.' : 'No follow-up appointment linked.')}</p>}
    {editable && <>
      <a className="inline-block underline text-sm" href={`/appointments?patientId=${episode.patientId}`} target="_blank" rel="noreferrer">{tr("Schedule or reschedule in RISpro")}</a>
      <p className="text-sm text-muted-foreground">{tr("Create or update the booking in RISpro, then reload this profile to select it. Treatment and follow-up use separate configured exam types.")}</p>
      {!expectedExam && <p className="text-sm" role="status">{tr('Choose the treatment and follow-up exam types in settings before linking appointments.')}</p>}
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { const f = formValues(event); void run('appointment', { purpose, bookingId: Number(f.bookingId), confirmed: f.confirmed === 'on', reason: f.reason }); }}>
        <label className="text-sm flex-1 min-w-40">{tr("Existing RISpro booking")}<select aria-label={purpose === 'treatment' ? tr('Treatment appointment') : tr('Next follow-up appointment')} name="bookingId" className="input-premium w-full" required defaultValue=""><option value="">{tr("Select booking")}</option>{profile.appointments.filter(a => a.examTypeId === expectedExam && a.status === 'scheduled').map(a => <option key={a.id} value={a.id}>{dateText(a.date)} {a.time?.slice(0, 5)}</option>)}</select></label>
        <label className="text-sm">{tr("Replacement reason")}<Input name="reason" required={Boolean(link)}/></label><label className="flex items-center gap-2 text-sm"><Checkbox name="confirmed"/>{tr("Confirmed with patient")}</label><Button disabled={busy || !expectedExam}>{tr("Link appointment")}</Button>
      </form>
      {link && !link.confirmed && !link.postponed && <Button variant="secondary" disabled={busy} onClick={() => void run('confirm_appointment', { purpose })}>{tr("Confirm appointment")}</Button>}
    </>}
  </section>;
}
export function GammaKnifeProfile() {
    const { tr, errorText, patientName, statusText, dateText, language, isArabic } = useGammaKnifeText();
    const { id } = useParams();
    const [tab, setTab] = useState<{ episodeId: number; value: string } | null>(null);
    const [mdtCorrectionEpisode, setMdtCorrectionEpisode] = useState<number | null>(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [qr, setQr] = useState<{
        url: string;
        image: string;
    } | null>(null);
    const query = useQuery({ queryKey: ['gamma-knife', 'episode', id], queryFn: () => gk<Profile>(`/episodes/${id}`), retry: false });
    const { refetch } = query;
    const refresh = useCallback(() => refetch(), [refetch]);
    const onDirty = useCallback((value: boolean) => setDirty(value), []);
    if (query.isPending)
        return <LoadingState message={tr('Loadingâ€¦')} />;
    if (query.error)
        return <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={refresh}/>;
    const profile = query.data;
    const episode = profile.episode;
    const { data } = episode;
    const can = (permission: Profile['permissions'][number]) => profile.permissions.includes(permission) && episode.active;
    const canCorrectNotSuitable = profile.permissions.includes('mdt') && episode.status === 'closed' && data.mdt?.decision === 'not_suitable' && !data.treatment?.completed;
    const canEditMdt = (can('mdt') && ['mdt', 'preparation', 'treatment'].includes(episode.status)) || canCorrectNotSuitable;
    const mdtCorrectionOpen = mdtCorrectionEpisode === episode.id;
    const changeTab = (next: string) => {
        if (dirty) { setError('Save or retry your clinical draft before changing tabs.'); return; }
        setTab({ episodeId: episode.id, value: next }); setError('');
    };
    const latestCourse = profile.courses.at(-1);
    const completedCourses = profile.courses.filter(course => course.status === 'completed');
    const reassessmentReady = profile.reassessments.some(item => item.status === 'requested');
    const treatmentReportsFinalized = completedCourses.length > 0 && completedCourses.every(course => course.documentationFinalized);
    const nextTab = reassessmentReady || data.investigationsPending ? 'MDT' : episode.status === 'mdt' && data.assessmentStatus !== 'finalized' ? 'Clinical' : episode.status === 'followup' && completedCourses.some(course => !course.documentationFinalized) ? 'Treatment' : ({ referrals: 'Clinical', clinical_review: 'Clinical', mdt: 'MDT', preparation: 'Treatment', treatment: 'Treatment', followup: 'Follow-up', closed: 'MDT' } as const)[episode.status];
    const activeTab = tab?.episodeId === episode.id ? tab.value : nextTab;
    const treatmentSummary = latestCourse ? `${tr('Course')} #${latestCourse.courseNumber} - ${statusText(latestCourse.status)} - ${latestCourse.fractions.filter(fraction => fraction.status === 'delivered').length}/${latestCourse.plannedFractionCount} ${tr('delivered fraction events')} - ${tr(latestCourse.documentationFinalized ? 'Documentation finalized' : 'Treatment report pending')}` : tr('Not recorded');
    const followups = [...(data.followups ?? []).map((visit, index) => ({ visit, index }))].sort((left, right) => right.visit.date.localeCompare(left.visit.date));
    const run: Command = async (name, body) => {
        if (busy || dirty) {
            setError('Wait for the clinical draft to save before another action.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await action(episode, name, body);
            if (result.url && result.qrImage)
                setQr({ url: result.url, image: result.qrImage });
            if (name === 'qr_revoke')
                setQr(null);
            if (name === 'mdt')
                setMdtCorrectionEpisode(null);
            await query.refetch();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Save failed.');
        }
        finally {
            setBusy(false);
        }
    };
    const runResource: ResourceCommand = async (path, body, method = 'POST') => {
        if (busy || dirty) { setError(tr('Wait for the clinical draft to save before another action.')); return; }
        setBusy(true); setError('');
        try { await gk(path, { ...body, revision: episode.revision }, method); await query.refetch(); }
        catch (error) { setError(error instanceof Error ? error.message : tr('Save failed.')); }
        finally { setBusy(false); }
    };
    const mdtForm = <form key={`mdt-${episode.id}-${episode.revision}`} className="space-y-3" onSubmit={event => { const directory = new FormData(event.currentTarget).getAll('directoryConsultants').map(String); const f = formValues(event); void run('mdt', { ...f, consultants: [...directory, ...splitLines(f.consultants ?? '')] }); }}>
      <h3 className="font-semibold">{tr(data.mdt ? 'Correct recorded MDT decision' : 'Record MDT decision')}</h3>{data.mdt && <p role="note" className="gk-clinical-note text-sm">{tr('MDT corrections require a reason and keep the earlier decision in episode history.')}</p>}
      <label className="block text-sm">{tr("MDT clinical assessment")}<Textarea dir="auto" name="assessment" defaultValue={data.mdt?.assessment ?? data.clinical?.assessment} required/></label>
      <label className="block text-sm">{tr("Discussion")}<Textarea dir="auto" name="notes" defaultValue={data.mdt?.notes ?? ''}/></label>
      {profile.config.consultants.length > 0 && <label className="block text-sm">{tr("Consultant directory (select one or more)")}<select className="input-premium w-full" multiple name="directoryConsultants" defaultValue={data.mdt?.consultants.filter(name => profile.config.consultants.includes(name)) ?? []}>{profile.config.consultants.map(name => <option key={name}>{name}</option>)}</select></label>}
      <label className="block text-sm">{tr("Responsible consultants (one name per line)")}<Textarea dir="auto" name="consultants" defaultValue={data.mdt?.consultants.join('\n') ?? ''}/></label>
      <label className="block text-sm">{tr("Decision")}<select name="decision" className="input-premium w-full" required defaultValue={data.mdt?.decision ?? ''}><option value="" disabled>{tr('Choose MDT decision')}</option><option value="approved">{tr("Approved")}</option><option value="additional_information">{tr("Additional information required")}</option><option value="deferred">{tr("Deferred")}</option><option value="not_suitable">{tr("Not suitable")}</option></select></label>
      <label className="block text-sm">{tr("Requested investigations")}<Textarea dir="auto" name="investigations" defaultValue={data.mdt?.investigations ?? ''}/></label><label className="block text-sm">{tr("Correction reason")}<Input name="reason" required={Boolean(data.mdt)}/></label><Button disabled={busy || data.assessmentStatus !== 'finalized'}>{tr(data.mdt ? 'Save MDT correction' : 'Record MDT decision')}</Button>{data.assessmentStatus !== 'finalized' && <p className="text-sm">{tr("Provisional assessments can be discussed. Finalize the clinical assessment before recording the official decision.")}</p>}
    </form>;
    return <div className="space-y-4" data-dictation-context={`gamma-knife-episode:${episode.patientId}:${episode.id}`}>
    <Card><div className="flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-xl font-semibold">{patientName(episode)}</h2><p className="text-sm text-muted-foreground">{tr("MRN")} <bdi dir="ltr">{episode.mrn}</bdi> · {episode.diagnosis}</p></div><Badge>{tr(STATUS_LABELS[episode.status])}</Badge></div>
      <section className="gk-clinical-snapshot mt-4" aria-label={tr('Clinical snapshot')}><h3 className="text-sm font-semibold">{tr('Clinical snapshot')}</h3><dl className="gk-snapshot-grid mt-2">
        <div><dt>{tr('Clinical assessment')}</dt><dd className="font-medium">{statusText(data.assessmentStatus ?? 'draft')}</dd>{data.clinical?.assessment && <p className="gk-assessment-preview text-sm text-muted-foreground">{data.clinical.assessment}</p>}</div>
        <div><dt>{tr('Responsible consultants:')}</dt><dd>{data.mdt?.consultants.length ? data.mdt.consultants.join(', ') : tr('Not recorded')}</dd></div>
        <div><dt>{tr('Outstanding investigations')}</dt><dd>{data.investigationsPending ? data.mdt?.investigations || tr('Not recorded') : tr('None pending')}</dd></div>
        <div><dt>{tr('Treatment record')}</dt><dd>{treatmentSummary}</dd></div>
      </dl></section>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={tr("Episode progress")}>{Object.entries(STATUS_LABELS).filter(([s]) => s !== 'closed').map(([s, label]) => <span key={s} aria-current={episode.status === s ? 'step' : undefined} className={episode.status === s ? 'font-bold underline' : 'text-muted-foreground'}>{tr(label)}</span>)}</div>
      <div className="gk-next-action mt-4 space-y-2"><p>{tr("Current status:")}{' '}<strong>{tr(STATUS_LABELS[episode.status])}</strong></p><p>{tr("Next action:")}{' '}<strong>{tr(profile.nextAction)}</strong></p><Button variant="secondary" size="sm" disabled={busy || dirty} onClick={() => { changeTab(nextTab); document.getElementById(`gk-tab-${PROFILE_TABS.findIndex(label => label === nextTab)}`)?.focus(); document.getElementById('gk-profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{tr('Continue to next step')}</Button></div>
      {profile.episodes.length > 1 && <div className="flex flex-wrap gap-3 mt-3 text-sm">{profile.episodes.map(e => <Link key={e.id} to={`/gamma-knife/episodes/${e.id}`}>{tr("Episode")} <bdi>#{e.id}</bdi> · {tr(STATUS_LABELS[e.status as Episode['status']])}</Link>)}</div>}
      <Button className="mt-3" size="sm" variant="secondary" disabled={busy || dirty} onClick={refresh}>{tr("Reload profile")}</Button>
    </Card>
    {error && <p role="alert" className="text-red-700">{errorText(error)}</p>}
    <Card><Tabs value={activeTab} onValueChange={changeTab}>
      <TabsList id="gk-profile-tabs" className="gk-tabs" role="tablist" aria-label={tr('Patient profile sections')}>{PROFILE_TABS.map((label, index) => <TabsTrigger key={label} value={label} role="tab" id={`gk-tab-${index}`} aria-selected={activeTab === label} aria-controls={`gk-panel-${index}`} tabIndex={activeTab === label ? 0 : -1} onKeyDown={event => {
        const direction = isArabic ? -1 : 1;
        const offset = event.key === 'ArrowRight' ? direction : event.key === 'ArrowLeft' ? -direction : 0;
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? PROFILE_TABS.length - 1 : offset ? (index + offset + PROFILE_TABS.length) % PROFILE_TABS.length : null;
        if (target === null || dirty) return;
        event.preventDefault(); changeTab(PROFILE_TABS[target]); document.getElementById(`gk-tab-${target}`)?.focus();
      }}>{tr(label)}</TabsTrigger>)}</TabsList>
      <TabsContent value="Clinical" id="gk-panel-0" role="tabpanel" aria-labelledby="gk-tab-0" className="mt-4"><ClinicalEditor key={episode.id} episode={episode} enabled={can('clinical')} diagnosisDetails={profile.config.diagnosisDetailsEnabled} onSaved={refresh} onDirty={onDirty}/></TabsContent>
      <TabsContent value="MDT" id="gk-panel-1" role="tabpanel" aria-labelledby="gk-tab-1" className="mt-4 space-y-4">
        <section><h3 className="font-semibold">{tr('Clinical summary')}: {statusText(data.assessmentStatus ?? 'draft')}</h3>{data.clinical ? <dl className="space-y-2 mt-2">{(['history', 'examination', 'imaging', 'assessment'] as const).map(key => <div key={key}><dt className="font-medium capitalize text-sm">{tr({history:'History',examination:'Examination',imaging:'Imaging information',assessment:'Clinical assessment'}[key])}</dt><dd className="text-sm whitespace-pre-wrap">{data.clinical![key]}</dd></div>)}</dl> : <p className="text-sm">{tr("No clinical assessment yet.")}</p>}</section>
        <StructuredClinicalSummary clinical={data.clinical}/>
        {data.mdt && <section className="border-t border-border pt-3"><h3 className="font-semibold">{tr("Recorded MDT decision")}</h3><p>{statusText(data.mdt.decision)}</p><p className="text-sm">{tr("Responsible consultants:")}{' '}{data.mdt.consultants.join(', ')}</p><p className="text-sm whitespace-pre-wrap">{data.mdt.notes}</p>{data.mdt.investigations && <p className="text-sm">{tr("Requested investigations:")}{' '}{data.mdt.investigations}</p>}</section>}
    {canEditMdt && (data.mdt ? <div className="space-y-3 border-t border-border pt-3"><Button variant="secondary" onClick={() => setMdtCorrectionEpisode(mdtCorrectionOpen ? null : episode.id)}>{tr(mdtCorrectionOpen ? 'Cancel MDT correction' : 'Correct recorded MDT decision')}</Button>{mdtCorrectionOpen && mdtForm}</div> : mdtForm)}
        <InvestigationPanel profile={profile} busy={busy} run={runResource}/>
        <ReassessmentPanel profile={profile} busy={busy} run={runResource}/>
      </TabsContent>
      <TabsContent value="Treatment" id="gk-panel-2" role="tabpanel" aria-labelledby="gk-tab-2" className="mt-4 space-y-5">
        <p role="note" className="gk-clinical-note text-sm">{tr('GammaPlan remains the authoritative system for treatment planning, delivery evidence, and machine QA. RISpro stores staff-entered fraction events and explicit course-completion confirmation; it does not calculate or approve a treatment plan.')}</p>
        <Preparation episode={episode} editable={can('treatment') && ['preparation', 'treatment'].includes(episode.status)} busy={busy} run={run}/>
        <BookingLink profile={profile} purpose="treatment" run={run} busy={busy}/>
        {can('scheduling') && ['preparation', 'treatment'].includes(episode.status) && <form className="space-y-2" onSubmit={event => void run('postpone', formValues(event))}><label className="block text-sm">{tr("Postponement reason")}<Input name="reason" required/></label><Button variant="secondary" disabled={busy}>{tr("Record postponement")}</Button><p className="text-sm text-muted-foreground">{tr("Update or cancel the calendar booking through RISpro as needed.")}</p></form>}
        {data.postponementReason && <p className="text-sm">{tr("Last postponement:")}{' '}{data.postponementReason}</p>}
        <TreatmentCourses profile={profile} busy={busy} canTreat={can('treatment')} run={runResource}/>
        {can('treatment') && completedCourses.length > 0 && (profile.documents.some(document => document.category === 'treatment_report') ? <DisclosureSection key={`reports-${episode.id}-${completedCourses.map(course => `${course.id}:${course.documentationFinalized}`).join(',')}`} title={tr('Treatment report documentation')}><form className="space-y-3" onSubmit={event => void run('report', { ...formValues(event) })}><label className="block text-sm">{tr('Completed treatment course')}<select className="input-premium w-full" name="courseId" required defaultValue=""><option value="" disabled>{tr('Select a completed treatment course')}</option>{completedCourses.map(course => <option key={course.id} value={course.id}>{tr('Course')} #{course.courseNumber} · {tr(course.documentationFinalized ? 'Documentation finalized' : 'Treatment report pending')}</option>)}</select></label><label className="block text-sm">{tr("Treatment report")}<select className="input-premium w-full" name="documentId" required defaultValue=""><option value="">{tr("Select uploaded treatment report")}</option>{profile.documents.filter(d => d.category === 'treatment_report').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="block text-sm">{tr("Replacement reason")}<Input name="reason" required/></label><Button disabled={busy}>{tr("Finalize treatment documentation")}</Button></form></DisclosureSection> : <section className="space-y-3 border-t border-border pt-3"><p className="text-sm">{tr('Upload a treatment report for this episode first.')}</p><Button variant="secondary" onClick={() => changeTab('Documents')}>{tr(can('documents') ? 'Upload treatment report' : 'View documents')}</Button></section>)}
      </TabsContent>
      <TabsContent value="Documents" id="gk-panel-3" role="tabpanel" aria-labelledby="gk-tab-3" className="mt-4"><Documents profile={profile} run={run} busy={busy} refresh={refresh} onError={setError}/>
        {can('documents') && <section className="mt-5 border-t border-border pt-3"><h3 className="font-semibold">{tr("Patient QR access")}</h3><p className="text-sm">{episode.qrActive ? tr("Active QR credential") : tr("No active QR credential")}. {tr('Replacing it invalidates the previous code.')}</p><div className="flex flex-wrap gap-2 mt-2"><Button variant="secondary" disabled={busy || !profile.config.qrEnabled} onClick={() => void run('qr_replace', {})}>{episode.qrActive ? tr("Replace QR code") : tr("Create QR code")}</Button><Button variant="secondary" disabled={busy || !episode.qrActive} onClick={() => void run('qr_revoke', {})}>{tr("Revoke QR code")}</Button></div>{qr && <div className="mt-3"><img src={qr.image} alt={tr("Patient episode QR code")} width={256} height={256}/><a className="underline break-all text-sm" href={qr.url} target="_blank" rel="noreferrer">{tr("Open patient page")}</a><p className="text-sm text-muted-foreground">{tr("Save or print this code now. The link is shown only when issued.")}</p></div>}</section>}
      </TabsContent>
      <TabsContent value="Follow-up" id="gk-panel-4" role="tabpanel" aria-labelledby="gk-tab-4" className="mt-4 space-y-4">
        <BookingLink profile={profile} purpose="followup" run={run} busy={busy}/>
        <ReassessmentRequest profile={profile} busy={busy} run={runResource}/>
        {followups.length > 0 && <h3 className="font-semibold">{tr('Previous follow-up visits (latest first)')}</h3>}
        {followups.map(({ visit, index }) => <FollowupEntry key={visit.id ?? index} profile={profile} visit={visit} index={index} busy={busy} run={run}/>)}
        {!followups.length && <EmptyState message={tr("No follow-up visits recorded.")}/>}
        {can('clinical') && episode.status === 'followup' && <form className="gk-followup-form space-y-3" onSubmit={event => void run('followup', formValues(event))}><h3 className="font-semibold">{tr("Record follow-up")}</h3><label className="block text-sm">{tr("Visit date")}<Input name="date" type="date" max={today()} defaultValue={today()} required/></label><div className="grid gap-3 sm:grid-cols-2">{[['condition', 'Clinical condition and symptoms'], ['imaging', 'Imaging results'], ['response', 'Imaging response'], ['complications', 'Complications'], ['severity', 'Severity'], ['actions', 'Actions']].map(([name, label]) => <label key={name} className="block text-sm">{tr(label)}<Textarea dir="auto" rows={3} name={name} required={name === 'condition'}/></label>)}</div><div className="flex flex-wrap gap-2"><Button type="reset" variant="secondary">{tr('Clear unsaved follow-up')}</Button><Button disabled={busy}>{tr("Save follow-up visit")}</Button></div></form>}
        {can('clinical') && episode.status === 'followup' && treatmentReportsFinalized && <form className="space-y-2 border-t border-border pt-3" onSubmit={event => void run('close', formValues(event))}><label className="block text-sm">{tr("Reason for ending this episode\u2019s follow-up")}<Textarea dir="auto" name="reason" required/></label><Button variant="secondary" disabled={busy}>{tr("Close episode")}</Button></form>}
        {can('clinical') && episode.status === 'followup' && !treatmentReportsFinalized && <p role="note" className="text-sm text-muted-foreground border-t border-border pt-3">{tr('Episode closure is available after treatment documentation is finalized.')}</p>}
      </TabsContent>
    </Tabs></Card>
    <Card><DisclosureSection title={tr('Episode history')}><div className="space-y-3">{profile.history.map(entry => <section key={entry.revision} className="border-t border-border pt-2"><p className="text-sm font-medium">{historyAction(entry.action, tr)} · {entry.actor} · {new Date(entry.createdAt).toLocaleString(language === 'ar' ? 'ar-LY' : 'en-GB', { timeZone: 'Africa/Tripoli' })}</p>{entry.snapshot.reason && <p className="text-sm">{tr("Reason:")}{' '}{entry.snapshot.reason}</p>}<details className="text-sm mt-1"><summary>{tr("Recorded clinical information")}</summary><p className="whitespace-pre-wrap">{entry.snapshot.data.clinical?.assessment}</p>{entry.snapshot.data.mdt && <p>{statusText(entry.snapshot.data.mdt.decision)} · {entry.snapshot.data.mdt.consultants.join(', ')}</p>}<p className="whitespace-pre-wrap">{entry.snapshot.data.mdt?.notes}</p></details></section>)}</div></DisclosureSection></Card>
  </div>;
}
function Preparation({ episode, editable, busy, run }: {
    episode: Episode;
    editable: boolean;
    busy: boolean;
    run: Command;
}) {
    const { tr } = useGammaKnifeText();
    const preparation = episode.data.preparation;
    if (!editable) return preparation ? <DisclosureSection title={tr('Preparation checklist')}>
      <div className="flex flex-wrap gap-3 text-sm">{[['consent','Consent'],['imaging','Required imaging'],['clinicalReady','Clinical readiness']].map(([key,label]) => <span key={key}>{tr(label)}: {preparation[key as 'consent' | 'imaging' | 'clinicalReady'] ? tr('Confirmed') : tr('Not recorded')}</span>)}</div>
      <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm">{preparation.notes || tr('Not recorded')}</p>
    </DisclosureSection> : <EmptyState message={tr('Preparation starts after MDT approval.')} />;
    return <form className="space-y-3" key={`${episode.id}-${episode.revision}`} onSubmit={event => { const f = formValues(event); void run('preparation', { ...f, consent: f.consent === 'on', imaging: f.imaging === 'on', clinicalReady: f.clinicalReady === 'on', ready: f.ready === 'on' }); }}>
    <h3 className="font-semibold">{tr("Preparation checklist")}</h3>{[['consent', 'Consent'], ['imaging', 'Required imaging'], ['clinicalReady', 'Clinical readiness']].map(([name, label]) => <label key={name} className="flex items-center gap-2 text-sm"><Checkbox name={name} defaultChecked={Boolean(preparation?.[name as 'consent' | 'imaging' | 'clinicalReady'])} disabled={!editable}/>{tr(label)}</label>)}
    <label className="block text-sm">{tr("Preparation notes")}<Textarea dir="auto" name="notes" defaultValue={preparation?.notes} disabled={!editable}/></label><label className="block text-sm">{tr("Patient preparation instructions")}<Textarea dir="auto" name="instructions" defaultValue={preparation?.instructions} disabled={!editable}/></label><label className="block text-sm">{tr("Patient required actions")}<Textarea dir="auto" name="actions" defaultValue={preparation?.actions} disabled={!editable}/></label>
    {editable && <><label className="flex items-center gap-2 text-sm"><Checkbox name="ready" defaultChecked={preparation?.ready}/>{tr("Confirm ready for treatment")}</label><Button disabled={busy}>{tr("Save preparation")}</Button></>}
  </form>;
}
function FollowupEntry({ profile, visit, index, busy, run }: { profile: Profile; visit: NonNullable<Profile['episode']['data']['followups']>[number]; index: number; busy: boolean; run: Command }) {
    const { tr, dateText } = useGammaKnifeText();
    const episode = profile.episode;
    const ref = visit.id ? { visitId: visit.id } : { visitIndex: index };
    return <article className={`space-y-2 border-t border-border pt-3 ${visit.voided ? 'opacity-70' : ''}`}><h3 className="flex flex-wrap items-center gap-2 font-semibold">{dateText(visit.date)}{visit.voided && <Badge variant="warning">{tr('Entered in error')}</Badge>}</h3>
      {visit.courseId && <p className="text-sm text-muted-foreground">{tr('Follow-up after course')} #{profile.courses.find(course => course.id === visit.courseId)?.courseNumber ?? visit.courseId}</p>}
      <p className="whitespace-pre-wrap text-sm">{visit.condition}</p><p className="text-sm">{tr('Imaging information')}: {visit.imaging || tr('Not recorded')} · {tr('Imaging response')}: {visit.response || tr('Not recorded')}</p>{visit.complications && <p className="text-sm">{tr('Complications')}: {visit.complications} · {visit.severity} · {tr('Actions')}: {visit.actions}</p>}{visit.voidedReason && <p className="text-sm">{tr('Reason:')} {visit.voidedReason}</p>}
      {!visit.voided && profile.permissions.includes('clinical') && episode.active && <div className="grid gap-2 sm:grid-cols-2"><DisclosureSection title={tr('Correct follow-up record')}><form className="space-y-2" onSubmit={event => void run('followup_correct', { ...formValues(event), ...ref })}><label className="block text-sm">{tr('Visit date')}<Input name="date" type="date" max={today()} defaultValue={visit.date} required/></label>{[['condition','Clinical condition and symptoms'],['imaging','Imaging results'],['response','Imaging response'],['complications','Complications'],['severity','Severity'],['actions','Actions']].map(([name,label]) => <label key={name} className="block text-sm">{tr(label)}<Textarea dir="auto" name={name} defaultValue={visit[name as keyof typeof visit] as string ?? ''} required={name === 'condition'}/></label>)}<label className="block text-sm">{tr('Correction reason')}<Textarea dir="auto" name="reason" required/></label><Button size="sm" variant="secondary" disabled={busy}>{tr('Save correction')}</Button></form></DisclosureSection><DisclosureSection title={tr('Mark follow-up entered in error')}><p className="text-sm text-muted-foreground">{tr('This keeps the record and reason in the audit history, but excludes it from the active follow-up chronology.')}</p><form className="space-y-2" onSubmit={event => void run('followup_void', { ...formValues(event), ...ref })}><label className="block text-sm">{tr('Reason')}<Textarea name="reason" dir="auto" required/></label><Button size="sm" variant="secondary" disabled={busy}>{tr('Mark entered in error')}</Button></form></DisclosureSection></div>}
    </article>;
}
function DocumentEntry({ profile, document, busy, run }: { profile: Profile; document: Profile['documents'][number]; busy: boolean; run: Command }) {
    const { tr, categoryText, statusText } = useGammaKnifeText();
    const { episode } = profile;
    const canEdit = profile.permissions.includes('documents') && episode.active;
    const linkedReport = episode.data.treatment?.reportId === document.id;
    return <article className="space-y-2 border-t border-border pt-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><a className="underline break-all" href={`/api/gamma-knife/episodes/${episode.id}/documents/${document.id}`} target="_blank" rel="noreferrer">{document.name}</a><p className="text-sm">{categoryText(document.category)} · {statusText(document.visibility)} · {document.released ? tr('Released') : tr('Internal')}</p></div>{canEdit && <Button size="sm" variant="secondary" disabled={busy || (document.visibility !== 'routine' && !document.released)} onClick={() => void run('document_visibility', { documentId: document.id, released: !document.released })}>{document.released ? tr('Withdraw patient access') : document.visibility === 'sensitive' ? tr('Sensitive document — contact the clinic') : tr('Allow patient access')}</Button>}</div>
      {canEdit && <div className="grid gap-2 sm:grid-cols-2"><DisclosureSection title={tr('Correct document information')}><form className="space-y-2" onSubmit={event => void run('document_correct', { ...formValues(event), documentId: document.id })}><label className="block text-sm">{tr('Document name')}<Input name="originalFilename" defaultValue={document.name} maxLength={200} required/></label><label className="block text-sm">{tr('Document category')}<select className="input-premium w-full" name="category" defaultValue={document.category} disabled={linkedReport}>{CATEGORIES.map(category => <option key={category} value={category}>{categoryText(category)}</option>)}</select></label>{linkedReport && <p className="text-sm text-muted-foreground">{tr('The linked treatment report stays in the treatment report category.')}</p>}<label className="block text-sm">{tr('Correction reason')}<Textarea name="reason" dir="auto" required/></label><Button size="sm" variant="secondary" disabled={busy}>{tr('Save correction')}</Button></form></DisclosureSection>
      <DisclosureSection title={tr('Remove document from episode')}><p className="text-sm text-muted-foreground">{tr('The file and its history are retained. Removal only detaches it from this episode and withdraws patient access.')}</p>{linkedReport ? <p className="text-sm">{tr('Replace the linked treatment report before removing this document.')}</p> : <form className="space-y-2" onSubmit={event => void run('document_remove', { ...formValues(event), documentId: document.id })}><label className="block text-sm">{tr('Reason')}<Textarea name="reason" dir="auto" required/></label><Button size="sm" variant="secondary" disabled={busy}>{tr('Remove document from episode')}</Button></form>}</DisclosureSection></div>}
    </article>;
}
function Documents({ profile, run, busy, refresh, onError }: {
    profile: Profile;
    run: Command;
    busy: boolean;
    refresh: () => Promise<unknown>;
    onError: (message: string) => void;
}) {
    const { tr, categoryText, statusText, language } = useGammaKnifeText();
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const fileInputId = useId();
    const [fileName, setFileName] = useState('');
    const { episode } = profile;
    const canUpload = profile.permissions.includes('documents') && episode.active;
    const scannerQuery = useQuery({ queryKey: ['gamma-knife', 'scanner-settings'], queryFn: () => gk<{ scanner: { enabled: boolean; endpoint: string; allowedOrigins: string[]; source: string; dpi: string; colorMode: string } }>('/scanner-settings'), enabled: canUpload, retry: false, staleTime: 60_000 });
    const scanner = scannerQuery.data?.scanner;
    const globalPreferences = { source: scanner?.source, dpi: scanner?.dpi, colorMode: scanner?.colorMode };
    const [scanOverrides, setScanOverrides] = useState<Naps2ScanPreferenceOverrides>({});
    const [scanCategory, setScanCategory] = useState<string>(episode.data.treatment?.completed && !episode.data.treatment.finalized ? 'treatment_report' : 'referral');
    const [scanning, setScanning] = useState(false);
    const [failedScanUploads, setFailedScanUploads] = useState<Array<{ file: File; error: string; category: string; idempotencyKey: string }>>([]);
    const [scanMessage, setScanMessage] = useState('');
    const encodeFile = (selected: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('File could not be read.')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(selected); });
    const uploadScannedFile = async (selected: File, categoryValue: string, revision: number, idempotencyKey: string, pageCount?: number | null) => gk<{ id: number; revision: number }>(`/episodes/${episode.id}/documents`, {
      revision, category: categoryValue, originalFilename: selected.name, mimeType: selected.type,
      fileContentBase64: await encodeFile(selected), source: 'naps2_webscan', idempotencyKey, ...(pageCount ? { pageCount } : {})
    });
    const scanAndUpload = async () => {
      if (!scanner?.enabled || scanning || uploading || failedScanUploads.length) return;
      setScanning(true); setScanMessage(''); onError('');
      try {
        const effectiveEndpoint = resolveEffectiveNaps2Endpoint(scanner.endpoint);
        const preferences = resolveEffectiveNaps2ScanPreferences(globalPreferences, scanOverrides);
        const result = await scanAppointmentRequest({ endpoint: effectiveEndpoint.endpoint, allowedOrigins: scanner.allowedOrigins, ...preferences, fileName: `gamma-knife-episode-${episode.id}.pdf` });
        const files = result.files?.length ? result.files : [result.file];
        const failed: Array<{ file: File; error: string; category: string; idempotencyKey: string }> = [];
        let revision = episode.revision;
        let uploaded = 0;
        for (const scannedFile of files) {
          const idempotencyKey = `gamma-knife-episode:${episode.id}:${crypto.randomUUID()}`;
          try {
            const response = await uploadScannedFile(scannedFile, scanCategory, revision, idempotencyKey, files.length === 1 ? result.pageCount : null);
            revision = response.revision; uploaded += 1;
          } catch (error) {
            failed.push({ file: scannedFile, error: error instanceof Error ? error.message : 'Upload failed.', category: scanCategory, idempotencyKey });
          }
        }
        setFailedScanUploads(failed);
        if (uploaded) await refresh();
        if (failed.length) onError(tr('Some scanned files could not be uploaded. Retry them below; the scan will not be repeated.'));
        else setScanMessage(tr('Scan completed and documents uploaded.'));
      } catch (error) {
        onError(error instanceof Error ? error.message : tr('NAPS2 scanner is not configured or available. Manual file upload remains available.'));
      } finally {
        setScanning(false);
      }
    };
    const retryScannedUploads = async () => {
      if (!failedScanUploads.length || scanning || uploading) return;
      setUploading(true); setScanMessage(''); onError('');
      const remaining: Array<{ file: File; error: string; category: string; idempotencyKey: string }> = [];
      let revision = episode.revision;
      let uploaded = 0;
      for (const failed of failedScanUploads) {
        try {
          const response = await uploadScannedFile(failed.file, failed.category, revision, failed.idempotencyKey);
          revision = response.revision; uploaded += 1;
        } catch (error) {
          remaining.push({ ...failed, error: error instanceof Error ? error.message : 'Upload failed.' });
        }
      }
      setFailedScanUploads(remaining);
      if (uploaded) await refresh();
      if (remaining.length) onError(tr('Some scanned files could not be uploaded. Retry them below; the scan will not be repeated.'));
      else setScanMessage(tr('Scan completed and documents uploaded.'));
      setUploading(false);
    };
    return <div className="space-y-4"><h3 className="font-semibold">{tr("Diagnosis document checklist")}</h3>{episode.data.checklist?.length ? <ul className="list-disc ps-5 text-sm">{episode.data.checklist.map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">{tr("No additional diagnosis checklist configured.")}</p>}
    {profile.documents.map(document => <DocumentEntry key={document.id} profile={profile} document={document} busy={busy || uploading} run={run}/>)}
    {profile.permissions.includes('documents') && episode.active && <form className="space-y-3 border-t border-border pt-3" onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                const file = values.get('file');
                if (!(file instanceof File) || !file.size)
                    return;
                setUploading(true);
                onError('');
                try {
                    const fileContentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('File could not be read.')); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
                    await gk(`/episodes/${episode.id}/documents`, { revision: episode.revision, category: values.get('category'), originalFilename: file.name, mimeType: file.type, fileContentBase64 });
                    form.reset();
                    setFileName('');
                    await refresh();
                    setScanMessage(tr('Document uploaded.'));
                }
                catch (error) {
                    onError(error instanceof Error ? error.message : 'Upload failed.');
                }
                finally {
                    setUploading(false);
                }
            }}><label className="block text-sm">{tr("Document category")}<select className="input-premium w-full" name="category" defaultValue={episode.data.treatment?.completed && !episode.data.treatment.finalized ? 'treatment_report' : 'referral'}>{CATEGORIES.map(category => <option key={category} value={category}>{categoryText(category)}</option>)}</select></label>
      <div className="space-y-2"><label htmlFor={fileInputId} className="block text-sm">{tr('File (PDF, JPEG or PNG)')}</label><Input ref={fileInput} id={fileInputId} className="sr-only" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required onChange={event => setFileName(event.target.files?.[0]?.name ?? '')}/><div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" disabled={busy || uploading} onClick={() => fileInput.current?.click()}>{tr('Choose file')}</Button><bdi className="min-w-0 break-all text-sm">{fileName || tr('No file selected')}</bdi>{fileName && <Button type="button" size="sm" variant="secondary" disabled={busy || uploading} onClick={() => { if (fileInput.current) fileInput.current.value = ''; setFileName(''); }}>{tr('Clear selected file')}</Button>}</div></div>
      <Button disabled={busy || uploading || !fileName}>{uploading ? tr("Uploading\u2026") : tr("Upload document")}</Button></form>}
    {canUpload && <section className="space-y-3 border-t border-border pt-3">
      <label className="block text-sm">{tr("Document category")}<select aria-label={tr("Document category")} className="input-premium w-full" value={scanCategory} onChange={event => setScanCategory(event.target.value)}>{CATEGORIES.map(category => <option key={category} value={category}>{categoryText(category)}</option>)}</select></label>
      <Button type="button" variant="secondary" disabled={busy || uploading || scanning || !scanner?.enabled || failedScanUploads.length > 0} onClick={() => void scanAndUpload()}>{scanning ? tr('Scanningâ€¦') : tr('Scan paper')}</Button>
      {scanner?.enabled ? <ScanOptionsDisclosure language={language} globalPreferences={globalPreferences} overrides={scanOverrides} onChange={setScanOverrides} disabled={busy || uploading || scanning}/> : <p className="text-sm text-muted-foreground">{tr('NAPS2 scanner is not configured or available. Manual file upload remains available.')}</p>}
      {scanMessage && <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{scanMessage}</p>}
      {failedScanUploads.length > 0 && <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h4 className="font-semibold">{tr('Scanned files awaiting upload')}</h4>{failedScanUploads.map((failed, index) => <div key={`${failed.file.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all">{failed.file.name} · {failed.error}</span><Button type="button" size="sm" variant="secondary" disabled={uploading || scanning} onClick={() => setFailedScanUploads(current => current.filter((_, itemIndex) => itemIndex !== index))}>{tr('Remove from retry list')}</Button></div>)}<Button type="button" disabled={busy || uploading || scanning} onClick={() => void retryScannedUploads()}>{tr('Retry failed uploads')}</Button></div>}
    </section>}
  </div>;
}
