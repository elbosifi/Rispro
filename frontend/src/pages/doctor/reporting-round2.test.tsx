import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {api,ApiError} from '@/lib/api-client';
import {formatStudyDate,refreshReportingQueries,type WorkspaceReport} from '@/lib/reporting-workspace-api';
import {useWorkspaceImages} from '@/lib/use-workspace-images';
import {ReportingWorkspacePage} from './reporting-workspace-page';
import {StandaloneReportPage} from './standalone-report-editor';

vi.mock('@/lib/api-client',async original=>({...await original<typeof import('@/lib/api-client')>(),api:vi.fn()}));
vi.mock('@/providers/auth-provider',()=>({useAuth:()=>({user:{id:7,fullName:'Synthetic Doctor'}})}));
vi.mock('@/providers/dictation-context',()=>({useDictation:()=>null}));
vi.mock('@/lib/api-hooks',()=>({fetchOhifViewerAvailability:async()=>({enabled:true,configured:true,openMode:'new_tab'}),launchReportingBoardCaseInOhif:vi.fn()}));
vi.mock('@/components/doctor/protocoling-appointment-details-drawer',()=>({DoctorReadOnlyDetailsDrawer:()=>null}));
const clients:QueryClient[]=[];
function client(){const c=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(c);return c;}
function Location(){const l=useLocation();return <output data-testid="location">{l.pathname+l.search}</output>;}
const report=():WorkspaceReport=>({id:42,appointmentId:null,studyKey:'synthetic',revision:1,status:'draft',sections:{clinicalHistory:'',comparison:'',technique:'',findings:'Original',impression:'Synthetic'},identity:{patientName:'Synthetic Patient',patientIdentifier:'SYN-42',accession:'SYN-A',examination:'CT',studyDate:'20261030'},author:'Doctor',creatorId:7,contributors:[],lastEditor:'Doctor',finalizer:null,finalizedAt:null,reportType:'primary',mode:'independent',isPrimary:false,createdAt:'',updatedAt:'',deletedAt:null,canEdit:true,canFinalize:true,canReview:true,canDelete:true,canRecover:false,canRestoreRevision:true,reviewRequestedBy:null,reviewRequestedAt:null,preferredReviewerId:null,keyImages:[],addenda:[]});
const catalogue={studies:[{orthanc_study_id:'synthetic',patient_name_raw:'Synthetic Patient',patient_id:'SYN-42',accession_number:'A',study_description:'CT',modalities_in_study:['CT'],study_date:'20261030',series_count:2,reporting_status:'no_report',external_reporting_status:'unknown',report_count:0,reports:[],assigned_doctor:null}],total:1,limit:25,offset:0,freshness:{status:'ready',lastSuccessAt:null,error:null},modalities:['CT']};
function mount(path='/doctor/reporting/reports/42?returnTo='+encodeURIComponent('/doctor/reporting?view=appointments&q=SYN&offset=50&sort=patient&direction=asc')){
  const c=client();
  render(<QueryClientProvider client={c}><MemoryRouter initialEntries={[path]}><Location/><Routes><Route path="/doctor/reporting/reports/:reportId" element={<StandaloneReportPage/>}/><Route path="/doctor/reporting" element={<ReportingWorkspacePage/>}/></Routes></MemoryRouter></QueryClientProvider>);
  return c;
}
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});localStorage.clear();});
afterEach(()=>{cleanup();clients.forEach(c=>c.clear());clients.length=0;vi.restoreAllMocks();vi.mocked(api).mockReset();});

it.each([['20261030','30 Oct 2026'],['2026-10-30','30 Oct 2026'],['20240229','29 Feb 2024'],['20230229','—'],['20261301','—'],['20260431','—'],['2026','—'],[null,'—'],['garbage','—']])('formats calendar date %s safely',(input,expected)=>expect(formatStudyDate(input)).toBe(expected));

it('defaults to PACS, keeps appointment queries separate, and retains cached worklist pages',async()=>{
  vi.mocked(api).mockImplementation(async path=>String(path).includes('/appointments?')?{appointments:[{appointmentId:1,patientId:2,patientEnglishName:'Unlinked appointment',patientIdentifier:'SYN-2',appointmentNumber:'V2-000001',modalityCode:'CT',modalityName:'CT',appointmentDate:'2026-10-30',appointmentStatus:'completed',studyKey:null,reportingStatus:null,externalReportingStatus:'no_report'}],total:1,offset:0,limit:25,freshness:catalogue.freshness,modalities:['CT']}:catalogue as never);
  mount('/doctor/reporting?q=SYN&sort=patient&direction=asc');
  await screen.findByText('Synthetic Patient');expect(screen.getByRole('button',{name:'PACS Studies'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/30 Oct 2026/)).toBeTruthy();expect(vi.mocked(api).mock.calls.filter(([p])=>p.includes('/appointments?'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'RISpro Appointments'}));await screen.findByText('Not in PACS / Study Not Linked');expect(screen.queryByRole('link',{name:'Open Reports'})).toBeNull();
  expect(screen.getByTestId('location').textContent).toContain('view=appointments');
  fireEvent.click(screen.getByRole('button',{name:'PACS Studies'}));await screen.findByText('Synthetic Patient');
  expect(vi.mocked(api).mock.calls.filter(([p])=>p.includes('/studies?'))).toHaveLength(1);
});

it('serializes pending saves and newer edits before SPA return with exact worklist state',async()=>{
  const first=deferred<WorkspaceReport>(),second=deferred<WorkspaceReport>();let writes=0;
  vi.mocked(api).mockImplementation(async(path,options)=>{
    if(options?.method==='PUT')return (++writes===1?first.promise:second.promise) as never;
    return (path.includes('/appointments?')?{appointments:[],total:0,limit:25,offset:50,freshness:catalogue.freshness,modalities:['CT']}:report()) as never;
  });
  mount();await screen.findByDisplayValue('Original');
  fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'First edit'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));await screen.findByText('Saving…');
  fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'Latest edit'}});fireEvent.click(screen.getByRole('link',{name:'Back to Reporting Worklist'}));
  expect(screen.getByTestId('location').textContent).toContain('/reports/42');
  await act(async()=>first.resolve({...report(),revision:2,sections:{...report().sections,findings:'First edit'}}));
  await waitFor(()=>expect(writes).toBe(2));expect(screen.getByTestId('location').textContent).toContain('/reports/42');
  expect(JSON.parse(String(vi.mocked(api).mock.calls.filter(([,o])=>o?.method==='PUT')[1][1]?.body)).sections.findings).toBe('Latest edit');
  await act(async()=>second.resolve({...report(),revision:3,sections:{...report().sections,findings:'Latest edit'}}));
  await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('view=appointments'));
  for(const part of ['q=SYN','offset=50','sort=patient','direction=asc'])expect(screen.getByTestId('location').textContent).toContain(part);
});

