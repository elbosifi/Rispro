import { useGammaKnifeText } from './use-gamma-knife-text';
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, DisclosureSection, EmptyState, ErrorState, Input, LoadingState, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/shared';
import { ClinicalEditor } from './clinical-editor';
import { CATEGORIES, STATUS_LABELS, action, gk, splitLines, today, type Episode, type Profile } from './api';
type Command = (name: string, body: object) => Promise<void>;
const PROFILE_TABS = ['Clinical', 'MDT', 'Treatment', 'Documents', 'Follow-up'] as const;
function historyAction(value: string, tr: (message: string) => string) {
    const labels: Record<string, string> = { referral: 'Register referral', clinical: 'Save draft', submit: 'Clinical assessment submitted', mdt: 'Record MDT decision', investigations: 'Investigations received', preparation: 'Preparation updated', appointment: 'Link appointment', confirm_appointment: 'Confirm appointment', postpone: 'Record postponement', completion: 'Record completed treatment', report: 'Finalize treatment documentation', followup: 'Save follow-up visit', close: 'Episode closed', document_visibility: 'Patient document visibility updated', document_upload: 'Document uploaded', qr_replace: 'QR code replaced', qr_revoke: 'QR code revoked' };
    return tr(labels[value] ?? 'Episode history');
}
function formValues(event: FormEvent<HTMLFormElement>) { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; }
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
    const editable = profile.permissions.includes('scheduling') && episode.active && (purpose === 'treatment' ? ['preparation', 'treatment'].includes(episode.status) : episode.status === 'followup');
    return <section className="space-y-3 border-t border-border pt-3"><h3 className="font-semibold">{purpose === 'treatment' ? tr("Treatment appointment") : tr("Next follow-up appointment")}</h3>
    {link && <p className="text-sm">{booking ? `${dateText(booking.date)} ${booking.time?.slice(0, 5) ?? ''} · ${statusText(booking.status)}` : tr("Linked appointment")} · {link.postponed ? tr("Postponed") : link.confirmed ? tr("Confirmed") : tr("Tentative")}</p>}
    {!link && !editable && <p className="text-sm text-muted-foreground">{tr(purpose === 'treatment' ? 'No treatment appointment linked.' : 'No follow-up appointment linked.')}</p>}
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
    const [tab, setTab] = useState('Clinical');
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [qr, setQr] = useState<{
        url: string;
        image: string;
    } | null>(null);
    const query = useQuery({ queryKey: ['gamma-knife', 'episode', id], queryFn: () => gk<Profile>(`/episodes/${id}`), retry: false });
    const { refetch } = query;
    const refresh = useCallback(() => { void refetch(); }, [refetch]);
    const onDirty = useCallback((value: boolean) => setDirty(value), []);
    if (query.isPending)
        return <LoadingState message={tr('Loading…')} />;
    if (query.error)
        return <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={refresh}/>;
    const profile = query.data;
    const episode = profile.episode;
    const { data } = episode;
    const can = (permission: Profile['permissions'][number]) => profile.permissions.includes(permission) && episode.active;
    const canCorrectNotSuitable = profile.permissions.includes('mdt') && episode.status === 'closed' && data.mdt?.decision === 'not_suitable' && !data.treatment?.completed;
    const changeTab = (next: string) => {
        if (dirty) { setError('Save or retry your clinical draft before changing tabs.'); return; }
        setTab(next); setError('');
    };
    const nextTab = data.investigationsPending ? 'MDT' : episode.status === 'mdt' && data.assessmentStatus !== 'finalized' ? 'Clinical' : episode.status === 'followup' && !data.treatment?.finalized ? 'Treatment' : ({ referrals: 'Clinical', clinical_review: 'Clinical', mdt: 'MDT', preparation: 'Treatment', treatment: 'Treatment', followup: 'Follow-up', closed: 'MDT' } as const)[episode.status];
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
            await query.refetch();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Save failed.');
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="space-y-4">
    <Card><div className="flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-xl font-semibold">{patientName(episode)}</h2><p className="text-sm text-muted-foreground">{tr("MRN")} <bdi dir="ltr">{episode.mrn}</bdi> · {episode.diagnosis}</p></div><Badge>{tr(STATUS_LABELS[episode.status])}</Badge></div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={tr("Episode progress")}>{Object.entries(STATUS_LABELS).filter(([s]) => s !== 'closed').map(([s, label]) => <span key={s} aria-current={episode.status === s ? 'step' : undefined} className={episode.status === s ? 'font-bold underline' : 'text-muted-foreground'}>{tr(label)}</span>)}</div>
      <div className="gk-next-action mt-4 space-y-2"><p>{tr("Current status:")}{' '}<strong>{tr(STATUS_LABELS[episode.status])}</strong></p><p>{tr("Next action:")}{' '}<strong>{tr(profile.nextAction)}</strong></p><Button variant="secondary" size="sm" disabled={busy || dirty} onClick={() => { changeTab(nextTab); document.getElementById(`gk-tab-${PROFILE_TABS.findIndex(label => label === nextTab)}`)?.focus(); document.getElementById('gk-profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{tr('Continue to next step')}</Button></div>
      {profile.episodes.length > 1 && <div className="flex flex-wrap gap-3 mt-3 text-sm">{profile.episodes.map(e => <Link key={e.id} to={`/gamma-knife/episodes/${e.id}`}>{tr("Episode")} <bdi>#{e.id}</bdi> · {tr(STATUS_LABELS[e.status as Episode['status']])}</Link>)}</div>}
      <Button className="mt-3" size="sm" variant="secondary" disabled={busy || dirty} onClick={refresh}>{tr("Reload profile")}</Button>
    </Card>
    {error && <p role="alert" className="text-red-700">{errorText(error)}</p>}
    <Card><Tabs value={tab} onValueChange={changeTab}>
      <TabsList id="gk-profile-tabs" className="gk-tabs" role="tablist" aria-label={tr('Patient profile sections')}>{PROFILE_TABS.map((label, index) => <TabsTrigger key={label} value={label} role="tab" id={`gk-tab-${index}`} aria-selected={tab === label} aria-controls={`gk-panel-${index}`} tabIndex={tab === label ? 0 : -1} onKeyDown={event => {
        const direction = isArabic ? -1 : 1;
        const offset = event.key === 'ArrowRight' ? direction : event.key === 'ArrowLeft' ? -direction : 0;
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? PROFILE_TABS.length - 1 : offset ? (index + offset + PROFILE_TABS.length) % PROFILE_TABS.length : null;
        if (target === null || dirty) return;
        event.preventDefault(); changeTab(PROFILE_TABS[target]); document.getElementById(`gk-tab-${target}`)?.focus();
      }}>{tr(label)}</TabsTrigger>)}</TabsList>
      <TabsContent value="Clinical" id="gk-panel-0" role="tabpanel" aria-labelledby="gk-tab-0" className="mt-4"><ClinicalEditor key={episode.id} episode={episode} enabled={can('clinical')} diagnosisDetails={profile.config.diagnosisDetailsEnabled} onSaved={refresh} onDirty={onDirty}/></TabsContent>
      <TabsContent value="MDT" id="gk-panel-1" role="tabpanel" aria-labelledby="gk-tab-1" className="mt-4 space-y-4">
        <section><h3 className="font-semibold">{tr('Clinical summary')} ? {statusText(data.assessmentStatus ?? 'draft')}</h3>{data.clinical ? <dl className="space-y-2 mt-2">{(['history', 'examination', 'imaging', 'assessment'] as const).map(key => <div key={key}><dt className="font-medium capitalize text-sm">{tr({history:'History',examination:'Examination',imaging:'Imaging information',assessment:'Clinical assessment'}[key])}</dt><dd className="text-sm whitespace-pre-wrap">{data.clinical![key]}</dd></div>)}</dl> : <p className="text-sm">{tr("No clinical assessment yet.")}</p>}</section>
        {data.mdt && <section className="border-t border-border pt-3"><h3 className="font-semibold">{tr("Recorded MDT decision")}</h3><p>{statusText(data.mdt.decision)}</p><p className="text-sm">{tr("Responsible consultants:")}{' '}{data.mdt.consultants.join(', ')}</p><p className="text-sm whitespace-pre-wrap">{data.mdt.notes}</p>{data.mdt.investigations && <p className="text-sm">{tr("Requested investigations:")}{' '}{data.mdt.investigations}</p>}</section>}
        {((can('mdt') && ['mdt', 'preparation', 'treatment'].includes(episode.status)) || canCorrectNotSuitable) && <form className="space-y-3" onSubmit={event => { const directory = new FormData(event.currentTarget).getAll('directoryConsultants').map(String); const f = formValues(event); void run('mdt', { ...f, consultants: [...directory, ...splitLines(f.consultants ?? '')] }); }}>
          <label className="block text-sm">{tr("MDT clinical assessment")}<Textarea dir="auto" name="assessment" defaultValue={data.mdt?.assessment ?? data.clinical?.assessment} required/></label>
          <label className="block text-sm">{tr("Discussion")}<Textarea dir="auto" name="notes"/></label>
          {profile.config.consultants.length > 0 && <label className="block text-sm">{tr("Consultant directory (select one or more)")}<select className="input-premium w-full" multiple name="directoryConsultants">{profile.config.consultants.map(name => <option key={name}>{name}</option>)}</select></label>}
          <label className="block text-sm">{tr("Responsible consultants (one name per line)")}<Textarea dir="auto" name="consultants" defaultValue={data.mdt?.consultants.join('\n') ?? ''}/></label>
          <label className="block text-sm">{tr("Decision")}<select name="decision" className="input-premium w-full" required defaultValue=""><option value="" disabled>{tr('Choose MDT decision')}</option><option value="approved">{tr("Approved")}</option><option value="additional_information">{tr("Additional information required")}</option><option value="deferred">{tr("Deferred")}</option><option value="not_suitable">{tr("Not suitable")}</option></select></label>
          <label className="block text-sm">{tr("Requested investigations")}<Textarea dir="auto" name="investigations"/></label><label className="block text-sm">{tr("Correction reason")}<Input name="reason" required={Boolean(data.mdt)}/></label><Button disabled={busy || data.assessmentStatus !== 'finalized'}>{tr("Record MDT decision")}</Button>{data.assessmentStatus !== 'finalized' && <p className="text-sm">{tr("Provisional assessments can be discussed. Finalize the clinical assessment before recording the official decision.")}</p>}
        </form>}
        {data.investigationsPending && can('documents') && <form className="space-y-3" onSubmit={event => void run('investigations', formValues(event))}><label className="block text-sm">{tr("Received information / operations note")}<Textarea dir="auto" name="reason" required/></label><Button disabled={busy}>{tr("Return to clinical review")}</Button></form>}
      </TabsContent>
      <TabsContent value="Treatment" id="gk-panel-2" role="tabpanel" aria-labelledby="gk-tab-2" className="mt-4 space-y-5">
        <Preparation episode={episode} editable={can('treatment') && ['preparation', 'treatment'].includes(episode.status)} busy={busy} run={run}/>
        <BookingLink profile={profile} purpose="treatment" run={run} busy={busy}/>
        {can('scheduling') && ['preparation', 'treatment'].includes(episode.status) && <form className="space-y-2" onSubmit={event => void run('postpone', formValues(event))}><label className="block text-sm">{tr("Postponement reason")}<Input name="reason" required/></label><Button variant="secondary" disabled={busy}>{tr("Record postponement")}</Button><p className="text-sm text-muted-foreground">{tr("Update or cancel the calendar booking through RISpro as needed.")}</p></form>}
        {data.postponementReason && <p className="text-sm">{tr("Last postponement:")}{' '}{data.postponementReason}</p>}
        {data.treatment ? <section><h3 className="font-semibold">{tr("Treatment completed:")}{' '}{dateText(data.treatment.date)}</h3><p className="text-sm">{statusText(data.treatment.immobilization)} · {data.treatment.fractions} {tr("fraction(s)")} · {data.treatment.team.join(', ')}</p><Badge variant={data.treatment.finalized ? 'success' : 'warning'}>{data.treatment.finalized ? tr("Documentation finalized") : tr("Treatment report pending")}</Badge></section> : can('treatment') && episode.status === 'treatment' && <form className="space-y-3 border-t border-border pt-3" onSubmit={event => { const f = formValues(event); void run('completion', { ...f, fractions: Number(f.fractions), team: splitLines(f.team ?? ''), confirmed: f.confirmed === 'on' }); }}>
          <h3 className="font-semibold">{tr("Clinically confirmed treatment completion")}</h3><label className="block text-sm">{tr("Treatment date")}<Input name="date" type="date" max={today()} defaultValue={today()} required/></label><label className="block text-sm">{tr("Frame / mask")}<select className="input-premium w-full" name="immobilization"><option value="frame">{tr("Frame")}</option><option value="mask">{tr("Mask")}</option></select></label><label className="block text-sm">{tr("Fractions")}<Input name="fractions" type="number" min={1} max={100} defaultValue={1} required/></label><label className="block text-sm">{tr("Treatment team (one name per line)")}<Textarea dir="auto" name="team" required/></label><label className="flex items-center gap-2 text-sm"><Checkbox name="confirmed" required/>{tr("I confirm that treatment was clinically completed")}</label><Button disabled={busy}>{tr("Record completed treatment")}</Button>
        </form>}
        {can('treatment') && data.treatment?.completed && (profile.documents.some(document => document.category === 'treatment_report') ? <DisclosureSection key={`report-${episode.id}-${data.treatment.finalized}`} title={tr(data.treatment.finalized ? 'Replace finalized report' : 'Treatment report documentation')} defaultOpen={!data.treatment.finalized}><form className="space-y-3" onSubmit={event => void run('report', { ...formValues(event) })}><label className="block text-sm">{tr("Treatment report")}<select className="input-premium w-full" name="documentId" required defaultValue=""><option value="">{tr("Select uploaded treatment report")}</option>{profile.documents.filter(d => d.category === 'treatment_report').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="block text-sm">{tr("Replacement reason")}<Input name="reason" required={data.treatment.finalized}/></label><Button disabled={busy}>{tr("Finalize treatment documentation")}</Button></form></DisclosureSection> : <section className="space-y-3 border-t border-border pt-3"><p className="text-sm">{tr('Upload a treatment report for this episode first.')}</p><Button variant="secondary" onClick={() => changeTab('Documents')}>{tr(can('documents') ? 'Upload treatment report' : 'View documents')}</Button></section>)}
      </TabsContent>
      <TabsContent value="Documents" id="gk-panel-3" role="tabpanel" aria-labelledby="gk-tab-3" className="mt-4"><Documents profile={profile} run={run} busy={busy} refresh={refresh} onError={setError}/>
        {can('documents') && <section className="mt-5 border-t border-border pt-3"><h3 className="font-semibold">{tr("Patient QR access")}</h3><p className="text-sm">{episode.qrActive ? tr("Active QR credential") : tr("No active QR credential")}. {tr('Replacing it invalidates the previous code.')}</p><div className="flex flex-wrap gap-2 mt-2"><Button variant="secondary" disabled={busy || !profile.config.qrEnabled} onClick={() => void run('qr_replace', {})}>{episode.qrActive ? tr("Replace QR code") : tr("Create QR code")}</Button><Button variant="secondary" disabled={busy || !episode.qrActive} onClick={() => void run('qr_revoke', {})}>{tr("Revoke QR code")}</Button></div>{qr && <div className="mt-3"><img src={qr.image} alt={tr("Patient episode QR code")} width={256} height={256}/><a className="underline break-all text-sm" href={qr.url} target="_blank" rel="noreferrer">{tr("Open patient page")}</a><p className="text-sm text-muted-foreground">{tr("Save or print this code now. The link is shown only when issued.")}</p></div>}</section>}
      </TabsContent>
      <TabsContent value="Follow-up" id="gk-panel-4" role="tabpanel" aria-labelledby="gk-tab-4" className="mt-4 space-y-4">
        <BookingLink profile={profile} purpose="followup" run={run} busy={busy}/>
        {data.followups?.map((visit, index) => <section key={index} className="border-t border-border pt-3"><h3 className="font-semibold">{dateText(visit.date)}</h3><p className="whitespace-pre-wrap text-sm">{visit.condition}</p><p className="text-sm">{tr("Imaging information")}: {visit.imaging || tr('Not recorded')} · {tr("Imaging response")}: {visit.response || tr('Not recorded')}</p>{visit.complications && <p className="text-sm">{tr("Complications")}: {visit.complications} · {visit.severity} · {tr("Actions")}: {visit.actions}</p>}</section>)}
        {!data.followups?.length && <EmptyState message={tr("No follow-up visits recorded.")}/>}
        {can('clinical') && episode.status === 'followup' && <form className="space-y-3" onSubmit={event => void run('followup', formValues(event))}><h3 className="font-semibold">{tr("Record follow-up")}</h3><label className="block text-sm">{tr("Visit date")}<Input name="date" type="date" max={today()} defaultValue={today()} required/></label>{[['condition', 'Clinical condition and symptoms'], ['imaging', 'Imaging results'], ['response', 'Imaging response'], ['complications', 'Complications'], ['severity', 'Severity'], ['actions', 'Actions']].map(([name, label]) => <label key={name} className="block text-sm">{tr(label)}<Textarea dir="auto" name={name} required={name === 'condition'}/></label>)}<Button disabled={busy}>{tr("Save follow-up visit")}</Button></form>}
        {can('clinical') && episode.status === 'followup' && <form className="space-y-2 border-t border-border pt-3" onSubmit={event => void run('close', formValues(event))}><label className="block text-sm">{tr("Reason for ending this episode\u2019s follow-up")}<Textarea dir="auto" name="reason" required/></label><Button variant="secondary" disabled={busy || !data.treatment?.finalized}>{tr("Close episode")}</Button></form>}
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
function Documents({ profile, run, busy, refresh, onError }: {
    profile: Profile;
    run: Command;
    busy: boolean;
    refresh: () => void;
    onError: (message: string) => void;
}) {
    const { tr, categoryText, statusText } = useGammaKnifeText();
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const fileInputId = useId();
    const [fileName, setFileName] = useState('');
    const { episode } = profile;
    return <div className="space-y-4"><h3 className="font-semibold">{tr("Diagnosis document checklist")}</h3>{episode.data.checklist?.length ? <ul className="list-disc ps-5 text-sm">{episode.data.checklist.map(item => <li key={item}>{item}</li>)}</ul> : <p className="text-sm text-muted-foreground">{tr("No additional diagnosis checklist configured.")}</p>}
    {profile.documents.map(document => <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><div><a className="underline break-all" href={`/api/gamma-knife/episodes/${episode.id}/documents/${document.id}`} target="_blank" rel="noreferrer">{document.name}</a><p className="text-sm">{categoryText(document.category)} · {statusText(document.visibility)} · {document.released ? tr("Released") : tr("Internal")}</p></div>{profile.permissions.includes('documents') && <Button size="sm" variant="secondary" disabled={busy || uploading || (document.visibility !== 'routine' && !document.released)} onClick={() => void run('document_visibility', { documentId: document.id, released: !document.released })}>{document.released ? tr("Withdraw patient access") : document.visibility === "sensitive" ? tr("Sensitive document \u2014 contact the clinic") : tr("Allow patient access")}</Button>}</div>)}
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
                    refresh();
                }
                catch (error) {
                    onError(error instanceof Error ? error.message : 'Upload failed.');
                }
                finally {
                    setUploading(false);
                }
            }}><label className="block text-sm">{tr("Document category")}<select className="input-premium w-full" name="category" defaultValue={episode.data.treatment?.completed && !episode.data.treatment.finalized ? 'treatment_report' : 'referral'}>{CATEGORIES.map(category => <option key={category} value={category}>{categoryText(category)}</option>)}</select></label>
      <div className="space-y-2"><label htmlFor={fileInputId} className="block text-sm">{tr('File (PDF, JPEG or PNG)')}</label><Input ref={fileInput} id={fileInputId} className="sr-only" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required onChange={event => setFileName(event.target.files?.[0]?.name ?? '')}/><div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" disabled={busy || uploading} onClick={() => fileInput.current?.click()}>{tr('Choose file')}</Button><bdi className="min-w-0 break-all text-sm">{fileName || tr('No file selected')}</bdi></div></div>
      <Button disabled={busy || uploading || !fileName}>{uploading ? tr("Uploading\u2026") : tr("Upload document")}</Button></form>}
  </div>;
}
