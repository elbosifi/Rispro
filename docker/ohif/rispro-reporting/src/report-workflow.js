// Framework-independent workspace contracts. Keep these semantics aligned with
// reporting-workspace-api.ts and the native reporting template/policy services.
export const reportFields={clinicalHistory:'Clinical history',comparison:'Comparison',technique:'Technique',findings:'Findings',impression:'Impression'};
export const aiTasks={cleanup_dictation:'Medical dictation cleanup',correct_terminology:'Medical terminology correction',format_radiology_report:'Report-section formatting',review_radiology_report:'Full-report radiology review'};
export const emptySections=()=>Object.fromEntries(Object.keys(reportFields).map(key=>[key,'']));
export const copySections=sections=>Object.fromEntries(Object.keys(reportFields).map(key=>[key,String(sections?.[key]??'')]));
export function templateSelection(value) {
  if(value==='blank'||value==='structured')return {template:value};
  const match=/^personal:([1-9]\d*)$/.exec(value),id=Number(match?.[1]);
  if(!match||!Number.isSafeInteger(id))throw Error('Select an available reporting template.');
  return {templateId:id};
}
export function templateInput(draft) {
  const name=draft.name.trim(),sections=copySections(draft.sections),values=Object.values(sections);
  if(!draft.confirmed)throw Error('Review every section and confirm removal of patient-identifying and case-specific text before saving a template.');
  if(!name||name.length>100||!values.some(text=>text.trim())||values.some(text=>text.length>20000)||values.reduce((n,text)=>n+text.length,0)>50000)throw Error('Use a name of 1–100 characters and reusable text of at most 20,000 characters per section / 50,000 total.');
  return {name,sections};
}
export function aiInput(task,field,sections) {
  if(!Object.hasOwn(aiTasks,task)||!Object.hasOwn(reportFields,field))throw Error('Select an available AI task and report section.');
  const text=task==='review_radiology_report'?Object.entries(reportFields).map(([key,label])=>label+':\n'+(sections?.[key]||'')).join('\n\n'):sections?.[field]||'';
  if(!text.trim()||text.length>32000)throw Error('MedGemma input must contain 1–32,000 characters.');
  return text;
}
export function changedText(before,after) {
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let end=0;while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  return {prefix:after.slice(0,start),removed:before.slice(start,before.length-end),added:after.slice(start,after.length-end),suffix:end?after.slice(-end):''};
}
export function reviewState(report,events=[]) {
  if(report?.status==='final')return 'Signed / finalized';
  const last=events.at(-1)?.event_type;
  return report?.status==='in_review'?last==='feedback'?'Reviewed · feedback recorded; awaiting finalization':'Submitted for senior review':last==='return'?'Returned for revision':last==='withdraw'?'Review withdrawn · draft':'Draft';
}
