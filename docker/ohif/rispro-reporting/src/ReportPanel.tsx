import React, { useState, useSyncExternalStore } from 'react';
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@ohif/ui-next';
import './reporting.css';
import DictationAdapter from './dictation-adapter';
import {ageAtExamination,finalizeDisabledReasons} from './report-presentation';

const labels={clinicalHistory:'Clinical history',comparison:'Comparison',technique:'Technique',findings:'Findings',impression:'Impression'};
export default function ReportPanel({store}) {
  const s=useSyncExternalStore(store.subscribe,store.getSnapshot);
  const [confirm,setConfirm]=useState(null),[tab,setTab]=useState('report');
  const [mode,setMode]=useState('independent'),[reportType,setReportType]=useState('primary');
  const addendum=s.addendumText;
  const unsaved=s.dirty || Object.keys(s.captionEdits).length>0 || !!s.pendingCapture || !!addendum;
  const saveStatus=s.connection==='authentication-required'?'Authentication required':s.connection==='reconnecting'?'Reconnecting':s.connection==='denied'?'Save failed':s.saving?'Saving…':s.error && unsaved?'Save failed':unsaved?'Unsaved changes':'Saved';
  const run=work=>Promise.resolve().then(work).catch(store.setError);
  const report=s.report,identity=s.context?.identity?{...report?.identity,...s.context.identity}:report?.identity;
  const editable=(report?.canEdit??s.context?.canEdit) && ['draft','in_review'].includes(report?.status) && !s.busy && !s.conflict && !report?.deletedAt;
  const finalizeReasons=finalizeDisabledReasons(s),age=ageAtExamination(identity?.birthDate,identity?.studyDate);
  const dictationContext=JSON.stringify([s.context?.contextId,s.context?.primaryStudyUid,identity?.patientIdentifier,identity?.accession,report?.id,report?.status]);
  const selection=report?.keyImages || [];
  const confirmAction=()=>run(async()=>{
    if(confirm==='finalize') await store.finalize();
    else await store.addendum(addendum);
    setConfirm(null);
  });
  return <section className="rispro-report" data-dictation-context={dictationContext} aria-label="RISpro report" onKeyDown={e=>e.stopPropagation()} onKeyUp={e=>e.stopPropagation()}>
    {s.context?.v2&&<><label>Report<select aria-label="Report selection" value={report?.id||''} disabled={s.busy||s.conflict} onChange={e=>{const selectedId=Number(e.target.value);run(()=>store.selectReport(selectedId));}}><option value="" disabled>Select report</option>{s.context.reports?.map(r=><option key={r.id} value={r.id}>{r.author} · {r.reportType} · {r.status} · #{r.id}</option>)}</select></label><a href={'/doctor/reporting/studies/'+s.context.studyKey} target="_blank" rel="noopener noreferrer">All reports / Create independent report</a></>}
    <header className="rispro-report-identity">
      <strong dir="auto">{identity?.patientName||'Patient name unavailable'}</strong>
      <div className="rispro-report-demographics"><span>ID: {identity?.patientIdentifier||'Unavailable'}</span><span>Age at exam: {age===null?'Unavailable':`${age} y`}</span><span>Sex: {identity?.sex||'Unavailable'}</span></div>
      <div className="rispro-report-examination" dir="auto">{identity?.examination||'Examination description unavailable'}</div>
      <div className="rispro-report-demographics"><span>Study: {identity?.studyDate||'Unavailable'}</span><span>Accession: {identity?.accession||'Unavailable'}</span></div>
      <strong>{report?.status==='final'?'Final — signed':report?.status==='in_review'?'In review':report?'Draft':'No native report'}</strong>
      {report && <div>Author: {report.author}{report.finalizer && <><br/>Signed: {report.finalizer} · {new Date(report.finalizedAt).toLocaleString()}</>}</div>}
    </header>
    {s.error && <div role="alert">{s.error}</div>}
    {s.context?.blockedReason && <div role="alert">{s.context.blockedReason}</div>}
    {!s.context && <p>Loading authorized report context…</p>}
    {s.context && !report && <>
      <p>Creating a RISpro report explicitly selects native reporting for this case. Existing external drafts/final reports and manual final overrides cannot be taken over.</p>
      {s.context.v2&&<><label>Mode<select value={s.context.policy.collaboration==='both'?mode:s.context.policy.collaboration} onChange={e=>setMode(e.target.value)} disabled={s.context.policy.collaboration!=='both'}><option value="independent">Independent</option><option value="shared">Shared draft</option></select></label><label>Report type<select value={reportType} onChange={e=>setReportType(e.target.value)}>{s.context.policy.allowedTypes.map(t=><option key={t}>{t}</option>)}</select></label></>}
      <Button disabled={!s.context.canEdit || s.busy} onClick={()=>run(()=>store.create({mode:s.context?.policy?.collaboration==='both'?mode:s.context?.policy?.collaboration||mode,reportType}))}>Create RISpro Report</Button>
    </>}
    {report && <>
      <DictationAdapter report={report} contextKey={dictationContext} enabled={editable} onError={store.setError}/>
      <nav className="rispro-report-actions">
        <Button variant="outline" onClick={()=>setTab('report')}>Report</Button>
        <Button variant="outline" onClick={()=>setTab('images')}>Key Images ({selection.length})</Button>
        <Button variant="outline" onClick={()=>run(async()=>{await store.history();setTab('history');})}>History</Button>
        <Button variant="outline" onClick={()=>window.open(store.printUrl(),'_blank','noopener')}>Print</Button>
      </nav>
      {['draft','in_review'].includes(report.status) && <div className="rispro-report-actions">
        <Button disabled={!editable || s.saving} onClick={()=>run(store.save)}>Save</Button>
        <Button disabled={finalizeReasons.length>0} aria-describedby={finalizeReasons.length?'rispro-finalize-reason':undefined} onClick={()=>setConfirm('finalize')}>Finalize</Button>
        <span role="status">{saveStatus}</span>
      </div>}
      {['draft','in_review'].includes(report.status)&&finalizeReasons.length>0&&<p id="rispro-finalize-reason" className="rispro-report-reason" role="status">{finalizeReasons.join(' ')}</p>}
      {s.conflict && <Button variant="outline" onClick={()=>{
        if(window.confirm('Discard the text currently retained in this tab and load the server report? Copy any unsaved text you need before continuing.')) run(store.load);
      }}>Reload saved report</Button>}
      {tab==='report' && <>
        {Object.entries(labels).map(([key,label])=><label key={key} className={key==='findings'||key==='impression'?'rispro-report-major':''}>
          <span>{label}{!['findings','impression'].includes(key)?' (optional)':''}</span>
          <textarea aria-label={label} data-report-field={key} dir="auto" value={s.text?.[key] || ''} readOnly={!editable}
            rows={key==='findings'?7:key==='impression'?4:2} onChange={e=>store.edit(key,e.target.value,{dictated:e.target.dataset.dictationInserting==='true'})}/>
        </label>)}
        {report.addenda?.map(a=><article key={a.id}><h3>Signed addendum</h3><p className="rispro-report-text" dir="auto">{a.text}</p><p>{a.author} · {new Date(a.signedAt).toLocaleString()}</p></article>)}
        {report.status==='final' && s.context?.canFinalize && <>
          <label>Addendum text<textarea aria-label="Addendum text" value={addendum} onChange={e=>store.editAddendum(e.target.value)} rows={5}/></label>
          <Button disabled={!addendum.trim() || s.busy} onClick={()=>setConfirm('addendum')}>Add Addendum</Button>
          <span role="status">{saveStatus}</span>
        </>}
      </>}
      {tab==='images' && <>
        <p>Stored PNG report illustrations. Annotations are snapshots.</p>
        <Button disabled={!editable || !!s.pendingCapture} onClick={()=>run(store.capture)}>Add Key Image</Button>
        {s.pendingCapture && <div role="alert">Image upload has not been acknowledged. Keep this tab open.
          <Button disabled={s.conflict || s.busy} onClick={()=>run(store.retryCapture)}>Retry upload</Button>
          <Button variant="outline" onClick={store.discardCapture}>Discard pending upload</Button>
        </div>}
        {selection.map((image,index)=><figure key={image.id}>
          <a href={store.imageUrl(image)} target="_blank" rel="noopener noreferrer"><img src={store.imageUrl(image)} alt={`Saved key image ${index+1}`}/></a>
          <figcaption>{index+1}. {image.provenance.sourceSeriesDescription} · {image.provenance.sourceStudyDate} {image.provenance.prior?'(prior study)':''}</figcaption>
          <Input aria-label={`Caption ${index+1}`} value={s.captionEdits[image.id]??image.caption} readOnly={!editable}
            onChange={e=>store.editCaption(image.id,e.target.value)} onBlur={()=>{if(editable && Object.hasOwn(s.captionEdits,image.id))run(store.save);}}/>
          <div className="rispro-report-actions">
            <Button variant="outline" onClick={()=>run(()=>store.locate(image))}>{image.provenance.viewportType==='stack'?'Locate Source':'Open Source Series'}</Button>
            {editable && <>
              <Button variant="outline" disabled={index===0} onClick={()=>run(()=>{const copy=[...selection];[copy[index-1],copy[index]]=[copy[index],copy[index-1]];return store.images(copy);})}>Up</Button>
              <Button variant="outline" disabled={index===selection.length-1} onClick={()=>run(()=>{const copy=[...selection];[copy[index+1],copy[index]]=[copy[index],copy[index+1]];return store.images(copy);})}>Down</Button>
              <Button variant="outline" onClick={()=>run(()=>store.images(selection.filter(i=>i.id!==image.id)))}>Remove</Button>
            </>}
          </div>
        </figure>)}
      </>}
      {tab==='history' && <ol>{s.history?.map(v=><li key={v.id}><strong>{v.kind} · revision {v.revision ?? 'addendum'}</strong><p>{v.author} · {new Date(v.createdAt).toLocaleString()}</p>
        <details><summary>View preserved text</summary><div className="rispro-report-text">{v.kind==='addendum'?v.snapshot.text:Object.entries(v.snapshot.sections || {}).map(([key,text])=><p key={key}>{labels[key]}: {text}</p>)}</div></details></li>)}</ol>}
    </>}
    <Dialog open={!!confirm} onOpenChange={open=>{if(!open && !s.busy)setConfirm(null);}}>
      <DialogContent><DialogHeader><DialogTitle>{confirm==='finalize'?'Finalize report':'Sign text addendum'}</DialogTitle><DialogDescription>
        {identity?.patientName} · {identity?.patientIdentifier}<br/>{identity?.accession} · {identity?.examination} · {identity?.studyDate}<br/>
        The signed content and ordered images are immutable. Corrections require a signed text addendum.
      </DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={s.busy} onClick={()=>setConfirm(null)}>Cancel</Button><Button disabled={s.busy} onClick={confirmAction}>Confirm and sign</Button></DialogFooter></DialogContent>
    </Dialog>
  </section>;
}
