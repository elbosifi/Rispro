import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api} from '@/lib/api-client';
import {generateMedGemmaText,getMedGemmaHealth} from '@/lib/medgemma-api';
import type {ReportingPolicy,ReportingTemplate,WorkspaceReport} from '@/lib/reporting-workspace-api';
import {StandaloneReportPage} from './standalone-report-editor';
import {ReportingStudyPage} from './reporting-study-page';

vi.mock('@/lib/api-client',async original=>({...await original<typeof import('@/lib/api-client')>(),api:vi.fn()}));
vi.mock('@/lib/medgemma-api',async original=>({...await original<typeof import('@/lib/medgemma-api')>(),generateMedGemmaText:vi.fn(),getMedGemmaHealth:vi.fn()}));
let userId=7;
vi.mock('@/providers/auth-provider',()=>({useAuth:()=>({user:{id:userId,fullName:'Synthetic Doctor',role:'doctor'}})}));
vi.mock('@/providers/dictation-context',()=>({useDictation:()=>({busy:false,cancel:vi.fn()})}));
vi.mock('@/lib/use-workspace-images',()=>({useWorkspaceImages:()=>({ready:true,busy:false,launch:vi.fn()})}));
vi.mock('@/lib/api-hooks',()=>({fetchOhifViewerAvailability:async()=>({enabled:true,configured:true,openMode:'new_tab'})}));
vi.mock('@/components/doctor/protocoling-appointment-details-drawer',()=>({DoctorReadOnlyDetailsDrawer:()=>null}));
const policy:ReportingPolicy={enabled:true,version:1,creation:'accessible',collaboration:'both',review:'mandatory',mandatoryReviewRoles:['resident'],reviewerDoctorRoles:['consultant','specialist'],reviewEligibility:'open',signing:'permission',additional:'typed',allowedTypes:['primary'],deletion:'creator',restoreRevisions:true};
function fixture():WorkspaceReport{return {id:42,appointmentId:null,studyKey:'synthetic',revision:1,status:'draft',sections:{clinicalHistory:'History',comparison:'None',technique:'CT',findings:'Original findings',impression:'Original impression'},identity:{patientName:'Synthetic Patient',patientIdentifier:'SYN-42',accession:'ACC-42',examination:'CT',studyDate:'20261106'},author:'Junior Doctor',creatorId:7,contributors:[],lastEditor:'Junior Doctor',finalizer:null,finalizedAt:null,reportType:'primary',mode:'shared',isPrimary:false,createdAt:'2026-11-06',updatedAt:'2026-11-06',deletedAt:null,canEdit:true,canFinalize:false,finalizeReasons:['Independent senior review is required.'],canReview:false,canDelete:false,canRecover:false,canRestoreRevision:true,reviewEnabled:true,reviewRequestedBy:null,reviewRequestedAt:null,preferredReviewerId:null,keyImages:[{id:'image',caption:'Axial key image',provenance:{sourceSeriesDescription:'Axial CT',sourceStudyDate:'20261106',prior:false}}],addenda:[]};}
let report:WorkspaceReport,templates:ReportingTemplate[],reviews:{id:number;actor_name:string;comment:string;event_type:string;created_at:string}[],client:QueryClient;
function body(options?:RequestInit){return JSON.parse(String(options?.body||'{}'));}
function mount(study=false){client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[study?'/doctor/reporting/studies/synthetic':'/doctor/reporting/reports/'+report.id]}><Routes><Route path="/doctor/reporting/reports/:reportId" element={<StandaloneReportPage/>}/><Route path="/doctor/reporting/studies/:studyKey" element={<ReportingStudyPage/>}/></Routes></MemoryRouter></QueryClientProvider>);return client;}
function writes(){return vi.mocked(api).mock.calls.filter(([path,options])=>path.endsWith('/draft')&&options?.method==='PUT');}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {resolve,promise};}
beforeEach(()=>{
  userId=7;report=fixture();reviews=[];templates=[{id:10,name:'Personal CT',sections:{...report.sections,findings:'Reusable findings'},createdAt:'2026-11-06',updatedAt:'2026-11-06'}];localStorage.clear();
  vi.mocked(getMedGemmaHealth).mockResolvedValue({status:'connected'});vi.mocked(generateMedGemmaText).mockResolvedValue({text:'Proposed findings',processing_seconds:1});
  vi.mocked(api).mockImplementation(async(path,options)=>{
    const input=body(options);
    if(path.endsWith('/templates')){
      if(options?.method==='POST'){const t={...input,id:11,createdAt:'2026-11-06',updatedAt:'2026-11-06'} as ReportingTemplate;templates.push(t);return t as never;}
      return {builtins:[{id:'blank',name:'Blank narrative'},{id:'structured',name:'Structured narrative'}],templates} as never;
    }
    if(/\/templates\/\d+$/.test(path)){const id=Number(path.split('/').at(-1));if(options?.method==='DELETE'){templates=templates.filter(t=>t.id!==id);return undefined as never;}const t=templates.find(t=>t.id===id)!;if(options?.method==='PUT')Object.assign(t,input);return {...t} as never;}
    if(path.endsWith('/history'))return {versions:[],reviews} as never;
    if(path.endsWith('/reviewers'))return {reviewers:[{id:8,name:'Eligible Consultant'}]} as never;
    if(path.includes('/studies/')&&!path.endsWith('/reports'))return {studyKey:'synthetic',identity:report.identity,studyUid:'1.2.3',reports:[],policy,freshness:{status:'ready'},canCreate:true,blockedReason:null,primaryReportId:null} as never;
    if(path.endsWith('/draft')&&options?.method==='PUT'){report={...report,revision:report.revision+1,sections:input.sections};return report as never;}
    if(path.endsWith('/review')){reviews=[...reviews,{id:reviews.length+1,event_type:input.action,comment:input.comment||'',actor_name:'Synthetic Doctor',created_at:'2026-11-06'}];report={...report,revision:report.revision+1,status:input.action==='return'?'draft':'in_review',reviewRequestedBy:7,reviewRequestedAt:input.action==='return'?null:'2026-11-06',canEdit:input.action==='return'||userId===8,canReview:userId===8};return report as never;}
    if(path.endsWith('/finalize')){report={...report,revision:report.revision+1,status:'final',canEdit:false,finalizer:'Synthetic Doctor',finalizedAt:'2026-11-06'};return report as never;}
    return report as never;
  });
});
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});
async function openAI(){await screen.findByDisplayValue('Original findings');fireEvent.click(screen.getByRole('button',{name:'MedGemma assistance'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Preview AI Output'}) as HTMLButtonElement).disabled).toBe(false));}

it('creates new reports by personal template id and retains built-in choices',async()=>{
  mount(true);await screen.findByRole('option',{name:'Personal CT (personal)'});
  expect(screen.getByRole('option',{name:'Blank narrative'})).toBeTruthy();expect(screen.getByRole('option',{name:'Structured narrative'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Template'),{target:{value:'personal:10'}});fireEvent.click(screen.getByRole('button',{name:'Create Report'}));await screen.findByDisplayValue('Original findings');
  const creation=vi.mocked(api).mock.calls.find(([path,options])=>path.endsWith('/studies/synthetic/reports')&&options?.method==='POST')!;
  expect(body(creation[1])).toMatchObject({templateId:10});expect(body(creation[1]).sections).toBeUndefined();expect(body(creation[1]).template).toBeUndefined();
});
it('does not silently substitute a deleted saved template',async()=>{localStorage.setItem('rispro.reporting.preferences.7',JSON.stringify({filtersVersion:2,template:'personal:99'}));mount(true);await screen.findByRole('option',{name:/Saved template unavailable/});expect((screen.getByRole('button',{name:'Create Report'}) as HTMLButtonElement).disabled).toBe(true);});
it.each(['blank','structured'])('preserves %s report creation requests',async template=>{mount(true);await screen.findByRole('option',{name:'Personal CT (personal)'});fireEvent.change(screen.getByLabelText('Template'),{target:{value:template}});fireEvent.click(screen.getByRole('button',{name:'Create Report'}));await screen.findByDisplayValue('Original findings');const creation=vi.mocked(api).mock.calls.find(([path,options])=>path.endsWith('/studies/synthetic/reports')&&options?.method==='POST')!;expect(body(creation[1]).template).toBe(template);expect(body(creation[1]).templateId).toBeUndefined();});
it('requires content review for copying, creating, renaming, editing and deleting templates without changing the report',async()=>{
  mount();await screen.findByDisplayValue('Original findings');fireEvent.click(screen.getByRole('button',{name:'Personal reporting templates'}));fireEvent.click(screen.getByRole('button',{name:'Copy Current Report Sections'}));
  fireEvent.change(screen.getByLabelText('Template name'),{target:{value:'Reviewed reusable text'}});
  const save=screen.getByRole('button',{name:'Save Personal Template'});expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed every section/));fireEvent.change(screen.getByLabelText('Template Findings'),{target:{value:'Reusable reviewed findings'}});expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I reviewed every section/));fireEvent.click(save);await screen.findByText(/Personal template saved/);
  const creation=vi.mocked(api).mock.calls.find(([path,options])=>path.endsWith('/templates')&&options?.method==='POST')!;
  expect(Object.keys(body(creation[1])).sort()).toEqual(['name','sections']);expect(body(creation[1]).sections).toEqual({...fixture().sections,findings:'Reusable reviewed findings'});
  fireEvent.click(screen.getByRole('button',{name:'Edit / Rename'}));await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('/templates/11'))).toBe(true));
  fireEvent.change(screen.getByLabelText('Template name'),{target:{value:'Renamed template'}});fireEvent.click(screen.getByLabelText(/I reviewed every section/));fireEvent.click(save);await waitFor(()=>expect(templates.find(t=>t.id===11)?.name).toBe('Renamed template'));
  fireEvent.click(screen.getByRole('button',{name:'Delete Personal Template'}));fireEvent.click(screen.getByRole('button',{name:'Confirm Template Deletion'}));await screen.findByText(/Personal template deleted/);
  expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Original findings');expect(writes()).toHaveLength(0);
});
it('previews, explicitly accepts, preserves original text for undo and requires a manual Save',async()=>{
  mount();await openAI();fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByDisplayValue('Proposed findings');
  expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Original findings');fireEvent.click(screen.getByRole('button',{name:'Accept AI Change'}));
  expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Proposed findings');await act(()=>new Promise(resolve=>setTimeout(resolve,1300)));expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Undo AI Change'}));expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Original findings');
  fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByDisplayValue('Proposed findings');fireEvent.click(screen.getByRole('button',{name:'Accept AI Change'}));fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(writes()).toHaveLength(1));expect(body(writes()[0][1]).sections.findings).toBe('Proposed findings');
});
it('rejects AI output without changing report text',async()=>{mount();await openAI();fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByDisplayValue('Proposed findings');fireEvent.click(screen.getByRole('button',{name:'Reject / Dismiss AI Output'}));expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Original findings');expect(writes()).toHaveLength(0);});
it('blocks stale responses after manual edits and keeps unsaved text intact',async()=>{
  const pending=deferred<{text:string;processing_seconds:number}>();vi.mocked(generateMedGemmaText).mockReturnValue(pending.promise);
  mount();await openAI();fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'New unsaved finding'}});
  await act(async()=>pending.resolve({text:'Stale AI result',processing_seconds:1}));await screen.findByDisplayValue('Stale AI result');expect((screen.getByRole('button',{name:'Accept AI Change'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('New unsaved finding');expect(writes()).toHaveLength(0);
});
it('aborts an AI request when the report is closed and ignores a late response in another report',async()=>{
  const pending=deferred<{text:string;processing_seconds:number}>();vi.mocked(generateMedGemmaText).mockReturnValue(pending.promise);mount();await openAI();fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));const signal=vi.mocked(generateMedGemmaText).mock.calls[0][3]!;
  cleanup();client.clear();report={...fixture(),id:43,sections:{...fixture().sections,findings:'Other report text'}};mount();await screen.findByDisplayValue('Other report text');expect(signal.aborted).toBe(true);
  await act(async()=>pending.resolve({text:'Late result for previous report',processing_seconds:1}));expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Other report text');expect(screen.queryByDisplayValue('Late result for previous report')).toBeNull();
});
it('retains unsaved text when MedGemma fails',async()=>{vi.mocked(generateMedGemmaText).mockRejectedValue(new Error('Synthetic AI outage'));mount();await openAI();fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'Retain unsaved text'}});fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByText('Synthetic AI outage');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Retain unsaved text');expect(writes()).toHaveLength(0);});
it.each(['correct_terminology','format_radiology_report'] as const)('uses the existing %s task on the selected section',async task=>{mount();await openAI();fireEvent.change(screen.getByLabelText('Medical AI task'),{target:{value:task}});fireEvent.change(screen.getByLabelText('AI report section'),{target:{value:'impression'}});fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByDisplayValue('Proposed findings');expect(generateMedGemmaText).toHaveBeenCalledWith(task,'Original impression',undefined,expect.any(AbortSignal));});
it('shows report review as unverified suggestions and never inserts it as findings',async()=>{mount();await openAI();fireEvent.change(screen.getByLabelText('Medical AI task'),{target:{value:'review_radiology_report'}});fireEvent.click(screen.getByRole('button',{name:'Preview AI Output'}));await screen.findByDisplayValue('Proposed findings');expect(generateMedGemmaText).toHaveBeenCalledWith('review_radiology_report',expect.stringContaining('Findings:\nOriginal findings'),undefined,expect.any(AbortSignal));expect(screen.queryByRole('button',{name:'Accept AI Change'})).toBeNull();expect(screen.getByText(/AI review suggestions are unverified/)).toBeTruthy();});
it('submits to a server-provided senior and displays prohibited signing reasons',async()=>{
  mount();await screen.findByRole('option',{name:'Eligible Consultant'});expect((screen.getByRole('button',{name:'Finalize'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText('Independent senior review is required.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Preferred senior reviewer'),{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:'Submit for Review'}));await screen.findByText('Submitted for senior review');
  const submit=vi.mocked(api).mock.calls.find(([path,options])=>path.endsWith('/review')&&options?.method==='POST')!;expect(body(submit[1])).toMatchObject({action:'submit',preferredReviewerId:8,expectedRevision:1});expect(screen.queryByRole('button',{name:'Add Feedback'})).toBeNull();expect(screen.getByRole('button',{name:'Withdraw Review'})).toBeTruthy();
});
it('lets an eligible reviewer record feedback and return a report, retaining review history',async()=>{
  userId=8;report={...report,status:'in_review',reviewRequestedAt:'2026-11-06',reviewRequestedBy:7,canEdit:true,canReview:true};mount();await screen.findByText('Submitted for senior review');expect(screen.queryByRole('button',{name:'Withdraw Review'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Review comment'),{target:{value:'Please revise comparison'}});fireEvent.click(screen.getByRole('button',{name:'Add Feedback'}));await screen.findByText('Reviewed · feedback recorded; awaiting finalization');fireEvent.click(screen.getByRole('button',{name:'Return to Draft'}));await screen.findByText('Returned for revision');expect(reviews.map(event=>event.event_type)).toEqual(['feedback','return']);
});
it('finalizes only after the explicit signer confirmation and keeps final reports read only',async()=>{
  userId=8;report={...report,canFinalize:true,finalizeReasons:[]};mount();await screen.findByDisplayValue('Original findings');fireEvent.click(screen.getByRole('button',{name:'Finalize'}));expect(vi.mocked(api).mock.calls.some(([path])=>path.endsWith('/finalize'))).toBe(false);fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Confirm and Sign'}));await screen.findByText('Read Only / Finalized');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).readOnly).toBe(true);expect(screen.queryByRole('button',{name:'MedGemma assistance'})).toBeNull();expect(screen.getByAltText('Report key image 1')).toBeTruthy();expect(screen.getByText(/Axial key image/)).toBeTruthy();expect(screen.getByRole('link',{name:'Print'}).getAttribute('href')).toContain('/reports/42/print');
});
it('preserves unsaved text if a refreshed report has a newer revision',async()=>{const cache=mount();await screen.findByDisplayValue('Original findings');fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'My retained unsaved text'}});act(()=>cache.setQueryData(['workspace-report','42'],{...report,revision:2,sections:{...report.sections,findings:'Remote update'}}));await screen.findByText('Revision Conflict');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('My retained unsaved text');expect((screen.getByRole('button',{name:'Save'}) as HTMLButtonElement).disabled).toBe(true);});
it('refreshes policy restrictions without replacing unsaved text or sending a revoked autosave',async()=>{const cache=mount();await screen.findByDisplayValue('Original findings');fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'Unsaved work to retain'}});act(()=>cache.setQueryData(['workspace-report','42'],{...report,canEdit:false,blockedReason:'Archive verification became unavailable.'}));await screen.findByText('Archive verification became unavailable.');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Unsaved work to retain');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).readOnly).toBe(true);await act(()=>new Promise(resolve=>setTimeout(resolve,1300)));expect(writes()).toHaveLength(0);});
it('selects historical revisions with PostgreSQL bigint string identifiers',async()=>{
  const fallback=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(path,options)=>path.endsWith('/history')?{versions:[{id:'9001',revision:1,kind:'draft',author:'First editor',createdAt:'2026-11-05',snapshot:{sections:{...report.sections,findings:'Historical original'}}},{id:'9002',revision:2,kind:'draft',author:'Second editor',createdAt:'2026-11-06',snapshot:{sections:report.sections}}],reviews:[]} as never:await fallback(path,options) as never);
  mount();await screen.findByDisplayValue('Original findings');fireEvent.click(screen.getByRole('button',{name:'History / Compare'}));await screen.findByRole('option',{name:/draft 1/});fireEvent.change(screen.getByLabelText('Revision',{exact:true}),{target:{value:'9001'}});await screen.findByText(/Editor: First editor/);expect(screen.getByText('Historical original',{exact:true})).toBeTruthy();expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Original findings');
});
