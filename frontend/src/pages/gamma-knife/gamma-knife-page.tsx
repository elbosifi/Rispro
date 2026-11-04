import { ModuleWorkspaceSwitcher } from "@/components/layout/navigation";
import { useGammaKnifeText } from './use-gamma-knife-text';
import { chooseLocalized } from '@/lib/i18n';
import './gamma-knife.css';
import { useCallback, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState } from '@/components/shared';
import { gk, STATUS_LABELS, nextAction, today, type Config, type Episode, type Permission, type Settings } from './api';
import { GammaKnifeSettings } from './gamma-knife-settings';
import { GammaKnifeProfile } from './gamma-knife-profile';
export function GammaKnifeApplication() {
    const { tr, isArabic, language, toggleLanguage } = useGammaKnifeText();
    const identity = useQuery({ queryKey: ['gamma-knife', 'me'], queryFn: () => gk<{ permissions: Permission[]; canManageSettings: boolean }>('/me'), retry: false });
    return <main lang={language} dir={isArabic ? "rtl" : "ltr"} className="gk-shell min-h-screen bg-background text-foreground"><div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{tr("Gamma Knife")}</h1><nav aria-label={tr("Gamma Knife")}><div className="flex flex-wrap gap-4 text-sm"><a href="/">{tr("RISpro")}</a>{identity.data?.permissions.includes('access') && <a href="/gamma-knife">{tr("Patient list")}</a>}{identity.data?.canManageSettings && <a href="/gamma-knife/settings">{tr("Settings")}</a>}</div></nav><ModuleWorkspaceSwitcher language={language} currentWorkspace="gamma" /><Button variant="secondary" size="sm" onClick={toggleLanguage} aria-label={isArabic ? 'Switch to English' : 'التبديل إلى العربية'}>{isArabic ? 'English' : 'العربية'}</Button></header>
    <Routes><Route index element={<PatientList />}/><Route path="settings" element={<SettingsPage />}/><Route path="episodes/:id" element={<GammaKnifeProfile />}/><Route path="*" element={<ErrorState retryLabel={tr('Retry')} message={tr("Page not found.")}/>}/></Routes>
  </div></main>;
}
function SettingsPage() {
    const { tr, errorText } = useGammaKnifeText();
    const queryClient = useQueryClient();
    const query = useQuery({ queryKey: ['gamma-knife', 'settings'], queryFn: () => gk<Settings>('/settings'), retry: false });
    if (query.isPending)
        return <LoadingState message={tr('Loading…')} />;
    if (query.error)
        return <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={() => void query.refetch()}/>;
    return <GammaKnifeSettings initial={query.data} onSaved={() => { void query.refetch(); void queryClient.invalidateQueries({ queryKey: ['gamma-knife', 'me'] }); }}/>;
}
function PatientList() {
    const { tr, errorText, patientName, dateText } = useGammaKnifeText();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [followupTiming, setFollowupTiming] = useState('all');
    const navigate = useNavigate();
    const query = useQuery({ queryKey: ['gamma-knife', 'episodes', search, status], queryFn: () => gk<{
            episodes: Episode[];
            config: Config;
        }>(`/episodes?${new URLSearchParams({ q: search, status })}`), retry: false });
    const identity = useQuery({ queryKey: ['gamma-knife', 'me'], queryFn: () => gk<{
            permissions: Permission[];
        }>('/me') });
    const created = useCallback((episode: Episode) => navigate(`/gamma-knife/episodes/${episode.id}`), [navigate]);
    const episodes = query.data?.episodes.filter(episode => {
        if (followupTiming === 'all') return true;
        if (episode.status !== 'followup' || !episode.followupDate) return false;
        const daysUntil = (Date.parse(episode.followupDate) - Date.parse(today())) / 86400000;
        if (!Number.isFinite(daysUntil)) return false;
        return followupTiming === 'overdue' ? daysUntil < 0 : daysUntil >= 0 && daysUntil <= query.data!.config.reminderDays;
    });
    return <div className="space-y-4"><Card><div className="flex flex-wrap items-end gap-3"><label className="flex-1 min-w-48 text-sm">{tr("Search patients")}<Input value={search} placeholder={tr("Name, MRN, diagnosis")} onChange={e => setSearch(e.target.value)}/></label><label className="text-sm">{tr("Workflow stage")}<select className="input-premium block" value={status} onChange={e => setStatus(e.target.value)}><option value="">{tr("All episodes")}</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{tr(label)}</option>)}</select></label><label className="text-sm">{tr('Follow-up timing')}<select className="input-premium block" value={followupTiming} onChange={e => setFollowupTiming(e.target.value)}><option value="all">{tr('All follow-ups')}</option><option value="due">{tr('Follow-up due soon')}</option><option value="overdue">{tr('Overdue follow-up only')}</option></select></label></div></Card>
    {query.isPending ? <LoadingState message={tr('Loading…')} /> : query.error ? <ErrorState retryLabel={tr('Retry')} message={errorText(query.error.message)} onRetry={() => void query.refetch()}/> : <>
      {identity.data?.permissions.includes('referral') && <ReferralForm config={query.data.config} onCreated={created}/>}
      {!episodes?.length ? <EmptyState message={tr("No Gamma Knife episodes match these filters.")}/> : <div className="space-y-2">{episodes.map(episode => {
        const daysUntil = episode.followupDate ? (Date.parse(episode.followupDate) - Date.parse(today())) / 86400000 : Number.POSITIVE_INFINITY;
        const dueWithinWindow = episode.status === 'followup' && Number.isFinite(daysUntil) && daysUntil <= query.data.config.reminderDays;
        return <Card key={episode.id} className="gk-worklist-row"><div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3"><div className="min-w-0 flex-1"><Link className="font-semibold underline" to={`/gamma-knife/episodes/${episode.id}`}>{patientName(episode)}</Link><p className="text-sm text-muted-foreground">{tr("MRN")} <bdi dir="ltr">{episode.mrn}</bdi> · {episode.diagnosis}</p><p className="mt-2 text-sm">{tr("Next action:")}{' '}{tr(nextAction(episode))}</p>{dueWithinWindow && <p className="mt-1 text-sm font-medium">{daysUntil < 0 ? tr("Overdue follow-up") : tr("Upcoming follow-up")}: {dateText(episode.followupDate!)}</p>}</div><div className="flex flex-wrap items-center gap-3"><Badge>{tr(STATUS_LABELS[episode.status])}</Badge><Link className="rounded-md border border-border px-3 py-2 text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" to={`/gamma-knife/episodes/${episode.id}`} aria-label={`${tr('Open next task')}: ${patientName(episode)}`}>{tr('Open next task')}</Link></div></div></Card>;
      })}</div>}
    </>}
  </div>;
}
function ReferralForm({ config, onCreated }: {
    config: Config;
    onCreated: (episode: Episode) => void;
}) {
    const { tr, errorText, language } = useGammaKnifeText();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [patientId, setPatientId] = useState('');
    const [diagnosis, setDiagnosis] = useState('');
    const [category, setCategory] = useState(config.diagnoses[0]?.name ?? '');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const candidates = useQuery({ queryKey: ['gamma-knife', 'patients', search], queryFn: () => gk<{
            patients: {
                id: number;
                mrn: string;
                name: string; arabicName: string | null; englishName: string | null;
            }[];
        }>(`/patients?q=${encodeURIComponent(search)}`), enabled: open && search.length >= 2 });
    const selectedPatient = candidates.data?.patients.find(patient => String(patient.id) === patientId);
    if (!open)
        return <Button onClick={() => setOpen(true)}>{tr("Register referral")}</Button>;
    return <Card><h2 className="font-semibold">{tr("Register referral")}</h2><p className="text-sm mt-1">{tr("Select an existing patient.")}<a className="underline" href="/patients" target="_blank" rel="noreferrer">{tr("Open RISpro patient registration")}</a></p><div className="grid gap-3 mt-3 sm:grid-cols-2"><label className="text-sm">{tr("Find patient")}<Input value={search} onChange={e => { setSearch(e.target.value); setPatientId(''); }} placeholder={tr("Enter name or MRN")}/></label><label className="text-sm">{tr("Patient")}<select className="input-premium w-full" value={patientId} onChange={e => setPatientId(e.target.value)}><option value="">{tr("Select verified patient")}</option>{candidates.data?.patients.map(p => <option key={p.id} value={p.id}>{chooseLocalized(language, p.arabicName, p.englishName) || p.name} · {p.mrn}</option>)}</select></label><label className="text-sm">{tr("Provisional diagnosis")}<Input value={diagnosis} onChange={e => setDiagnosis(e.target.value)}/></label><label className="text-sm">{tr("Diagnosis category")}<select className="input-premium w-full" value={category} onChange={e => setCategory(e.target.value)}>{config.diagnoses.map(d => <option key={d.name}>{tr(d.name)}</option>)}</select></label></div>
    {selectedPatient && <p role="status" className="gk-clinical-note mt-3 text-sm">{tr('Selected patient:')} <strong>{chooseLocalized(language, selectedPatient.arabicName, selectedPatient.englishName) || selectedPatient.name} · {tr('MRN')} <bdi dir="ltr">{selectedPatient.mrn}</bdi></strong></p>}
    {error && <p role="alert" className="mt-3 text-red-700">{errorText(error)}</p>}<div className="mt-4 flex gap-2"><Button disabled={busy || !patientId || !diagnosis.trim()} onClick={async () => { setBusy(true); setError(''); try {
        const result = await gk<{
            episode: Episode;
        }>('/episodes', { patientId: Number(patientId), diagnosis, diagnosisCategory: category });
        onCreated(result.episode);
    }
    catch (error) {
        setError(error instanceof Error ? error.message : 'Registration failed.');
    }
    finally {
        setBusy(false);
    } }}>{tr("Create episode")}</Button><Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{tr("Cancel")}</Button></div>
  </Card>;
}
