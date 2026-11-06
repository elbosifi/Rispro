import {useQuery} from '@tanstack/react-query';
import {Button,Card,Textarea,ErrorState} from '@/components/shared';
import {api} from '@/lib/api-client';
import {reportBase,type WorkspaceReport} from '@/lib/reporting-workspace-api';
import {useReportHistory} from './report-revision-history';

export function ReportReviewWorkflow({report,userId,editable,busy,conflict,comment,onComment,reviewer,onReviewer,onAction}:{
  report:WorkspaceReport;userId:number|undefined;editable:boolean;busy:boolean;conflict:boolean;comment:string;onComment:(value:string)=>void;reviewer:string;onReviewer:(value:string)=>void;
  onAction:(action:string,body:Record<string,unknown>)=>void;
}) {
  const enabled=Boolean(report.reviewEnabled||report.reviewRequestedAt),history=useReportHistory(report,Boolean(report.reviewRequestedBy||report.reviewRequestedAt||report.status==='final'),true);
  const reviewers=useQuery({queryKey:['report-reviewers',report.id],enabled:enabled&&report.status==='draft'&&!report.deletedAt,queryFn:()=>api<{reviewers:{id:number;name:string}[]}>(reportBase(report.id)+'/reviewers'),retry:false});
  const events=history.data?.reviews||[],last=events.at(-1),feedback=[...events].reverse().find(event=>event.comment);
  const state=report.status==='final'?'Finalized':report.status==='in_review'?last?.event_type==='feedback'?'Reviewed · feedback recorded; awaiting finalization':'Submitted for senior review':last?.event_type==='return'?'Returned for revision':last?.event_type==='withdraw'?'Review withdrawn · draft':'Draft';
  if(!enabled&&report.status!=='final')return null;
  const available=reviewers.data?.reviewers||[],selected=reviewer&&available.some(candidate=>Number(candidate.id)===Number(reviewer));
  const designated=report.reviewEligibility==='designated';
  const unavailable=Boolean(report.blockedReason),invalidSelection=Boolean(reviewer&&!selected)||designated&&!selected;
  return <Card variant="compact" className="space-y-3 !p-4"><h2 className="font-semibold">Senior review</h2><p role="status" className="text-sm font-medium">{state}</p>
    {history.error&&<ErrorState message={history.error.message} onRetry={()=>void history.refetch()}/>}
    {feedback&&<div className="text-sm"><p>{feedback.event_type==='return'?'Return comment':'Latest review comment'} · {feedback.actor_name} · {new Date(feedback.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap">{feedback.comment}</p></div>}
    {enabled&&report.status!=='final'&&!report.deletedAt&&<>
      <label className="block text-sm">Review comment<Textarea aria-label="Review comment" data-dictation="off" maxLength={10_000} value={comment} onChange={e=>onComment(e.target.value)} readOnly={busy}/></label>
      {report.status==='draft'&&<><label className="block text-sm">Preferred senior reviewer<select aria-label="Preferred senior reviewer" className="input-premium block w-full" value={selected?reviewer:''} disabled={busy||!editable||reviewers.isFetching} onChange={e=>onReviewer(e.target.value)}><option value="">{designated?'Choose a senior reviewer':'Eligible senior review queue'}</option>{available.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><p className="text-xs text-muted-foreground">Only eligible senior doctors with reporting access are listed. Preferred assignments follow the configured review policy.</p>{!reviewers.isFetching&&!available.length&&<p role="status" className="text-sm">No eligible senior reviewers are currently available for this study.</p>}{invalidSelection&&<p role="alert" className="text-sm">{designated?'Choose an eligible senior reviewer before submitting.':'The previously selected reviewer is no longer eligible. Choose an available reviewer or the review queue.'}</p>}{reviewers.error&&<ErrorState message={reviewers.error.message} onRetry={()=>void reviewers.refetch()}/>}<Button variant="secondary" disabled={!editable||busy||conflict||unavailable||invalidSelection||!available.length||reviewers.isFetching||Boolean(reviewers.error)} onClick={()=>onAction('review',{action:'submit',comment,preferredReviewerId:selected?Number(reviewer):null})}>Submit for Review</Button></>}
      {report.status==='in_review'&&<><p className="text-sm text-muted-foreground">{report.canReview?'You may provide feedback or return this report. Signing requires separate permission.':'Awaiting an eligible senior reviewer. Review actions are unavailable under the current policy.'}</p><div className="flex flex-wrap gap-2">{report.canReview&&<><Button variant="secondary" disabled={busy||conflict||unavailable||!comment.trim()} onClick={()=>onAction('review',{action:'feedback',comment})}>Add Feedback</Button><Button variant="secondary" disabled={busy||conflict||unavailable} onClick={()=>onAction('review',{action:'return',comment})}>Return to Draft</Button></>}{Number(report.reviewRequestedBy)===userId&&<Button variant="secondary" disabled={busy||conflict||unavailable} onClick={()=>onAction('review',{action:'withdraw',comment})}>Withdraw Review</Button>}</div></>}
    </>}
  </Card>;
}
