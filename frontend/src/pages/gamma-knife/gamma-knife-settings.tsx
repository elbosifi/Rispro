import { useGammaKnifeText } from './use-gamma-knife-text';
import { chooseLocalized } from '@/lib/i18n';
import { useState } from 'react';
import { Button, Card, Checkbox, Input, Textarea } from '@/components/shared';
import { CATEGORIES, PERMISSIONS, gk, splitLines, type Settings, type Permission } from './api';
export function GammaKnifeSettings({ initial, onSaved }: {
    initial: Settings;
    onSaved: () => void;
}) {
    const { tr, errorText, permissionText, categoryText, roleText, language } = useGammaKnifeText();
    const [value, setValue] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const update = (patch: Partial<Settings['config']>) => { setSaved(false); setValue(v => ({ ...v, config: { ...v.config, ...patch } })); };
    const toggle = (userId: number, permission: Permission, checked: boolean) => { setSaved(false); setValue(v => ({ ...v, users: v.users.map(u => u.id === userId ? { ...u, permissions: checked ? [...new Set([...u.permissions, 'access' as Permission, permission])] : permission === 'access' ? [] : u.permissions.filter(p => p !== permission) } : u) })); };
    async function save() {
        setBusy(true);
        setError('');
        setSaved(false);
        try {
            const payload = { ...value, config: { ...value.config, consultants: splitLines(value.config.consultants.join('\n')), diagnoses: value.config.diagnoses.map(d => ({ ...d, checklist: splitLines(d.checklist.join('\n')) })) } };
            const saved = await gk<Settings>('/settings', payload, 'PUT');
            setValue(saved);
            setSaved(true);
            onSaved();
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Save failed.');
        }
        finally {
            setBusy(false);
        }
    }
    return <fieldset disabled={busy} className="min-w-0 space-y-4">
    <Card><h2 className="text-lg font-semibold">{tr("Assigned users")}</h2><p className="text-sm text-muted-foreground">{tr("Existing RISpro users and action permissions. Access is required for every internal action.")}</p>
      <div className="mt-4 space-y-4">{value.users.map(user => <fieldset key={user.id} className="border-t border-border pt-3"><legend className="font-medium">{user.name} <span className="text-sm text-muted-foreground">({roleText(user.role)}{user.active ? '' : `, ${tr('Inactive')}`})</span></legend><div className="flex flex-wrap gap-x-5 gap-y-2">{PERMISSIONS.map(permission => <label key={permission} className="flex items-center gap-2 text-sm"><Checkbox aria-label={`${user.name}: ${permissionText(permission)}`} checked={user.permissions.includes(permission)} disabled={busy} onCheckedChange={checked => toggle(user.id, permission, checked)}/>{permissionText(permission)}</label>)}</div></fieldset>)}</div>
    </Card>
    <Card><h2 className="text-lg font-semibold">{tr("Diagnosis categories and document checklists")}</h2><div className="space-y-3 mt-3">{value.config.diagnoses.map((diagnosis, index) => <div key={index} className="grid gap-2 sm:grid-cols-2"><label className="text-sm">{tr("Category")}<Input aria-label={`${tr('Category')} ${index + 1}`} value={diagnosis.name} onChange={e => update({ diagnoses: value.config.diagnoses.map((d, i) => i === index ? { ...d, name: e.target.value } : d) })}/></label><label className="text-sm">{tr("Required documents (one per line)")}<Textarea dir="auto" aria-label={`${tr('Diagnosis document checklist')} ${index + 1}`} value={diagnosis.checklist.join('\n')} onChange={e => update({ diagnoses: value.config.diagnoses.map((d, i) => i === index ? { ...d, checklist: e.target.value.split('\n') } : d) })}/></label></div>)}</div><Button variant="secondary" className="mt-3" onClick={() => update({ diagnoses: [...value.config.diagnoses, { name: '', checklist: [] }] })}>{tr("Add category")}</Button>
      <label className="mt-4 flex items-center gap-2 text-sm"><Checkbox checked={value.config.diagnosisDetailsEnabled} onCheckedChange={checked => update({ diagnosisDetailsEnabled: checked })}/>{tr("Show diagnosis-specific clinical information section")}</label>
    </Card>
    <Card><h2 className="text-lg font-semibold">{tr("Consultants and scheduling")}</h2><label className="block text-sm mt-3">{tr("Consultant directory (one name per line)")}<Textarea dir="auto" value={value.config.consultants.join('\n')} onChange={e => update({ consultants: e.target.value.split('\n') })}/></label><div className="mt-3 grid gap-3 sm:grid-cols-2">{(['treatmentExamTypeId', 'followupExamTypeId'] as const).map(key => <label key={key} className="text-sm">{key === 'treatmentExamTypeId' ? tr("Treatment exam type") : tr("Follow-up exam type")}<select className="input-premium w-full" value={value.config[key] ?? ''} onChange={e => update({ [key]: e.target.value ? Number(e.target.value) : null })}><option value="">{tr("Select existing RISpro exam type")}</option>{value.exams.map(exam => <option key={exam.id} value={exam.id}>{chooseLocalized(language, exam.arabicName, exam.name)}</option>)}</select></label>)}</div><label className="block text-sm mt-3">{tr("Upcoming follow-up window (days)")}<Input type="number" min={0} max={365} value={value.config.reminderDays} onChange={e => update({ reminderDays: Number(e.target.value) })}/></label></Card>
    <Card><h2 className="text-lg font-semibold">{tr("Patient document visibility")}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{CATEGORIES.map(category => <label key={category} className="text-sm">{categoryText(category)}<select className="input-premium w-full" value={value.config.documentVisibility[category]} onChange={e => update({ documentVisibility: { ...value.config.documentVisibility, [category]: e.target.value as 'internal' | 'routine' | 'sensitive' } })}><option value="internal">{tr("Internal only")}</option><option value="routine">{tr("Routine patient document")}</option><option value="sensitive">{tr("Sensitive \u2014 verification required")}</option></select></label>)}</div><label className="mt-4 flex items-center gap-2 text-sm"><Checkbox checked={value.config.qrEnabled} onCheckedChange={checked => update({ qrEnabled: checked })}/>{tr("Enable patient QR page")}</label><p className="text-sm text-muted-foreground mt-3">{tr("SMS verification is deferred. Sensitive documents remain unavailable on the patient page.")}</p></Card>
    {error && <p role="alert" className="text-red-700">{errorText(error)}</p>}{saved && <p role="status">{tr('Settings saved.')}</p>}<Button disabled={busy} onClick={() => void save()}>{busy ? tr("Saving\u2026") : tr("Save settings")}</Button>
  </fieldset>;
}