it.each([[503,'Save Failed'],[409,'Revision Conflict']])('retains unsaved text and blocks navigation after HTTP %s',async(code,label)=>{
  vi.mocked(api).mockImplementation(async(_path,options)=>{if(options?.method==='PUT')throw new ApiError('Synthetic save error',code);return report() as never;});
  mount();await screen.findByDisplayValue('Original');fireEvent.change(screen.getByLabelText('Findings'),{target:{value:'Must retain this text'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
  await screen.findByText(label,{exact:true});fireEvent.click(screen.getByRole('link',{name:'Back to Reporting Worklist'}));
  await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('/reports/42'));
  expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).value).toBe('Must retain this text');expect(screen.queryByText('Saved',{exact:true})).toBeNull();
});

it('labels finalized reports read only',async()=>{vi.mocked(api).mockResolvedValue({...report(),status:'final',canEdit:false});mount();await screen.findByText('Read Only / Finalized');expect((screen.getByLabelText('Findings') as HTMLTextAreaElement).readOnly).toBe(true);});

it('updates the affected report and invalidates status pages without refetching unrelated catalogue rows',()=>{
  const c=client();c.setQueryData(['reporting-catalogue','status=all'],catalogue);c.setQueryData(['reporting-catalogue','q=other&status=all'],{...catalogue,studies:[]});c.setQueryData(['reporting-catalogue','status=final'],{...catalogue,studies:[]});
  refreshReportingQueries(c,report());expect(c.getQueryState(['reporting-catalogue','status=all'])?.isInvalidated).toBe(true);expect(c.getQueryState(['reporting-catalogue','q=other&status=all'])?.isInvalidated).toBe(false);expect(c.getQueryState(['reporting-catalogue','status=final'])?.isInvalidated).toBe(true);expect(c.getQueryData(['workspace-report','42'])).toEqual(report());
});

it('keeps unrelated status pages and appointment lists fresh during ordinary PACS-only text saves',()=>{
  const c=client();c.setQueryData(['workspace-report','42'],report());c.setQueryData(['reporting-catalogue','status=final'],{...catalogue,studies:[]});c.setQueryData(['reporting-appointments','status=all'],{appointments:[]});
  refreshReportingQueries(c,{...report(),revision:2,sections:{...report().sections,findings:'New text'}});
  expect(c.getQueryState(['reporting-catalogue','status=final'])?.isInvalidated).toBe(false);expect(c.getQueryState(['reporting-appointments','status=all'])?.isInvalidated).toBe(false);
});

it('opens the placeholder before async authorization, prevents duplicate launches, and closes failures',async()=>{
  const c=client(),close=vi.fn(),replace=vi.fn(),tab={opener:window,closed:false,close,location:{replace}},open=vi.spyOn(window,'open').mockReturnValue(tab as unknown as Window);
  const {result}=renderHook(useWorkspaceImages,{wrapper:({children})=><QueryClientProvider client={c}>{children}</QueryClientProvider>});await waitFor(()=>expect(result.current.ready).toBe(true));
  const pending=deferred<{status:string;launchUrl:string;openMode:'new_tab'}>(),request=vi.fn(()=>{expect(open).toHaveBeenCalledTimes(1);return pending.promise;});let launch!:Promise<void>;
  act(()=>{launch=result.current.launch(request);void result.current.launch(request);});await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));expect(tab.opener).toBeNull();
  await act(async()=>{pending.resolve({status:'ready',launchUrl:'/api/ohif/launch/synthetic',openMode:'new_tab'});await launch;});expect(replace).toHaveBeenCalledWith('/api/ohif/launch/synthetic');
  await act(async()=>result.current.launch(async()=>{throw new Error('Synthetic launch failure');}));expect(close).toHaveBeenCalled();expect(result.current.error).toBe('Synthetic launch failure');
});

it('reports popup blocking before requesting a token',async()=>{
  vi.spyOn(window,'open').mockReturnValue(null);const c=client(),request=vi.fn();const {result}=renderHook(useWorkspaceImages,{wrapper:({children})=><QueryClientProvider client={c}>{children}</QueryClientProvider>});await waitFor(()=>expect(result.current.ready).toBe(true));
  await act(async()=>result.current.launch(request));expect(request).not.toHaveBeenCalled();expect(result.current.blocked).toBe(true);expect(result.current.error).toContain('Allow popups');
});
