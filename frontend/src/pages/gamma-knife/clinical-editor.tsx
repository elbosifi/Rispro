import { useGammaKnifeText } from './use-gamma-knife-text';
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, DisclosureSection, Input, Textarea } from '@/components/shared';
import { registerUnsavedNavigationGuard } from '@/lib/unsaved-navigation-guard';
import { action, type Clinical, type Episode } from './api';
const EMPTY: Clinical = { history: '', examination: '', imaging: '', assessment: '', priorTreatment: '', diagnosisDetails: '', priorTreatmentUnavailable: false };
const FIELDS = [['history', 'History'], ['examination', 'Examination'], ['imaging', 'Imaging information'], ['assessment', 'Clinical assessment'], ['priorTreatment', 'Prior treatment']] as const;
function emptyStructuredDetails(category: string): NonNullable<Clinical['structuredDetails']> | undefined {
    const normalized = category.toLowerCase();
    if (normalized.includes('metast')) return { schemaVersion: 1, diagnosis: 'brain_metastases', lesions: [] };
    if (normalized.includes('schwannoma') || normalized.includes('vestibular')) return { schemaVersion: 1, diagnosis: 'vestibular_schwannoma', laterality: '', cpaIacDetails: '', hearingAssessment: '', audiology: '' };
    if (normalized.includes('pituitary') || normalized.includes('parasellar')) return { schemaVersion: 1, diagnosis: 'pituitary_parasellar', opticApparatusRelationship: '', additionalAssessment: '' };
    if (normalized.includes('trigeminal') || normalized.includes('neuralgia')) return { schemaVersion: 1, diagnosis: 'trigeminal_neuralgia', painHistory: '', painAssessment: '', priorTreatmentResponse: '' };
    return undefined;
}
export function ClinicalEditor({ episode, enabled, diagnosisDetails, onSaved, onDirty }: {
    episode: Episode;
    enabled: boolean;
    diagnosisDetails: boolean;
    onSaved: () => void;
    onDirty: (dirty: boolean) => void;
}) {
    const { tr, errorText, statusText } = useGammaKnifeText();
    const [answers, setAnswers] = useState<Clinical>(episode.data.clinical ?? EMPTY);
    const [reason, setReason] = useState('');
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [conflict, setConflict] = useState(false);
    const revision = useRef(episode.revision);
    const sequence = useRef(0);
    useEffect(() => {
        // A completed save can precede the parent's refetch. Never roll its revision back.
        // Only an untouched draft may adopt a colleague's newer server contents.
        if (!dirty && !busy && episode.revision >= revision.current) {
            revision.current = episode.revision;
            setAnswers(episode.data.clinical ?? EMPTY);
        }
    }, [episode.revision, episode.data.clinical, dirty, busy]);
    useEffect(() => { onDirty(dirty || busy); return () => onDirty(false); }, [dirty, busy, onDirty]);
    useEffect(() => {
        if (!dirty && !busy)
            return;
        const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', unload);
        const unregister = registerUnsavedNavigationGuard(() => setError('Save or retry your clinical draft before leaving.'));
        return () => { window.removeEventListener('beforeunload', unload); unregister(); };
    }, [dirty, busy]);
    async function save(status?: 'provisional' | 'finalized') {
        if (busy || conflict)
            return;
        const savedSequence = sequence.current;
        setBusy(true);
        setError('');
        try {
            const clinicalAnswers = { ...answers, structuredDetails: answers.structuredDetails ?? emptyStructuredDetails(episode.diagnosisCategory) };
            const result = await action({ ...episode, revision: revision.current }, status ? 'submit' : 'clinical', { clinical: clinicalAnswers, status, reason });
            revision.current = result.episode.revision;
            if (sequence.current === savedSequence)
                setDirty(false);
            onSaved();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Save failed.';
            setError(message);
            if (message.includes('changed'))
                setConflict(true);
        }
        finally {
            setBusy(false);
        }
    }
    useEffect(() => {
        if (!dirty || busy || conflict || error || (episode.data.assessmentStatus === 'finalized' && !reason.trim()))
            return;
        const timer = window.setTimeout(() => void save(), 900);
        return () => window.clearTimeout(timer);
        // Save the current edit only; an in-flight save advances revision before another is allowed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [answers, dirty, busy, conflict, reason, error]);
    function edit<K extends keyof Clinical>(key: K, value: Clinical[K]) { sequence.current++; setAnswers(a => ({ ...a, [key]: value })); setDirty(true); setError(''); }
    const details = answers.structuredDetails ?? emptyStructuredDetails(episode.diagnosisCategory);
    function editDetails(value: NonNullable<Clinical['structuredDetails']>) { edit('structuredDetails', value); }
    const renderTextField = (key: string, label: string, value: string, update: (next: string) => void, rows = 3) => <label key={key} className="block text-sm">{tr(label)}<Textarea dir="auto" aria-label={tr(label)} rows={rows} value={value} disabled={!editable} onChange={event => update(event.target.value)}/></label>;
    const editable = enabled && ['referrals', 'clinical_review', 'mdt'].includes(episode.status) && !episode.data.investigationsPending;
    const requiredFields = FIELDS.slice(0, 4);
    const completedRequiredCount = requiredFields.filter(([key]) => answers[key].trim().length > 0).length;
    const missingRequiredFields = requiredFields.filter(([key]) => !answers[key].trim()).map(([, label]) => tr(label));
    return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{editable ? tr('Complete the required sections, then submit for MDT. Your draft saves automatically.') : tr(!episode.active ? 'This episode is closed. Its clinical history remains available.' : episode.data.investigationsPending ? 'Waiting for requested investigations. Record receipt before returning to clinical review.' : !enabled ? 'You can view this record. Editing requires the relevant permission.' : 'The clinical assessment is read-only after MDT approval. Earlier versions remain in the episode history.')}</p>
    <p className="text-sm">{tr("Assessment:")}{' '}<strong>{statusText(episode.data.assessmentStatus ?? 'draft')}</strong> · <span role="status">{busy ? tr("Saving\u2026") : dirty ? tr("Unsaved changes") : tr("Saved")}</span></p>
    <div className="gk-required-progress" aria-live="polite"><p className="text-sm">{tr('Required sections complete')}: <strong>{completedRequiredCount}/4</strong></p><progress aria-label={tr('Required sections complete')} max={4} value={completedRequiredCount}/>{missingRequiredFields.length > 0 && <p className="text-sm text-muted-foreground">{tr('Still required:')} {missingRequiredFields.join(', ')}</p>}</div>
    {editable && (episode.data.assessmentStatus === 'finalized' || Boolean(reason)) && <label className="block text-sm">{tr("Correction reason (required when changing a finalized assessment)")}<Textarea dir="auto" required={episode.data.assessmentStatus === 'finalized'} value={reason} onChange={e => { setReason(e.target.value); setError(''); }}/></label>}
    {FIELDS.map(([key, label], index) => <DisclosureSection key={key} title={`${tr(label)}${index < 4 ? ' *' : ''}`} defaultOpen={index === 0}>
      {editable ? <label className="block text-sm">{tr(label)}<Textarea dir="auto" aria-label={tr(label)} rows={4} value={answers[key]} disabled={key === 'priorTreatment' && answers.priorTreatmentUnavailable} onChange={e => edit(key, e.target.value)}/></label> : <p dir="auto" className="whitespace-pre-wrap text-sm">{key === 'priorTreatment' && answers.priorTreatmentUnavailable ? tr('Information unavailable') : answers[key] || tr('Not recorded')}</p>}
      {editable && key === 'priorTreatment' && <label className="flex items-center gap-2 mt-2 text-sm"><Checkbox checked={answers.priorTreatmentUnavailable} onCheckedChange={checked => edit('priorTreatmentUnavailable', checked)}/>{tr("Information unavailable")}</label>}
    </DisclosureSection>)}
    {diagnosisDetails && <DisclosureSection title={`${tr(episode.diagnosisCategory)}: ${tr('Additional information')}`}>
      {details?.diagnosis === 'brain_metastases' && <section className="space-y-3"><h3 className="font-medium">{tr('Individual lesion documentation')}</h3>{details.lesions.map((lesion, index) => <fieldset key={`${episode.id}-${lesion.identifier}-${index}`} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"><legend className="px-1 text-sm">{tr('Lesion')} {index + 1}</legend><label className="block text-sm">{tr('Lesion identifier')}<Input value={lesion.identifier} disabled={!editable} onChange={event => editDetails({ ...details, lesions: details.lesions.map((item, itemIndex) => itemIndex === index ? { ...item, identifier: event.target.value } : item) })}/></label><label className="block text-sm">{tr('Lesion location')}<Input value={lesion.location} disabled={!editable} onChange={event => editDetails({ ...details, lesions: details.lesions.map((item, itemIndex) => itemIndex === index ? { ...item, location: event.target.value } : item) })}/></label>{([['lengthMm','Length (mm)'],['widthMm','Width (mm)'],['depthMm','Depth (mm)']] as const).map(([key, label]) => <label key={key} className="block text-sm">{tr(label)}<Input type="number" min="0.1" max="999" step="0.1" value={lesion[key] ?? ''} disabled={!editable} onChange={event => editDetails({ ...details, lesions: details.lesions.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value === '' ? null : Number(event.target.value) } : item) })}/></label>)}{editable && <Button type="button" variant="secondary" onClick={() => editDetails({ ...details, lesions: details.lesions.filter((_, itemIndex) => itemIndex !== index) })}>{tr('Remove lesion')}</Button>}</fieldset>)}{editable && <Button type="button" variant="secondary" onClick={() => editDetails({ ...details, lesions: [...details.lesions, { identifier: `L${details.lesions.length + 1}`, location: '', lengthMm: null, widthMm: null, depthMm: null }] })}>{tr('Add lesion')}</Button>}</section>}
      {details?.diagnosis === 'vestibular_schwannoma' && <section className="space-y-3"><label className="block text-sm">{tr('Laterality')}<select className="input-premium w-full" value={details.laterality} disabled={!editable} onChange={event => editDetails({ ...details, laterality: event.target.value })}><option value="">{tr('Not recorded')}</option><option value="left">{tr('Left')}</option><option value="right">{tr('Right')}</option><option value="bilateral">{tr('Bilateral')}</option><option value="unknown">{tr('Unknown')}</option></select></label>{renderTextField('cpaIacDetails','CPA/IAC imaging details',details.cpaIacDetails,value => editDetails({ ...details,cpaIacDetails:value }))}{renderTextField('hearingAssessment','Hearing assessment',details.hearingAssessment,value => editDetails({ ...details,hearingAssessment:value }))}{renderTextField('audiology','Audiology or hearing test information',details.audiology,value => editDetails({ ...details,audiology:value }))}</section>}
      {details?.diagnosis === 'pituitary_parasellar' && <section className="space-y-3">{renderTextField('opticApparatusRelationship','Optic apparatus relationship',details.opticApparatusRelationship,value => editDetails({ ...details,opticApparatusRelationship:value }))}{renderTextField('additionalAssessment','Additional pituitary/parasellar assessment',details.additionalAssessment,value => editDetails({ ...details,additionalAssessment:value }))}</section>}
      {details?.diagnosis === 'trigeminal_neuralgia' && <section className="space-y-3">{renderTextField('painHistory','Pain history',details.painHistory,value => editDetails({ ...details,painHistory:value }))}{renderTextField('painAssessment','Pain assessment',details.painAssessment,value => editDetails({ ...details,painAssessment:value }))}{renderTextField('priorTreatmentResponse','Response to prior treatment',details.priorTreatmentResponse,value => editDetails({ ...details,priorTreatmentResponse:value }))}</section>}
      <label className="block text-sm mt-3">{tr('Additional diagnosis-specific information')}<Textarea dir="auto" aria-label={tr('Additional diagnosis-specific information')} rows={4} value={answers.diagnosisDetails} disabled={!editable} onChange={e => edit('diagnosisDetails', e.target.value)}/></label>
    </DisclosureSection>}
    {error && <p role="alert" className="text-red-700">{errorText(error)}</p>}
    {conflict ? <Button variant="secondary" onClick={() => window.location.reload()}>{tr("Reload latest version (discard local draft)")}</Button> : editable && <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void save()}>{tr("Save draft")}</Button><Button disabled={busy} onClick={() => void save('provisional')}>{tr("Submit provisional")}</Button><Button disabled={busy} onClick={() => void save('finalized')}>{tr("Submit finalized")}</Button></div>}
  </div>;
}
