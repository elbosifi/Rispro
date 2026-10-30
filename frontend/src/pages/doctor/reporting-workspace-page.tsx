import {useState} from 'react';
import {Link,useLocation,useSearchParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Button,Input,Card,Table,TableHeader,TableBody,TableRow,TableHead,TableCell,LoadingState,ErrorState,EmptyState,Badge} from '@/components/shared';
import {api} from '@/lib/api-client';
import {workspaceBase,reportingReturn,loadReportingPreferences,saveReportingPreferences,type StudyListRow,type Freshness} from '@/lib/reporting-workspace-api';
import {useAuth} from '@/providers/auth-provider';
import {launchReportingBoardCaseInOhif} from '@/lib/api-hooks';

const statusLabels:Record<string,string>={no_report:'No RISpro Report',draft:'RISpro Draft',in_review:'In Review',final:'RISpro Final',additional_reports:'Additional Reports',external_draft:'External Draft',external_final:'External Final',unknown:'External Status Unknown'};

export function IndexFreshness({value}:{value:Freshness}) {return <p role="status" className="text-xs text-muted-foreground">Orthanc index: <strong>{value.status}</strong>{value.lastSuccessAt&&` · Updated ${new Date(value.lastSuccessAt).toLocaleString()}`}{value.error&&<span role="alert"> · {value.error}</span>}</p>;}
export function ReportingWorkspacePage() {
  const {user}=useAuth(),location=useLocation(),[params,setParams]=useSearchParams();
  const preferences=loadReportingPreferences(user?.id);
  const [search,setSearch]=useState(params.get('q')||'');
  const effective=new URLSearchParams(params);if(!effective.has('status'))effective.set('status',preferences.status);if(!effective.has('modality'))effective.set('modality',preferences.modality);
  const query=useQuery({queryKey:['reporting-catalogue',effective.toString()],queryFn:()=>api<{studies:StudyListRow[];total:number;limit:number;offset:number;freshness:Freshness;modalities:string[]}>(workspaceBase+'/studies?'+effective),retry:false});
  const change=(key:string,value:string)=>setParams(p=>{const n=new URLSearchParams(p);if(value||key==='modality')n.set(key,value);else n.delete(key);n.delete('offset');return n;});
  const back=encodeURIComponent(reportingReturn(location.pathname+'?'+effective.toString()));
  const result=query.data;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-semibold">Reporting</h1><p className="text-sm text-muted-foreground">Authorized imaging studies and RISpro reports</p></div><Button variant="secondary" onClick={()=>{saveReportingPreferences(user?.id,{...preferences,status:effective.get('status')||'all',modality:effective.get('modality')||''});}}>Remember filters</Button></div>
    <Card variant="compact"><form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={e=>{e.preventDefault();change('q',search);}}>
      <label className="text-sm">Search patient, ID, accession, examination or UID<Input value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className="text-sm">Reporting status<select className="input-premium w-full" value={effective.get('status')||'all'} onChange={e=>change('status',e.target.value)}>{[['all','All Studies'],...Object.entries(statusLabels),['my_reports','My Reports'],['my_drafts','My Drafts']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm">Modality<select className="input-premium w-full" value={effective.get('modality')||''} onChange={e=>change('modality',e.target.value)}><option value="">All authorized modalities</option>{(result?.modalities||['CT','MR']).map(m=><option key={m}>{m}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-2"><label className="text-sm">From<Input type="date" value={params.get('from')||''} onChange={e=>change('from',e.target.value)}/></label><label className="text-sm">To<Input type="date" value={params.get('to')||''} onChange={e=>change('to',e.target.value)}/></label></div>
      <label className="text-sm">Sort<select className="input-premium w-full" value={params.get('sort')||'date'} onChange={e=>change('sort',e.target.value)}>{['date','patient','accession','modality'].map(s=><option key={s}>{s}</option>)}</select></label><label className="text-sm">Direction<select className="input-premium w-full" value={params.get('direction')||'desc'} onChange={e=>change('direction',e.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label><div className="self-end"><Button type="submit">Search</Button></div>
    </form></Card>
    {query.isLoading&&<LoadingState message="Loading studies…"/>}{query.error&&<ErrorState message={query.error.message}/>}
    {result&&<><IndexFreshness value={result.freshness}/><div className="overflow-x-auto"><Table className="[--table-cell-padding-y:0.25rem]" style={{fontSize:'0.75rem',lineHeight:'1rem'}}>
      <TableHeader><TableRow>{['Patient / ID','Accession / Examination','Modality / Study Date','Series','Reporting','Authors / Signers','Assigned Doctor',''].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{result.studies.map(s=><TableRow key={s.orthanc_study_id}>
        <TableCell className="whitespace-nowrap"><span dir="auto">{s.patient_name_raw}</span><br/><span className="text-muted-foreground">{s.patient_id}</span></TableCell>
        <TableCell>{s.accession_number||'No accession'}<br/>{s.study_description}</TableCell>
        <TableCell>{s.modalities_in_study.join(' / ')}<br/>{s.study_date}</TableCell><TableCell>{s.series_count}</TableCell>
        <TableCell><div className="flex items-center gap-2 whitespace-nowrap"><Badge size="sm" style={{padding:'0 0.375rem',lineHeight:'1rem'}} variant={s.reporting_status==='final'?'success':'neutral'}>{statusLabels[s.reporting_status]||s.reporting_status}</Badge><span className="text-muted-foreground" aria-label={`${s.report_count} RISpro reports`}>{s.report_count} reports</span></div>
          {s.external_reporting_status!=='no_report'&&<Badge size="sm" className="whitespace-nowrap" style={{padding:'0 0.375rem',lineHeight:'1rem'}} variant={s.external_reporting_status==='external_final'?'success':s.external_reporting_status==='unknown'?'warning':'neutral'}>{statusLabels[s.external_reporting_status]||'External Status Unknown'}</Badge>}
        </TableCell>
        <TableCell>{s.reports.map(r=><div key={r.id}>{r.author}{r.signer&&` · Signed: ${r.signer}`}</div>)}</TableCell><TableCell>{s.assigned_doctor||'Unassigned'}</TableCell>
        <TableCell><Link className="text-accent underline whitespace-nowrap" to={`/doctor/reporting/studies/${encodeURIComponent(s.orthanc_study_id)}?returnTo=${back}`}>Open Reports</Link></TableCell>
      </TableRow>)}</TableBody>
    </Table></div>{!result.studies.length&&<EmptyState message="No studies match these filters."/>}<Pagination offset={result.offset} limit={result.limit} total={result.total} onChange={n=>setParams(p=>{const next=new URLSearchParams(p);next.set('offset',String(n));return next;})}/></>}
  </div>;
}
export function Pagination({offset,limit,total,onChange}:{offset:number;limit:number;total:number;onChange:(n:number)=>void}) {return <nav aria-label="Worklist pages" className="flex flex-wrap items-center gap-3 text-sm"><Button variant="secondary" disabled={offset===0} onClick={()=>onChange(Math.max(0,offset-limit))}>Previous</Button><span>{total?offset+1:0}–{Math.min(offset+limit,total)} of {total}</span><Button variant="secondary" disabled={offset+limit>=total} onClick={()=>onChange(offset+limit)}>Next</Button></nav>;}
export interface AssignedCase {appointmentId:number;patientName:string;patientId:string;accession:string;examination:string;modality:string;studyDate:string;assignedAt:string;priority:string;status:string;studyKey:string|null;reportId:number|null}
export function AssignedWorklistPage() {
  const [params,setParams]=useSearchParams(),location=useLocation(),[error,setError]=useState('');
  const query=useQuery({queryKey:['assigned-reporting-work',params.toString()],queryFn:()=>api<{cases:AssignedCase[];total:number;limit:number;offset:number}>(workspaceBase+'/my-work?'+params),retry:false});
  const data=query.data,back=encodeURIComponent(location.pathname+location.search);
  async function images(id:number){try{const r=await launchReportingBoardCaseInOhif(id);if(r.status==='ready')window.open(r.launchUrl,'_blank','noopener');else setError(r.message||'Images are not available.');}catch(e){setError((e as Error).message);}}
  return <div className="space-y-4"><h1 className="text-xl font-semibold">My Worklist</h1><div className="flex flex-wrap gap-2">{[['pending','Pending'],['draft','Draft'],['in_review','In Review'],['final','Finalized'],['all','All Assigned']].map(([v,l])=><Button key={v} variant={(params.get('status')||'pending')===v?'primary':'secondary'} onClick={()=>setParams({status:v})}>{l}</Button>)}</div>
    {(query.error||error)&&<ErrorState message={query.error?.message||error}/>} {query.isLoading&&<LoadingState message="Loading assigned examinations…"/>}
    {data&&<><div className="overflow-x-auto"><Table><TableHeader><TableRow>{['Patient / ID','Accession / Examination','Modality / Study Date','Status','Assigned / Priority','Actions'].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{data.cases.map(c=><TableRow key={c.appointmentId}><TableCell>{c.patientName}<br/>{c.patientId}</TableCell><TableCell>{c.accession}<br/>{c.examination}</TableCell><TableCell>{c.modality}<br/>{c.studyDate}</TableCell><TableCell>{c.status.replaceAll('_',' ')}</TableCell><TableCell>{new Date(c.assignedAt).toLocaleDateString()}<br/>{c.priority}</TableCell><TableCell><div className="flex flex-wrap gap-2">{c.studyKey?<><Link className="text-accent underline" to={`/doctor/reporting/studies/${encodeURIComponent(c.studyKey)}?returnTo=${back}`}>Open Report</Link><Link className="text-accent underline" to={`/doctor/reporting/studies/${encodeURIComponent(c.studyKey)}?returnTo=${back}`}>View Existing Reports</Link></>:<span className="text-xs">Study identity requires reconciliation</span>}<Button variant="secondary" size="sm" onClick={()=>void images(c.appointmentId)}>View Images</Button></div></TableCell></TableRow>)}</TableBody></Table></div>{!data.cases.length&&<EmptyState message="No assigned cases in this view."/>}<Pagination {...data} onChange={offset=>setParams(p=>{const n=new URLSearchParams(p);n.set('offset',String(offset));return n;})}/></>}
  </div>;
}
