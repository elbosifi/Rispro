import { useGammaKnifeText } from './use-gamma-knife-text';
import './gamma-knife.css';
import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, ErrorState, LoadingState } from '@/components/shared';
import { loadPublicDocument, publicView } from './api';
const FilePreview = lazy(() => import('@/pages/request-scans/request-scan-file-preview'));
export function GammaKnifePublicPage() {
    const { tr, errorText, isArabic, language, toggleLanguage, dateText } = useGammaKnifeText();
    const [token] = useState(() => window.location.hash.slice(1));
    const [error, setError] = useState('');
    const [documentLoading, setDocumentLoading] = useState(false);
    const [preview, setPreview] = useState<{ file: Blob; name: string } | null>(null);
    const query = useQuery({ queryKey: ['gamma-knife-public'], queryFn: () => publicView(token), retry: false, gcTime: 0, staleTime: 0 });
    return <main lang={language} dir={isArabic ? "rtl" : "ltr"} className="gk-shell min-h-screen bg-background text-foreground p-4 sm:p-6"><div className="max-w-2xl mx-auto space-y-4"><header className="flex flex-wrap justify-between items-center gap-3"><h1 className="text-2xl font-semibold">{tr("Gamma Knife patient page")}</h1><Button variant="secondary" size="sm" onClick={toggleLanguage} aria-label={isArabic ? 'Switch to English' : 'التبديل إلى العربية'}>{isArabic ? 'English' : 'العربية'}</Button></header>
    {query.isPending ? <LoadingState message={tr('Loading…')} /> : query.error ? <ErrorState retryLabel={tr('Retry')} message={tr("This patient link is unavailable. Please contact the clinic.")}/> : <>
      <Card><h2 className="font-semibold">{tr("Your progress")}</h2><p className="mt-2">{tr(query.data.progress)}</p></Card>
      <Card><h2 className="font-semibold">{tr("Confirmed appointments")}</h2>{query.data.appointments.length ? query.data.appointments.map(appointment => <p className="mt-2" key={appointment.purpose}>{appointment.purpose === 'treatment' ? tr("Treatment") : tr("Follow-up")}: {dateText(appointment.date)} {appointment.time?.slice(0, 5)}</p>) : <EmptyState message={tr("No confirmed appointment yet.")}/>}</Card>
      {query.data.actions && <Card><h2 className="font-semibold">{tr("Required actions")}</h2><p className="whitespace-pre-wrap mt-2">{query.data.actions}</p></Card>}
      {query.data.instructions && <Card><h2 className="font-semibold">{tr("Preparation instructions")}</h2><p className="whitespace-pre-wrap mt-2">{query.data.instructions}</p></Card>}
      <Card><h2 className="font-semibold">{tr("Your documents")}</h2>{query.data.documents.length ? <div className="flex flex-col items-start gap-3 mt-3">{query.data.documents.map(document => <Button variant="secondary" key={document.id} disabled={documentLoading} onClick={async () => { setError(''); setDocumentLoading(true); try {
            const file = await loadPublicDocument(token, document.id);
            setPreview({ file, name: document.name });
        }
        catch {
            setError('This document is unavailable. Please contact the clinic.');
        } finally { setDocumentLoading(false); } }}>{document.name}</Button>)}</div> : <EmptyState message={tr("No patient documents available.")}/>}<p className="text-sm text-muted-foreground mt-3">{tr("For sensitive clinical documents, please contact the clinic.")}</p></Card>
      {error && <p role="alert">{errorText(error)}</p>}
    </>}
    <Dialog open={preview !== null} onClose={() => setPreview(null)}>{preview && <DialogContent maxWidth="960px" scrollable={false} className="gk-shell flex h-[85dvh] min-h-0 flex-col" lang={language} dir={isArabic ? 'rtl' : 'ltr'} aria-labelledby="gamma-patient-document-title"><DialogHeader closeLabel={tr('Close document')}><DialogTitle id="gamma-patient-document-title" className="break-all text-base">{preview.name}</DialogTitle></DialogHeader><div className="min-h-0 flex-1"><Suspense fallback={<LoadingState message={tr('Loading…')} />}><FilePreview file={preview.file} filename={preview.name} language={language} title={preview.name} /></Suspense></div></DialogContent>}</Dialog>
  </div></main>;
}
