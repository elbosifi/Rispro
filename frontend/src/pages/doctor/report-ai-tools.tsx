import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button,Card,Textarea,ErrorState,DisclosureSection} from '@/components/shared';
import {useAuth} from '@/providers/auth-provider';
import {REPORT_FIELDS,type ReportSections} from '@/lib/reporting-workspace-api';
import {MEDGEMMA_TASKS,generateMedGemmaText,getMedGemmaHealth,type MedGemmaTask} from '@/lib/medgemma-api';
import {changedText} from '@/lib/reporting-revision-diff';

const labels:Record<MedGemmaTask,string>={cleanup_dictation:'Medical dictation cleanup',correct_terminology:'Medical terminology correction',format_radiology_report:'Radiology-report formatting',review_radiology_report:'Radiology-report review'};
type Field=keyof ReportSections;
type Proposal={task:MedGemmaTask;field:Field;original:string;text:string;context:string;applied:boolean};
export function ReportAiTools({sections,field,onFieldChange,context,editable,onActiveChange,onApply,onUndo}:{
  sections:ReportSections;field:Field;onFieldChange:(field:Field)=>void;context:string;editable:boolean;
  onActiveChange:(active:boolean)=>void;onApply:(field:Field,text:string,context:string)=>boolean;onUndo:(field:Field,after:string,before:string)=>boolean;
}) {
  const {user}=useAuth(),[open,setOpen]=useState(false),[task,setTask]=useState<MedGemmaTask>('cleanup_dictation'),[processing,setProcessing]=useState(false),[proposal,setProposal]=useState<Proposal|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const health=useQuery({queryKey:['report-medgemma-health',user?.id],queryFn:getMedGemmaHealth,enabled:open,retry:false,staleTime:30_000});
  const latest=useRef(context),controller=useRef<AbortController|null>(null),alive=useRef(true),activeCallback=useRef(onActiveChange);
  useLayoutEffect(()=>{latest.current=context;activeCallback.current=onActiveChange;},[context,onActiveChange]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();activeCallback.current(false);};},[]);
  const input=task==='review_radiology_report'?(Object.keys(REPORT_FIELDS) as Field[]).map(key=>REPORT_FIELDS[key]+':\n'+sections[key]).join('\n\n'):sections[field];
  async function generate(){
    const snapshot=context,original=input,target=field,operation=task;
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setProcessing(true);setError('');setMessage('');setProposal(null);onActiveChange(true);
    try {
      const result=await generateMedGemmaText(operation,original,undefined,request.signal);
      if(!alive.current||request.signal.aborted)return;
      if(!result.text.trim()||result.text.length>100_000)throw new Error('MedGemma returned empty or oversized text. The report is unchanged.');
      setProposal({task:operation,field:target,original,text:result.text,context:snapshot,applied:false});
      if(latest.current!==snapshot)setError('The report changed while MedGemma was processing. This proposal cannot be applied; dismiss it and run again.');
    }catch(e){if(alive.current&&!request.signal.aborted){setError((e as Error).message);onActiveChange(false);}}
    finally{if(alive.current)setProcessing(false);}
  }
  function dismiss(){setProposal(null);setError('');setMessage('Proposal dismissed. Report text is unchanged.');onActiveChange(false);}
  const stale=proposal&&proposal.context!==context&&!proposal.applied;
  const diff=proposal?changedText(proposal.original,proposal.text):null;
  return <div data-dictation="off" onClick={()=>setOpen(true)}><DisclosureSection title="MedGemma assistance">
    <Card variant="compact" className="space-y-3 !p-3">
      <p className="text-xs text-muted-foreground">Uses the configured MedGemma service. AI output may contain errors or invented details. Verify every proposed change against the images and clinical record.</p>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Medical AI task<select aria-label="Medical AI task" className="input-premium block w-full" value={task} disabled={processing||Boolean(proposal)} onChange={e=>setTask(e.target.value as MedGemmaTask)}>{MEDGEMMA_TASKS.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>{task!=='review_radiology_report'&&<label className="text-sm">Report section<select aria-label="AI report section" className="input-premium block w-full" value={field} disabled={processing||Boolean(proposal)} onChange={e=>onFieldChange(e.target.value as Field)}>{(Object.keys(REPORT_FIELDS) as Field[]).map(key=><option key={key} value={key}>{REPORT_FIELDS[key]}</option>)}</select></label>}<Button disabled={!editable||processing||Boolean(proposal)||!input.trim()||input.length>32_000||health.data?.status!=='connected'} onClick={()=>void generate()}>{processing?'Processing MedGemma…':'Preview AI Output'}</Button><Button variant="secondary" disabled={processing} onClick={()=>void health.refetch()}>Check AI Service</Button></div>
      <p className="text-xs text-muted-foreground">{task==='review_radiology_report'?'Review reads all report sections and returns unverified suggestions. Suggestions cannot be inserted as findings.':'Only the selected section is sent. Accepted text stays unsaved until you explicitly Save.'} Maximum input: 32,000 characters.</p>
      {processing&&<p role="status">MedGemma is processing. You may continue editing; a changed report invalidates this proposal.</p>}
      {health.data?.status!=='connected'&&<p role="status" className="text-sm">MedGemma: {health.isFetching?'checking':health.data?.status||'unavailable'}. {health.data?.message}</p>}
      {health.error&&<ErrorState message={health.error.message}/>} {error&&<ErrorState message={error}/>}
      {proposal&&<section aria-label="AI proposal" className="space-y-3">
        <h3 className="text-sm font-semibold">{labels[proposal.task]} · {proposal.task==='review_radiology_report'?'All report sections':REPORT_FIELDS[proposal.field]}</h3>
        {proposal.task==='review_radiology_report'&&<p role="alert" className="text-sm">AI review suggestions are unverified and are not radiological findings.</p>}
        {stale&&<p role="alert" className="text-sm">The report has changed. Applying this proposal is blocked.</p>}
        <div className="grid gap-3 md:grid-cols-2"><label className="min-w-0 text-sm">Original text<Textarea aria-label="AI original text" rows={6} value={proposal.original} readOnly/></label><label className="min-w-0 text-sm">{proposal.task==='review_radiology_report'?'Unverified AI review suggestions':'Proposed text'}<Textarea aria-label="AI proposed text" rows={6} value={proposal.text} readOnly/></label></div>
        {proposal.task!=='review_radiology_report'&&diff&&<details><summary className="cursor-pointer text-sm">Show changed text</summary><p className="whitespace-pre-wrap break-words text-sm">{diff.prefix}{diff.removed&&<del className="bg-red-100 text-red-900">{diff.removed}</del>}{diff.added&&<ins className="bg-green-100 text-green-900">{diff.added}</ins>}{diff.suffix}</p></details>}
        <div className="flex flex-wrap gap-2">{proposal.task!=='review_radiology_report'&&!proposal.applied&&<Button disabled={!editable||Boolean(stale)} onClick={()=>{if(onApply(proposal.field,proposal.text,proposal.context)){setProposal({...proposal,applied:true});setMessage('AI change accepted locally. Review the section and Save explicitly.');onActiveChange(false);}else setError('The report changed. This proposal cannot be applied.');}}>Accept AI Change</Button>}{proposal.applied&&<Button variant="secondary" disabled={!editable||sections[proposal.field]!==proposal.text} onClick={()=>{if(onUndo(proposal.field,proposal.text,proposal.original)){setProposal(null);setMessage('Original text restored locally. Save explicitly when ready.');}else setError('The section changed. Use the preserved original text for manual recovery.');}}>Undo AI Change</Button>}<Button variant="secondary" onClick={proposal.applied?()=>{setProposal(null);setMessage('');}:dismiss}>{proposal.applied?'Dismiss Comparison':'Reject / Dismiss AI Output'}</Button></div>
      </section>}
      {message&&<p role="status" className="text-sm">{message}</p>}
    </Card>
  </DisclosureSection></div>;
}
