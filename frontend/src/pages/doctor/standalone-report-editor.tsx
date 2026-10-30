import {useEffect,useLayoutEffect,useCallback,useRef,useState} from 'react';
import {Link,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button,Card,Textarea,LoadingState,ErrorState,Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/shared';
import {api,ApiError} from '@/lib/api-client';
import {REPORT_FIELDS,reportBase,post,requestId,reportTypes,reportingReturn,loadReportingPreferences,saveReportingPreferences,refreshReportingQueries,formatStudyDate,type WorkspaceReport,type ReportSections} from '@/lib/reporting-workspace-api';
import {useWorkspaceImages} from '@/lib/use-workspace-images';
import {useAuth} from '@/providers/auth-provider';
import {registerUnsavedNavigationGuard,requestNavigationWithUnsavedGuard} from '@/lib/unsaved-navigation-guard';
import {useDictation} from '@/providers/dictation-context';
import {ReportRevisionHistory} from './report-revision-history';

export function StandaloneReportPage() {
  const {reportId=''}=useParams();
  const query=useQuery({queryKey:['workspace-report',reportId],staleTime:0,queryFn:()=>api<WorkspaceReport>(reportBase(reportId)),retry:false});
  if(query.error&&!query.data)return <ErrorState message={query.error.message}/>;
  if(!query.data)return <LoadingState message="Loading report…"/>;
  return <StandaloneReportEditor key={reportId} initial={query.data}/>;
}
function StandaloneReportEditor({initial}:{initial:WorkspaceReport}) {
  const {user}=useAuth(),dictation=useDictation(),[params]=useSearchParams(),back=reportingReturn(params.get('returnTo')),navigate=useNavigate(),client=useQueryClient(),viewer=useWorkspaceImages();
  const [saveFailure,setSaveFailure]=useState(false),leaving=useRef(false),mutationActive=useRef(false);
  const [report,setReport]=useState(initial),[text,setText]=useState(initial.sections),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[remote,setRemote]=useState<WorkspaceReport|null>(null);
  const [confirm,setConfirm]=useState(''),[reason,setReason]=useState(''),[reviewComment,setReviewComment]=useState(''),[reviewer,setReviewer]=useState(''),[historyOpen,setHistoryOpen]=useState(params.has('history'));
  const preferences=loadReportingPreferences(user?.id),[compact,setCompact]=useState(preferences.compact);
  const current=useRef({report:initial,text:initial.sections,dirty:false,conflict:false,generation:0}),chain=useRef<Promise<unknown>>(Promise.resolve()),alive=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),signId=useRef(requestId()),addendumId=useRef(requestId());
  const base=reportBase(report.id);
  const reviewers=useQuery({queryKey:['report-reviewers',report.id],enabled:report.reviewEnabled===true,queryFn:()=>api<{reviewers:{id:number;name:string}[]}>(base+'/reviewers')});
  const dictationRef=useRef(dictation);useLayoutEffect(()=>{dictationRef.current=dictation;},[dictation]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);dictationRef.current?.cancel();};},[]);
  const adopt=useCallback((r:WorkspaceReport,replaceText=false)=>{current.current.report=r;setReport(r);refreshReportingQueries(client,r);if(replaceText){current.current.text=r.sections;setText(r.sections);current.current.dirty=false;setDirty(false);setSaveFailure(false);}},[client]);
  const save=useCallback(async():Promise<void>=> {
    clearTimeout(timer.current);
    const result=chain.current.catch(()=>undefined).then(async()=>{
      const c=current.current;if(!c.dirty)return;if(c.conflict)throw new Error('Compare and reconcile the saved revision before saving.');
      const generation=c.generation,submitted={...c.text};setSaving(true);setSaveFailure(false);setError('');
      try{const saved=await api<WorkspaceReport>(base+'/draft',{method:'PUT',body:JSON.stringify({expectedRevision:c.report.revision,sections:submitted})});if(!alive.current)return;adopt(saved);const changed=current.current.generation!==generation;current.current.dirty=changed;setDirty(changed);}
      catch(e){if(alive.current){setSaveFailure(true);setError((e as Error).message);if(e instanceof ApiError&&e.status===409){current.current.conflict=true;setConflict(true);}}throw e;}
      finally{if(alive.current)setSaving(false);}
    });chain.current=result;await result;
  },[base,adopt]);
  const flush=useCallback(async()=>{do{await save();}while(current.current.dirty);},[save]);
  const prepareNavigation=useCallback(async()=>{
    if(dictationRef.current?.recording)throw new Error('Stop dictation and wait for transcription before leaving.');
    while(dictationRef.current?.processing){await new Promise(resolve=>setTimeout(resolve,50));if(!alive.current)return;}
    if(mutationActive.current)throw new Error('Wait for the report action to complete before leaving.');
    await flush();
  },[flush]);
  function edit(key:keyof ReportSections,value:string){const c=current.current;c.generation++;c.text={...c.text,[key]:value};c.dirty=true;setText(c.text);setDirty(true);clearTimeout(timer.current);if(!c.conflict)timer.current=setTimeout(()=>void save().catch(()=>undefined),1200);}
  useEffect(()=>{
    const release=registerUnsavedNavigationGuard(proceed=>{if(leaving.current)return;leaving.current=true;void(async()=>{try{if(reason)throw new Error('Complete or discard the addendum or deletion reason before leaving.');await prepareNavigation();if(alive.current)proceed();}catch(e){setError((e as Error).message);}finally{leaving.current=false;}})();});
    return release;
  },[reason,prepareNavigation]);
  useEffect(()=>{
    if(!dirty&&!saving&&!busy&&!reason&&!dictation?.busy)return;
    const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',unload);
    return()=>window.removeEventListener('beforeunload',unload);
  },[dirty,saving,busy,reason,dictation?.busy]);
  async function mutate(action:string,body:Record<string,unknown>={}) {
    if(busy||mutationActive.current)return;
    if(dictation?.busy){setError('Finish dictation before performing a report action.');return;}
    mutationActive.current=true;setBusy(true);setError('');
    try{do{await save();}while(current.current.dirty);const result=await post<WorkspaceReport>(base+'/'+action,{...body,expectedRevision:current.current.report.revision});if(alive.current){adopt(result,true);setConfirm('');setReason('');setReviewComment('');if(action==='addenda')addendumId.current=requestId();}}
    catch(e){if(alive.current){setError((e as Error).message);if(e instanceof ApiError&&e.status===409){current.current.conflict=true;setConflict(true);}}}finally{mutationActive.current=false;if(alive.current)setBusy(false);}
  }
  function images(sameTab=false){void viewer.launch(()=>post(base+'/images-launch',{}),sameTab,prepareNavigation);}
  const editable=report.canEdit&&!busy&&!report.deletedAt;
  const go=(e:React.MouseEvent,path:string)=>{e.preventDefault();requestNavigationWithUnsavedGuard(()=>navigate(path));};
  const saveState=conflict?'Revision Conflict':saving?'Saving…':saveFailure?'Save Failed':dirty?'Unsaved Changes':report.status==='final'?'Read Only / Finalized':!report.canEdit||report.deletedAt?'Read Only':'Saved';
  return <div className="mx-auto max-w-5xl space-y-4" data-dictation-context={`native-report:${report.id}:${report.status}:${report.deletedAt||'active'}`}>
    <nav className="flex flex-wrap gap-4 text-sm"><Link to={back} onClick={e=>go(e,back)} className="text-accent underline">Back to {back.startsWith('/doctor/my-work')?'My Worklist':'Reporting Worklist'}</Link><Link to={`/doctor/reporting/studies/${report.studyKey}?returnTo=${encodeURIComponent(back)}`} onClick={e=>go(e,`/doctor/reporting/studies/${report.studyKey}?returnTo=${encodeURIComponent(back)}`)} className="text-accent underline">All study reports</Link><Button size="sm" variant="secondary" disabled={busy||viewer.busy||!viewer.ready} onClick={()=>images()}>Open Images in OHIF</Button></nav>
    <Card variant="compact" className="!p-4"><div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-semibold" dir="auto">{report.identity.patientName}</h1><p>{report.identity.patientIdentifier} · {report.identity.accession||'No accession'}</p><p>{report.identity.examination} · {formatStudyDate(report.identity.studyDate)}</p><p className="text-sm">{reportTypes[report.reportType]} · {report.deletedAt?'Deleted':report.status.replaceAll('_',' ')} · Revision {report.revision}</p></div><div className="text-sm"><p>Creator: {report.author}</p><p>Last editor: {report.lastEditor}</p>{report.finalizer&&<p>Signed by: {report.finalizer} · {report.finalizedAt&&new Date(report.finalizedAt).toLocaleString()}</p>}<p>Contributors: {report.contributors.map(c=>c.name).join(', ')}</p></div></div></Card>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-[var(--card)] p-2" aria-label="Report actions"><Button disabled={!editable||saving||conflict} onClick={()=>void save().catch(()=>undefined)}>Save</Button>{report.status!=='final'&&<Button disabled={!report.canFinalize||busy||conflict||Boolean(report.deletedAt)} onClick={()=>setConfirm('finalize')}>Finalize</Button>}
      <Button variant="secondary" onClick={()=>setHistoryOpen(v=>!v)}>History / Compare</Button><a className="text-accent underline px-2" href={'/api'+base+'/print'} target="_blank" rel="noopener noreferrer">Print</a>
      {report.canDelete&&<Button variant="secondary" disabled={busy} onClick={()=>setConfirm('delete')}>Delete Draft</Button>}{report.canRecover&&<Button variant="secondary" onClick={()=>setConfirm('recover')}>Recover Draft</Button>}
      <span className="ml-auto text-sm" role="status">{saveState}</span><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={compact} onChange={e=>{setCompact(e.target.checked);saveReportingPreferences(user?.id,{...preferences,compact:e.target.checked});}}/>Compact fields</label>
    </div>
    {error&&<ErrorState message={error}/>}
    {viewer.error&&<ErrorState message={viewer.error}/>}
    {viewer.blocked&&<Button variant="secondary" disabled={viewer.busy} onClick={()=>images(true)}>Open images in this tab</Button>}{report.blockedReason&&<p role="alert" className="text-sm">{report.blockedReason}</p>}{conflict&&<Card variant="compact" className="!p-4"><p role="alert">Your unsaved text is retained. Compare it with the saved report before reconciling.</p><Button variant="secondary" onClick={()=>void api<WorkspaceReport>(base).then(setRemote).catch(e=>setError(e.message))}>Compare saved report</Button>{remote&&<><div className="grid gap-3 md:grid-cols-2">{(Object.keys(REPORT_FIELDS) as (keyof ReportSections)[]).map(k=><section key={k}><h3>{REPORT_FIELDS[k]} · Saved revision {remote.revision}</h3><pre className="whitespace-pre-wrap text-sm">{remote.sections[k]}</pre><h3>Your retained text</h3><pre className="whitespace-pre-wrap text-sm">{text[k]}</pre></section>)}</div><Button disabled={!remote.canEdit} onClick={()=>{current.current.report=remote;setReport(remote);current.current.conflict=false;setConflict(false);setSaveFailure(false);setError('');}}>Use this revision after manual reconciliation; keep my text</Button><Button variant="secondary" onClick={()=>{adopt(remote,true);current.current.conflict=false;setConflict(false);setSaveFailure(false);setError('');setRemote(null);}}>Discard my text and load saved content</Button></>}</Card>}
    <Card variant="compact" className="!p-4"><p className="mb-3 text-xs text-muted-foreground">Focus a report field and use your configured dictation shortcut or microphone control. Transcription is inserted at the cursor.</p>{(Object.keys(REPORT_FIELDS) as (keyof ReportSections)[]).map(k=><label className="mb-4 block text-sm font-medium" key={k}>{REPORT_FIELDS[k]}<Textarea aria-label={REPORT_FIELDS[k]} value={text[k]} readOnly={!editable} dir="auto" rows={compact?3:k==='findings'?12:k==='impression'?6:3} className="mt-1" onChange={e=>edit(k,e.target.value)}/></label>)}</Card>
    {report.reviewEnabled&&report.status!=='final'&&!report.deletedAt&&<Card variant="compact" className="!p-4"><h2 className="font-semibold">Review</h2><label className="block text-sm">Review comment<Textarea value={reviewComment} onChange={e=>setReviewComment(e.target.value)} readOnly={busy}/></label><label className="block text-sm">Preferred reviewer (optional)<select className="input-premium block w-full" value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Open review</option>{reviewers.data?.reviewers.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><div className="mt-2 flex flex-wrap gap-2">{report.status==='draft'&&<Button variant="secondary" disabled={!editable||conflict} onClick={()=>void mutate('review',{action:'submit',comment:reviewComment,preferredReviewerId:reviewer?Number(reviewer):null})}>Submit for Review</Button>}{report.status==='in_review'&&<><Button variant="secondary" disabled={!report.canReview||busy||conflict} onClick={()=>void mutate('review',{action:'feedback',comment:reviewComment})}>Add Feedback</Button><Button variant="secondary" disabled={!report.canReview||busy||conflict} onClick={()=>void mutate('review',{action:'return',comment:reviewComment})}>Return to Draft</Button><Button variant="secondary" disabled={busy||conflict} onClick={()=>void mutate('review',{action:'withdraw',comment:reviewComment})}>Withdraw Review</Button></>}</div></Card>}
    {report.keyImages.length>0&&<Card variant="compact" className="!p-4"><h2 className="font-semibold">Key Images</h2><div className="grid gap-3 sm:grid-cols-2">{report.keyImages.map((i,n)=><figure key={i.id}><img className="max-h-80 object-contain" src={'/api'+base+'/images/'+i.id} alt={`Report key image ${n+1}`}/><figcaption className="text-sm">{i.caption} · {i.provenance.sourceSeriesDescription} · {i.provenance.sourceStudyDate}{i.provenance.prior?' (prior)':''}</figcaption></figure>)}</div></Card>}
    {report.addenda.map(a=><Card variant="compact" key={a.id}><h2 className="font-semibold">Signed addendum</h2><p className="whitespace-pre-wrap">{a.text}</p><p className="text-sm">{a.author} · {new Date(a.signedAt).toLocaleString()}</p></Card>)}
    {report.status==='final'&&report.canFinalize&&<Card variant="compact" className="!p-4"><label className="text-sm">Addendum text<Textarea aria-label="Addendum text" value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={!reason.trim()||busy} onClick={()=>setConfirm('addenda')}>Add Addendum</Button></Card>}
    {historyOpen&&<ReportRevisionHistory report={report} onRestore={revision=>void mutate('restore-revision',{revision})}/>}
    <Dialog open={Boolean(confirm)} onClose={()=>{if(!busy){setConfirm('');if(report.status!=='final')setReason('');}}}><DialogContent><DialogHeader><DialogTitle>{confirm==='finalize'?'Finalize report':confirm==='addenda'?'Sign addendum':confirm==='recover'?'Recover draft':'Delete draft'}</DialogTitle><DialogDescription>{report.identity.patientName} · {report.identity.patientIdentifier}<br/>{report.identity.accession} · {report.identity.examination}<br/>{confirm==='finalize'?`Signing as ${user?.fullName||user?.username}. Signed content is immutable; corrections require a signed addendum.`:confirm==='delete'?'The draft will be retained with its history and key images for authorized recovery.':'Confirm this report action.'}</DialogDescription></DialogHeader>{['delete','recover'].includes(confirm)&&<label>Reason<Textarea value={reason} onChange={e=>setReason(e.target.value)}/></label>}<DialogFooter><Button variant="secondary" disabled={busy} onClick={()=>setConfirm('')}>Cancel</Button><Button disabled={busy||['delete','recover','addenda'].includes(confirm)&&!reason.trim()} onClick={()=>void mutate(confirm,{confirmed:true,reason,text:reason,signerUserId:user?.id,requestId:confirm==='addenda'?addendumId.current:signId.current})}>Confirm {confirm==='finalize'||confirm==='addenda'?'and Sign':''}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
