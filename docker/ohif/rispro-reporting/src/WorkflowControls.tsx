import React,{useState} from 'react';
import {Button,Input} from '@ohif/ui-next';
import {reportFields,aiTasks,changedText,reviewState} from './report-workflow';

const attempt=(store,work)=>Promise.resolve().then(work).catch(store.setError);
export function CreateReportControls({store,s}) {
  const [mode,setMode]=useState('independent'),[type,setType]=useState('primary');
  const policy=s.context.policy,types=(policy?.allowedTypes||['primary']).filter(t=>!s.context.primaryReportId||policy.additional!=='typed'||t!=='primary');
  const selectedType=types.includes(type)?type:types[0]||'',personal=s.templates?.templates||[];
  const available=['blank','structured'].includes(s.templateSelection)||personal.some(t=>'personal:'+t.id===s.templateSelection);
  return <details className="rispro-workflow" open={!s.report} onToggle={e=>{if(e.currentTarget.open&&!s.templates)attempt(store,store.loadTemplates);}}><summary>{s.report?'Create another report':'Create report'}</summary>
    <p>Template selection applies only to a new report. Existing drafts are preserved.</p>
    <label>New-report template<select aria-label="New-report template" value={s.templateSelection} onChange={e=>store.setTemplateSelection(e.target.value)}><option value="blank">Blank narrative</option><option value="structured">Structured narrative</option>{personal.map(t=><option key={t.id} value={'personal:'+t.id}>{t.name} (personal)</option>)}{!available&&<option value={s.templateSelection}>Template unavailable — choose another</option>}</select></label>
    {s.context.v2&&<><label>Mode<select aria-label="New-report mode" value={policy.collaboration==='both'?mode:policy.collaboration} disabled={policy.collaboration!=='both'} onChange={e=>setMode(e.target.value)}>{policy.collaboration!=='shared'&&<option value="independent">Independent</option>}{policy.collaboration!=='independent'&&<option value="shared">Shared draft</option>}</select></label><label>Report type<select aria-label="New-report type" value={selectedType} onChange={e=>setType(e.target.value)}>{types.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label></>}
    {s.templateError&&<p role="alert">{s.templateError}</p>}
    <Button disabled={!(s.context.canCreate??s.context.canEdit)||s.busy||s.conflict||!available||!selectedType||s.templateDraft?.dirty||s.templateBusy||s.ai?.busy||s.ai?.proposal&&!s.ai.proposal.applied||s.aiSaveRequired&&s.dirty||Boolean(s.pendingCapture)||Boolean(s.addendumText)} onClick={()=>attempt(store,()=>store.create({mode:policy?.collaboration==='both'?mode:policy?.collaboration||mode,reportType:selectedType}))}>Create RISpro Report</Button>
  </details>;
}

export function TemplateControls({store,s}) {
  const [selected,setSelected]=useState(''),[deleting,setDeleting]=useState(false),draft=s.templateDraft;
  return <details className="rispro-workflow" data-dictation="off" onToggle={e=>{if(e.currentTarget.open&&!s.templates)attempt(store,store.loadTemplates);}}><summary>Personal reporting templates{draft.dirty?' · unsaved edits':''}</summary>
    <p>Only reusable section text is stored. Patient identity, images and history are excluded. Template changes never replace an open report.</p>
    <label>Owned template<select aria-label="Owned template" value={selected} disabled={s.templateBusy||draft.dirty} onChange={e=>{setSelected(e.target.value);setDeleting(false);}}><option value="">Choose a personal template</option>{s.templates?.templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <div className="rispro-report-actions"><Button variant="outline" disabled={!selected||s.templateBusy||draft.dirty} onClick={()=>attempt(store,()=>store.openTemplate(Number(selected)))}>Edit / Rename</Button><Button variant="outline" disabled={s.templateBusy||draft.dirty} onClick={()=>{store.resetTemplate();setDeleting(false);}}>New Template</Button>{s.report&&<Button variant="outline" disabled={s.templateBusy||draft.dirty} onClick={()=>attempt(store,store.copyReportTemplate)}>Copy Report Sections</Button>}</div>
    <label>Template name<Input aria-label="Template name" maxLength={100} value={draft.name} disabled={s.templateBusy} onChange={e=>store.editTemplate('name',e.target.value)}/></label>
    <details><summary>Reusable template sections</summary>{Object.entries(reportFields).map(([field,label])=><label key={field}>Template {label}<textarea aria-label={'Template '+label} value={draft.sections[field]} rows={3} maxLength={20000} disabled={s.templateBusy} onChange={e=>store.editTemplate(field,e.target.value)}/></label>)}</details>
    <label className="rispro-check"><input type="checkbox" checked={draft.confirmed} disabled={s.templateBusy} onChange={e=>store.confirmTemplate(e.target.checked)}/>I reviewed every section and removed patient-identifying and all case-specific text before saving this reusable template.</label>
    <div className="rispro-report-actions"><Button disabled={!draft.dirty||!draft.confirmed||s.templateBusy} onClick={()=>attempt(store,store.saveTemplate)}>Save Template</Button><Button variant="outline" disabled={s.templateBusy} onClick={()=>{store.resetTemplate();setDeleting(false);}}>Discard Template Edits</Button>{draft.id&&!deleting&&<Button variant="outline" disabled={s.templateBusy||draft.dirty} onClick={()=>setDeleting(true)}>Delete Template</Button>}{deleting&&<><span>Delete this template permanently?</span><Button disabled={s.templateBusy} onClick={()=>attempt(store,async()=>{await store.deleteTemplate(true);setDeleting(false);setSelected('');})}>Confirm Template Deletion</Button><Button variant="outline" disabled={s.templateBusy} onClick={()=>setDeleting(false)}>Cancel Deletion</Button></>}</div>
    {(draft.error||s.templateError)&&<p role="alert">{draft.error||s.templateError}</p>}{s.templateMessage&&<p role="status">{s.templateMessage}</p>}
  </details>;
}

export function ReviewControls({store,s}) {
  const report=s.report,state=reviewState(report,s.reviewEvents),feedback=[...(s.reviewEvents||[])].reverse().find(event=>event.comment);
  const designated=(report.reviewEligibility||s.context.policy?.reviewEligibility)==='designated',invalidReviewer=Boolean(s.preferredReviewer&&!s.reviewers.some(r=>Number(r.id)===Number(s.preferredReviewer)))||designated&&!s.preferredReviewer;
  const locked=s.busy||s.conflict||s.dictationBusy||Boolean(report.blockedReason)||s.ai.busy||s.ai.proposal&&!s.ai.proposal.applied||s.aiSaveRequired&&s.dirty||s.templateDraft.dirty||s.templateBusy;
  return <details className="rispro-workflow" data-dictation="off" onToggle={e=>{if(e.currentTarget.open)attempt(store,store.loadReview);}}><summary>Senior review · {state}</summary>
    <p role="status">{state}</p>{s.reviewLoading&&<p role="status">Loading review history and eligible reviewers…</p>}{feedback&&<article><strong>{feedback.actor_name} · {feedback.event_type}</strong><p className="rispro-report-text">{feedback.comment}</p></article>}
    {report.status!=='final'&&report.reviewEnabled&&<><label>Review comment<textarea aria-label="Review comment" maxLength={10000} rows={3} value={s.reviewComment} readOnly={locked} onChange={e=>store.editReview('reviewComment',e.target.value)}/></label>
      {report.status==='draft'&&<><label>Preferred senior reviewer<select aria-label="Preferred senior reviewer" value={s.preferredReviewer} disabled={locked||s.reviewLoading} onChange={e=>store.editReview('preferredReviewer',e.target.value)}><option value="">{designated?'Choose a senior reviewer':'Eligible senior review queue'}</option>{s.reviewers.map(reviewer=><option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>)}</select></label>{designated&&invalidReviewer&&<p role="status">Choose an eligible senior reviewer before submitting.</p>}{!s.reviewLoading&&!s.reviewers.length&&<p>No eligible senior reviewers are currently available for this study.</p>}<Button disabled={locked||!report.canEdit||s.reviewLoading||!s.reviewers.length||invalidReviewer} onClick={()=>attempt(store,()=>store.review('submit'))}>Submit for Review</Button></>}
      {report.status==='in_review'&&<><p>{report.canReview?'Review permission and signing permission are separate.':'Awaiting an eligible senior reviewer; review actions are unavailable under current policy.'}</p><div className="rispro-report-actions">{report.canReview&&<><Button disabled={locked||!s.reviewComment.trim()} onClick={()=>attempt(store,()=>store.review('feedback'))}>Add Feedback</Button><Button variant="outline" disabled={locked} onClick={()=>attempt(store,()=>store.review('return'))}>Return for Revision</Button></>}{Number(report.reviewRequestedBy)===Number(s.context.signerUserId)&&<Button variant="outline" disabled={locked} onClick={()=>attempt(store,()=>store.review('withdraw'))}>Withdraw Review</Button>}</div></>}
    </>}
    <details><summary>Review history</summary><ol>{s.reviewEvents.map(event=><li key={event.id}><strong>{event.event_type} · {event.actor_name}</strong><p>{new Date(event.created_at).toLocaleString()}</p><p className="rispro-report-text">{event.comment}</p></li>)}</ol></details>
  </details>;
}

export function AiControls({store,s,editable}) {
  const ai=s.ai,p=ai.proposal,diff=p?changedText(p.original,p.text):null,stale=store.aiProposalStale();
  return <details className="rispro-workflow" data-dictation="off" onToggle={e=>{if(e.currentTarget.open&&!ai.health)attempt(store,store.loadAiHealth);}}><summary>MedGemma assistance{ai.busy?' · processing':p?' · proposal available':''}</summary>
    <p>AI output is unverified and may invent details. Check every proposed change against the images and clinical record. Accepted changes require an explicit Save.</p>
    <label>Medical AI task<select aria-label="Medical AI task" value={ai.task} disabled={ai.busy||Boolean(p)} onChange={e=>store.setAiOption('task',e.target.value)}>{Object.entries(aiTasks).map(([task,label])=><option key={task} value={task}>{label}</option>)}</select></label>
    {ai.task!=='review_radiology_report'&&<label>AI report section<select aria-label="AI report section" value={ai.field} disabled={ai.busy||Boolean(p)} onChange={e=>store.setAiOption('field',e.target.value)}>{Object.entries(reportFields).map(([field,label])=><option key={field} value={field}>{label}</option>)}</select></label>}
    <p>{ai.task==='review_radiology_report'?'All report sections are sent for review; suggestions cannot be inserted as findings.':'Only the selected section is sent.'} Maximum input: 32,000 characters.</p>
    <div className="rispro-report-actions"><Button disabled={!editable||ai.busy||Boolean(p)||ai.health?.status!=='connected'} onClick={()=>attempt(store,store.generateAi)}>Preview AI Output</Button><Button variant="outline" disabled={ai.busy} onClick={()=>attempt(store,store.loadAiHealth)}>Check AI Service</Button>{ai.busy&&<Button variant="outline" onClick={store.dismissAi}>Cancel AI Request</Button>}</div>
    {ai.busy&&<p role="status">Processing. Editing the report invalidates this proposal.</p>}{ai.health&&ai.health.status!=='connected'&&<p role="status">MedGemma: {ai.health.status}. {ai.health.message}</p>}{ai.error&&<p role="alert">{ai.error}</p>}
    {p&&<><strong>{aiTasks[p.task]} · {p.task==='review_radiology_report'?'All report sections':reportFields[p.field]}</strong>{p.task==='review_radiology_report'&&<p role="alert">AI review suggestions are unverified and are not radiological findings.</p>}{stale&&<p role="alert">The report changed. Applying this proposal is blocked.</p>}
      <label>Original text<textarea aria-label="AI original text" rows={5} readOnly value={p.original}/></label><label>{p.task==='review_radiology_report'?'Unverified AI review suggestions':'Proposed text'}<textarea aria-label="AI proposed text" rows={5} readOnly value={p.text}/></label>
      {p.task!=='review_radiology_report'&&<details><summary>Show changed text</summary><p className="rispro-report-text">{diff.prefix}{diff.removed&&<del>{diff.removed}</del>}{diff.added&&<ins>{diff.added}</ins>}{diff.suffix}</p></details>}
      <div className="rispro-report-actions">{!p.applied&&p.task!=='review_radiology_report'&&<Button disabled={!editable||stale} onClick={()=>attempt(store,store.acceptAi)}>Accept AI Change</Button>}{p.applied&&<Button variant="outline" disabled={!editable||s.text[p.field]!==p.text} onClick={()=>attempt(store,store.undoAi)}>Undo AI Change</Button>}<Button variant="outline" onClick={store.dismissAi}>{p.applied?'Dismiss Comparison':'Reject / Dismiss AI Output'}</Button></div>
    </>}
  </details>;
}
