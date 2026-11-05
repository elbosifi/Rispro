import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Checkbox, ErrorState } from '@/components/shared';
import { useLanguage } from '@/providers/language-provider';
import { updateUserModuleAccess } from '@/lib/api/settings';
import type { ModuleAccess } from '@/types/api';

export function ModuleAccessSection({ userId, access, disabled, unrestricted = false, onSaved }: { userId: number; access: ModuleAccess; disabled: boolean; unrestricted?: boolean; onSaved: () => Promise<void> }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const tr = (en: string, arabic: string) => ar ? arabic : en;
  const [mode, setMode] = useState(access.mode);
  const [grants, setGrants] = useState(access.mode === 'legacy' ? access.modules.filter(m => m.effective).map(m => m.id) : access.grants);
  const [landing, setLanding] = useState(access.defaultModule ?? '');
  const mutation = useMutation({ mutationFn: () => updateUserModuleAccess(userId, { mode, grants: mode === 'legacy' ? [] : grants, defaultModule: landing || null }), onSuccess: onSaved });
  const name = (m: ModuleAccess['modules'][number]) => ar ? m.nameAr : m.nameEn;
  return <section className="space-y-3 rounded-lg border border-border p-3" aria-label={tr('Module Access', 'الوصول إلى الوحدات')}>
    <h4 className="font-semibold">{tr('Module Access', 'الوصول إلى الوحدات')}</h4>
    <p className="text-sm text-muted-foreground">{tr('Module access controls which workspace can open. Existing clinical permissions still control actions and records. Changes revoke active sessions. Access changes appear in Security activity.', 'يحدد الوصول الوحدات المتاحة. وتبقى الصلاحيات السريرية مسؤولة عن الإجراءات والسجلات. تُلغى الجلسات عند الحفظ وتظهر التغييرات في نشاط الأمان.')}</p>
    <fieldset disabled={disabled || mutation.isPending} className="space-y-3">
      <label className="block text-sm">{tr('Access policy', 'سياسة الوصول')}<select className="input-premium mt-1 w-full" value={mode} disabled={unrestricted} onChange={e => setMode(e.target.value as typeof mode)}><option value="legacy">{tr('Preserve existing role and module access', 'الحفاظ على الوصول الحالي حسب الدور')}</option><option value="restricted">{tr('Only selected modules (default deny)', 'الوحدات المحددة فقط')}</option></select></label>
      <div className="grid gap-2 sm:grid-cols-2">{access.modules.map(m => <label key={m.id} className="flex items-start gap-2 rounded border border-border p-2 text-sm"><Checkbox checked={mode === 'legacy' ? m.granted && m.eligible : grants.includes(m.id)} disabled={mode === 'legacy' || !m.available} onCheckedChange={checked => setGrants(current => checked ? [...current, m.id] : current.filter(id => id !== m.id))}/><span><strong>{name(m)}</strong><span className="block text-muted-foreground">{tr('Effective now', 'الوصول الفعلي الآن')}: {m.effective ? tr('Yes', 'نعم') : tr('No', 'لا')}</span>{!m.eligible && <span className="block text-muted-foreground">{tr('Requires module permissions or an active profile.', 'يتطلب صلاحيات الوحدة أو ملفاً نشطاً.')}</span>}{m.permissions.length > 0 && <span className="block break-words text-muted-foreground">{tr('Action permissions', 'صلاحيات الإجراءات')}: {m.permissions.join(', ')}</span>}</span></label>)}</div>
      <label className="block text-sm">{tr('Default landing module', 'الوحدة الافتراضية بعد الدخول')}<select className="input-premium mt-1 w-full" value={landing} onChange={e => setLanding(e.target.value)}><option value="">{tr('First authorized module', 'أول وحدة مصرح بها')}</option>{access.modules.filter(m => m.eligible && (mode === 'legacy' ? m.granted : grants.includes(m.id))).map(m => <option key={m.id} value={m.id}>{name(m)}</option>)}</select></label>
      <Button size="sm" onClick={() => mutation.mutate()}>{tr('Save module access', 'حفظ الوصول إلى الوحدات')}</Button>
    </fieldset>
    {disabled && <p className="text-sm text-muted-foreground">{tr('A different administrator must change this account’s module access. Super administrators retain full administrative access.', 'يجب أن يغيّر مسؤول آخر وصول هذا الحساب. يحتفظ المسؤول الأعلى بالوصول الإداري الكامل.')}</p>}
    {mutation.isError && <ErrorState message={mutation.error.message}/>}
  </section>;
}
