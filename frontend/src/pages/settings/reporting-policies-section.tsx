import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Button,Card,LoadingState,ErrorState} from '@/components/shared';
import {api,ApiError} from '@/lib/api-client';
import {workspaceBase,reportTypes,type ReportingPolicy} from '@/lib/reporting-workspace-api';
import {ReAuthPrompt} from './settings-section-helpers';
const choices={
  creation:[['accessible','Any authorized accessible study'],['assigned','Assigned cases only'],['assigned_permission','Assigned cases plus explicit supervisor permission']],
  collaboration:[['both','Shared and independent reports'],['independent','Independent reports only'],['shared','Shared drafts only']],
  review:[['optional','Optional review'],['none','No formal review'],['mandatory','Mandatory for configured roles']],
  reviewEligibility:[['open','Open review; preferred reviewer optional'],['authorized','Any qualified reporting doctor'],['designated','Designated reviewer or supervisor']],
  signing:[['permission','Existing signing permission required'],['qualified','All qualified reporting doctors'],['review','Signing permission and independent review required']],
  additional:[['typed','Typed additional reports after primary final'],['unrestricted','Independent reports with configured types'],['addenda','Corrections and addenda only after primary final']],
  deletion:[['creator','Creator for single-author drafts; supervisor for shared drafts'],['supervisor','Supervisor-controlled deletion'],['disabled','Routine deletion disabled']],
} as const;
const labels={creation:'Report creation',collaboration:'Collaboration',review:'Review',reviewEligibility:'Review eligibility',signing:'Signing',additional:'Additional reports',deletion:'Draft deletion'};
export default function ReportingPoliciesSection({onReAuthRequired}:{onReAuthRequired:(key:string[])=>void}) {
  const qc=useQueryClient(),[draft,setDraft]=useState<ReportingPolicy|null>(null);
  const query=useQuery({queryKey:['settings','doctor_workspace'],queryFn:()=>api<{policy:ReportingPolicy;presets:Record<string,ReportingPolicy>}>(workspaceBase+'/policies')});
  const p=draft||query.data?.policy;
  const save=useMutation({mutationFn:()=>api<{policy:ReportingPolicy}>(workspaceBase+'/policies',{method:'PUT',body:JSON.stringify(p)}),onSuccess:async result=>{setDraft(null);qc.setQueryData(['settings','doctor_workspace'],{...query.data,policy:result.policy});await qc.invalidateQueries({queryKey:['doctor-workspace-v2']});}});
  if(query.isLoading)return <LoadingState message="Loading reporting policies…"/>;
  const error=query.error||save.error;
  if(error instanceof ApiError&&error.status===403)return <ReAuthPrompt onReAuthRequired={()=>{save.reset();onReAuthRequired(['settings','doctor_workspace']);}}/>;
  if(!p)return <ErrorState message={query.error?.message||'Reporting policy unavailable.'}/>;
  return <div className="max-w-4xl space-y-4"><h2 className="text-lg font-semibold">Reporting Policies</h2><p className="text-sm text-muted-foreground">Policy version {p.version}. Changes apply to subsequent actions. Existing signed reports remain immutable.</p>
    <Card variant="compact"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.enabled} onChange={e=>setDraft({...p,enabled:e.target.checked})}/>Enable Doctor Workspace V2</label><p className="mt-2 text-xs text-muted-foreground">Disabled by default. Disabling restores the legacy workspace and retains every report, signature and revision. Saved report links remain readable.</p></Card>
    <label className="block text-sm">Policy preset<select className="input-premium mt-1 block w-full" defaultValue="" onChange={e=>{const preset=query.data?.presets[e.target.value];if(preset)setDraft({...preset,version:p.version,enabled:p.enabled});}}><option value="">Choose a preset…</option><option value="open">Open Collaborative Reporting (NCCB)</option><option value="teaching">Teaching Hospital</option><option value="assigned">Assignment-Controlled Reporting</option></select></label>
    <div className="grid gap-3 md:grid-cols-2">{(Object.keys(choices) as (keyof typeof choices)[]).map(key=><label className="block text-sm" key={key}>{labels[key]}<select className="input-premium mt-1 block w-full" value={p[key]} onChange={e=>setDraft({...p,[key]:e.target.value})}>{choices[key].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}</div>
    <fieldset className="space-y-2"><legend className="text-sm font-semibold">Allowed report types</legend>{Object.entries(reportTypes).map(([type,label])=><label key={type} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={p.allowedTypes.includes(type)} onChange={e=>setDraft({...p,allowedTypes:e.target.checked?[...p.allowedTypes,type]:p.allowedTypes.filter(t=>t!==type)})}/>{label}</label>)}</fieldset>
    <fieldset><legend className="text-sm font-semibold">Mandatory review roles</legend>{['consultant','specialist','resident','senior_house_officer'].map(role=><label className="mr-4 inline-flex items-center gap-2 text-sm" key={role}><input type="checkbox" checked={p.mandatoryReviewRoles.includes(role)} onChange={e=>setDraft({...p,mandatoryReviewRoles:e.target.checked?[...p.mandatoryReviewRoles,role]:p.mandatoryReviewRoles.filter(r=>r!==role)})}/>{role.replaceAll('_',' ')}</label>)}</fieldset>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.restoreRevisions} onChange={e=>setDraft({...p,restoreRevisions:e.target.checked})}/>Allow authorized active-draft revision restoration</label>
    <p className="text-xs text-muted-foreground">Authentication, identity checks, external ownership protection, immutable signatures, audit history, concurrency checks and explicit finalization always apply.</p>{error&&<ErrorState message={error.message}/>} {save.isSuccess&&<p role="status" className="text-sm">Reporting policies saved.</p>}<Button disabled={save.isPending||!p.allowedTypes.length} onClick={()=>save.mutate()}>Save Reporting Policies</Button>
  </div>;
}
