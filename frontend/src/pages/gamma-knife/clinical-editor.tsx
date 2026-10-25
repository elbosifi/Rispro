import { useGammaKnifeText } from './use-gamma-knife-text';
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, DisclosureSection, Textarea } from '@/components/shared';
import { registerUnsavedNavigationGuard } from '@/lib/unsaved-navigation-guard';
import { action, type Clinical, type Episode } from './api';
const EMPTY: Clinical = { history: '', examination: '', imaging: '', assessment: '', priorTreatment: '', diagnosisDetails: '', priorTreatmentUnavailable: false };
const FIELDS = [['history', 'History'], ['examination', 'Examination'], ['imaging', 'Imaging information'], ['assessment', 'Clinical assessment'], ['priorTreatment', 'Prior treatment']] as const;
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
            const result = await action({ ...episode, revision: revision.current }, status ? 'submit' : 'clinical', { clinical: answers, status, reason });
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
    const editable = enabled && ['referrals', 'clinical_review', 'mdt'].includes(episode.status) && !episode.data.investigationsPending;
    return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{editable ? tr('Complete the required sections, then submit for MDT. Your draft saves automatically.') : tr(!episode.active ? 'This episode is closed. Its clinical history remains available.' : episode.data.investigationsPending ? 'Waiting for requested investigations. Record receipt before returning to clinical review.' : !enabled ? 'You can view this record. Editing requires the relevant permission.' : 'The clinical assessment is read-only after MDT approval. Earlier versions remain in the episode history.')}</p>
    <p className="text-sm">{tr("Assessment:")}{' '}<strong>{statusText(episode.data.assessmentStatus ?? 'draft')}</strong> · <span role="status">{busy ? tr("Saving\u2026") : dirty ? tr("Unsaved changes") : tr("Saved")}</span></p>
    {FIELDS.map(([key, label], index) => <DisclosureSection key={key} title={`${tr(label)}${index < 4 ? ' *' : ''}`} defaultOpen={index === 0}>
      {editable ? <label className="block text-sm">{tr(label)}<Textarea dir="auto" aria-label={tr(label)} rows={4} value={answers[key]} disabled={key === 'priorTreatment' && answers.priorTreatmentUnavailable} onChange={e => edit(key, e.target.value)}/></label> : <p dir="auto" className="whitespace-pre-wrap text-sm">{key === 'priorTreatment' && answers.priorTreatmentUnavailable ? tr('Information unavailable') : answers[key] || tr('Not recorded')}</p>}
      {editable && key === 'priorTreatment' && <label className="flex items-center gap-2 mt-2 text-sm"><Checkbox checked={answers.priorTreatmentUnavailable} onCheckedChange={checked => edit('priorTreatmentUnavailable', checked)}/>{tr("Information unavailable")}</label>}
    </DisclosureSection>)}
    {diagnosisDetails && <DisclosureSection title={`${tr(episode.diagnosisCategory)}: ${tr('Additional information')}`}><label className="block text-sm">{tr("Diagnosis-specific information")}<Textarea dir="auto" aria-label={tr("Diagnosis-specific information")} rows={4} value={answers.diagnosisDetails} disabled={!editable} onChange={e => edit('diagnosisDetails', e.target.value)}/></label></DisclosureSection>}
    {editable && (episode.data.assessmentStatus === 'finalized' || Boolean(reason)) && <label className="block text-sm">{tr("Correction reason (required when changing a finalized assessment)")}<Textarea dir="auto" value={reason} onChange={e => { setReason(e.target.value); setError(''); }}/></label>}
    {error && <p role="alert" className="text-red-700">{errorText(error)}</p>}
    {conflict ? <Button variant="secondary" onClick={() => window.location.reload()}>{tr("Reload latest version (discard local draft)")}</Button> : editable && <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void save()}>{tr("Save draft")}</Button><Button disabled={busy} onClick={() => void save('provisional')}>{tr("Submit provisional")}</Button><Button disabled={busy} onClick={() => void save('finalized')}>{tr("Submit finalized")}</Button></div>}
  </div>;
}
