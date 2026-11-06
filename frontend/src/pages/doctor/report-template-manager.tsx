import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button,Card,Input,Textarea,ErrorState,LoadingState,DisclosureSection} from '@/components/shared';
import {useAuth} from '@/providers/auth-provider';
import {REPORT_FIELDS,emptyReportSections,reportingTemplateQueryKey,listReportingTemplates,getReportingTemplate,createReportingTemplate,updateReportingTemplate,deleteReportingTemplate,type ReportSections,type ReportingTemplateInput} from '@/lib/reporting-workspace-api';

export function ReportTemplateManager({sourceSections,onSaved,onPendingChange}:{sourceSections?:ReportSections;onSaved?:(id:number)=>void;onPendingChange?:(pending:boolean)=>void}) {
  const {user}=useAuth(),client=useQueryClient(),[enabled,setEnabled]=useState(false);
  const query=useQuery({queryKey:reportingTemplateQueryKey(user?.id),queryFn:listReportingTemplates,enabled});
  const [form,setForm]=useState<ReportingTemplateInput>({name:'',sections:emptyReportSections()}),[activeId,setActiveId]=useState<number|null>(null),[selected,setSelected]=useState('');
  const [dirty,setDirty]=useState(false),[confirmed,setConfirmed]=useState(false),[deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{onPendingChange?.(dirty||busy);return()=>onPendingChange?.(false);},[dirty,busy,onPendingChange]);
  const reset=()=>{setForm({name:'',sections:emptyReportSections()});setActiveId(null);setDirty(false);setConfirmed(false);setDeleting(false);setError('');setMessage('');};
  function change(next:ReportingTemplateInput){setForm(next);setDirty(true);setConfirmed(false);setMessage('');}
  async function load(){setBusy(true);setError('');try{const t=await getReportingTemplate(Number(selected));if(alive.current){setActiveId(t.id);setForm({name:t.name,sections:{...t.sections}});setDirty(false);setConfirmed(false);setDeleting(false);setMessage('');}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  async function persist(remove=false){
    setBusy(true);setError('');
    try {
      if(remove){await deleteReportingTemplate(activeId!);if(alive.current){reset();setSelected('');setMessage('Personal template deleted. Existing reports are unchanged.');}}
      else {const t=await(activeId?updateReportingTemplate(activeId,form):createReportingTemplate(form));if(alive.current){setActiveId(t.id);setSelected(String(t.id));setForm({name:t.name,sections:{...t.sections}});setDirty(false);setConfirmed(false);setMessage('Personal template saved. Existing reports are unchanged.');onSaved?.(t.id);}}
      await client.invalidateQueries({queryKey:reportingTemplateQueryKey(user?.id)});
    }catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
  }
  const length=Object.values(form.sections).reduce((sum,value)=>sum+value.length,0),valid=form.name.trim().length>0&&form.name.trim().length<=100&&Object.values(form.sections).some(value=>value.trim())&&length<=50_000&&Object.values(form.sections).every(value=>value.length<=20_000);
  return <div data-dictation="off" onClick={()=>setEnabled(true)}><DisclosureSection title="Personal reporting templates">
    <Card variant="compact" className="space-y-3 !p-3">
      <p className="text-sm text-muted-foreground">Templates store reusable section text. Patient identity, images and report history are excluded. Template changes never replace an open report.</p>
      {query.isFetching&&<LoadingState message="Loading personal templates…"/>}{query.error&&<ErrorState message={query.error.message} onRetry={()=>void query.refetch()}/>}
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">Owned template<select aria-label="Owned template" className="input-premium block w-full" value={selected} disabled={busy||dirty} onChange={e=>setSelected(e.target.value)}><option value="">Select a personal template</option>{query.data?.templates?.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><Button variant="secondary" disabled={!selected||busy||dirty} onClick={()=>void load()}>Edit / Rename</Button><Button variant="secondary" disabled={busy||dirty} onClick={reset}>New Personal Template</Button>{sourceSections&&<Button variant="secondary" disabled={busy||dirty} onClick={()=>{reset();change({name:'',sections:{...sourceSections}});}}>Copy Current Report Sections</Button>}</div>
      {dirty&&<p className="text-sm">Save or discard template edits before opening another template.</p>}
      <label className="block text-sm">Template name<Input aria-label="Template name" maxLength={100} value={form.name} disabled={busy} onChange={e=>change({...form,name:e.target.value})}/></label>
      <div className="grid gap-3 md:grid-cols-2">{(Object.keys(REPORT_FIELDS) as (keyof ReportSections)[]).map(key=><label className="min-w-0 text-sm" key={key}>Template {REPORT_FIELDS[key]}<Textarea aria-label={'Template '+REPORT_FIELDS[key]} rows={3} maxLength={20_000} value={form.sections[key]} disabled={busy} onChange={e=>change({...form,sections:{...form.sections,[key]:e.target.value}})}/></label>)}</div>
      <p className="text-xs text-muted-foreground">{length.toLocaleString()} / 50,000 characters; up to 20,000 per section.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>I reviewed every section and removed patient names, identifiers and all case-specific information before saving this reusable template.</span></label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy||!confirmed||!valid||!dirty} onClick={()=>void persist()}>Save Personal Template</Button><Button variant="secondary" disabled={busy} onClick={reset}>Discard Template Edits</Button>{activeId&&!deleting&&<Button variant="secondary" disabled={busy||dirty} onClick={()=>setDeleting(true)}>Delete Personal Template</Button>}{deleting&&<><span className="text-sm">Delete this template permanently?</span><Button disabled={busy} onClick={()=>void persist(true)}>Confirm Template Deletion</Button><Button variant="secondary" disabled={busy} onClick={()=>setDeleting(false)}>Cancel Deletion</Button></>}</div>
      {error&&<ErrorState message={error}/>} {message&&<p role="status" className="text-sm">{message}</p>}
    </Card>
  </DisclosureSection></div>;
}
