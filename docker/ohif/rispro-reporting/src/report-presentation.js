// Dates must be complete and valid. Never substitute the workstation's current date.
function dateParts(value) {
  const match=/^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value||'');
  if(!match)return null;
  const [,y,m,d]=match.map(Number),date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?[y,m,d]:null;
}
export function ageAtExamination(birthDate,studyDate) {
  const birth=dateParts(birthDate),exam=dateParts(studyDate);
  if(!birth||!exam||Date.UTC(birth[0],birth[1]-1,birth[2])>Date.UTC(exam[0],exam[1]-1,exam[2]))return null;
  const years=exam[0]-birth[0]-(exam[1]<birth[1]||exam[1]===birth[1]&&exam[2]<birth[2]?1:0);
  return years<0?null:years;
}
export function finalizeDisabledReasons(s) {
  const reasons=[];
  if(s.conflict)reasons.push('Resolve the report conflict by reloading the saved report before signing.');
  if(s.busy||s.saving)reasons.push('Wait for the current report operation to finish.');
  if(s.pendingCapture)reasons.push('Retry or discard the pending key-image upload before signing.');
  if(s.dictationBusy)reasons.push('Finish dictation before signing.');
  if(s.ai?.busy||s.ai?.proposal&&!s.ai.proposal.applied)reasons.push('Finish or dismiss the AI proposal before signing.');
  if(s.aiSaveRequired&&s.dirty)reasons.push('Explicitly Save accepted AI changes before signing.');
  if(s.templateDraft?.dirty||s.templateBusy)reasons.push('Save or discard template edits before signing.');
  if(!(s.report?.canFinalize??s.context?.canFinalize))reasons.push(...(s.report?.finalizeReasons?.length?s.report.finalizeReasons:s.context?.finalizeReasons?.length?s.context.finalizeReasons:[s.report?.blockedReason||s.context?.blockedReason||'Signing eligibility could not be verified. Reload the report context.']));
  return [...new Set(reasons)];
}
