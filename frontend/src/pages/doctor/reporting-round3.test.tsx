import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {api} from '@/lib/api-client';
import {DoctorHomeV2} from './doctor-home-v2';
import {IndexFreshness} from './reporting-workspace-page';
import {ReportingWorkspacePage} from './reporting-workspace-page';
import {loadReportingPreferences,saveReportingPreferences} from '@/lib/reporting-workspace-api';

vi.mock('@/lib/api-client',async original=>({...await original<typeof import('@/lib/api-client')>(),api:vi.fn()}));
vi.mock('@/providers/auth-provider',()=>({useAuth:()=>({user:{id:7}})}));
vi.mock('@/lib/api-hooks',()=>({fetchOhifViewerAvailability:async()=>({enabled:true,configured:true,openMode:'new_tab'}),launchReportingBoardCaseInOhif:vi.fn()}));
vi.mock('@/components/doctor/protocoling-appointment-details-drawer',()=>({DoctorReadOnlyDetailsDrawer:()=>null}));
const clients:QueryClient[]=[];
afterEach(()=>{cleanup();clients.forEach(c=>c.clear());clients.length=0;vi.clearAllMocks();localStorage.clear();});

it('labels personal assignments, designated reviews, open queue and native/external signatures separately',async()=>{
  vi.mocked(api).mockResolvedValue({workload:{assigned:8,pending:3,drafts:4,shared:2,awaiting_review:1,submitted:2,open_review:6},activity:[{modality:'CT',total:5},{modality:'MR',total:2}],totalFinalized:7,additionalFinalized:2,externalFinalized:3,externalActivity:[{modality:'CT',total:3}],departmentCompleted:23,pending:[],nextDuty:null});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><DoctorHomeV2/></MemoryRouter></QueryClientProvider>);
  await screen.findByText('Review requests designated to me');
  expect(within(screen.getByText('Review requests designated to me').parentElement!).getByText('1')).toBeTruthy();
  expect(within(screen.getByText('Submitted by me for review').parentElement!).getByText('2')).toBeTruthy();
  expect(screen.getByText('Open review requests available to me: 6 (shared queue; excludes my submissions).')).toBeTruthy();
  expect(screen.getByText('RISpro reports signed by me')).toBeTruthy();
  expect(screen.getByText(/Includes 2 additional interpretations/)).toBeTruthy();
  expect(screen.getByText(/SonicDICOM appointment finals attributed to me in this period: 3/)).toBeTruthy();
  expect(screen.getByText(/Department completed \(all time\): 23/)).toBeTruthy();
  expect(screen.getByText('MRI')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Today'}));
  await vi.waitFor(()=>expect(api).toHaveBeenLastCalledWith('/native-reporting/workspace/dashboard?days=1'));
});

it('warns about outdated cached metadata even when the stale index has no error text',()=>{
  render(<IndexFreshness value={{status:'stale',lastSuccessAt:'2025-12-31T22:30:00Z',error:null}}/>);
  expect(screen.getByRole('alert').textContent).toContain('Cached metadata may be outdated');
  expect(screen.getByRole('status').textContent).toContain('01/01/2026, 00:30:00');
  expect(screen.getByRole('status').textContent).toContain('read-only until synchronization recovers');
});

it('resets obsolete remembered status defaults while preserving newly chosen filters and editor preferences',()=>{
  localStorage.setItem('rispro.reporting.preferences.7',JSON.stringify({status:'unknown',modality:'CT',compact:true,template:'structured',dashboardDays:30}));
  const p=loadReportingPreferences(7);expect(p.status).toBe('all');expect(p.modality).toBe('');expect(p.compact).toBe(true);expect(p.template).toBe('structured');
  saveReportingPreferences(7,{...p,status:'external_final',modality:'MR'});
  expect(loadReportingPreferences(7)).toMatchObject({status:'external_final',modality:'MR'});
});

it('shows compact explained badges and keeps the full archive and stable 50-row pagination available',async()=>{
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(api).mockResolvedValue({studies:[{orthanc_study_id:'synthetic',study_instance_uid:'1.2.3',patient_name_raw:'Synthetic Patient',patient_id:'SYN-1',accession_number:'A',study_description:'Synthetic CT',modalities_in_study:['CT'],study_date:'19900101',series_count:2,reporting_status:'no_report',external_reporting_status:'external_final',external_checked_at:'2026-10-30T00:00:00Z',report_count:0,reports:[],assigned_doctor:null}],total:101,limit:50,offset:0,freshness:{status:'ready',lastSuccessAt:null,error:null},modalities:['CT']});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/doctor/reporting']}><ReportingWorkspacePage/></MemoryRouter></QueryClientProvider>);
  await screen.findByText('No RISpro');expect(screen.getByText('Sonic: Final').getAttribute('title')).toContain('Last verified');
  expect(screen.getByRole('cell',{name:/1 Jan 1990/})).toBeTruthy();expect(screen.getByText('1–50 of 101')).toBeTruthy();
  expect(screen.getByRole('link',{name:'Open Reports'})).toBeTruthy();expect(screen.getByRole('button',{name:'View Images'})).toBeTruthy();
  const url=String(vi.mocked(api).mock.calls.find(([p])=>p.includes('/studies?'))?.[0]);expect(url).not.toContain('from=');expect(url).not.toContain('to=');expect(url).toContain('status=all');
  fireEvent.click(screen.getByRole('button',{name:'Next'}));await vi.waitFor(()=>expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('offset=50'))).toBe(true));
  vi.restoreAllMocks();
});

it('labels an old explicit unknown-status bookmark as Not Checked instead of showing All Studies over a hidden filter',async()=>{
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(api).mockResolvedValue({studies:[],total:0,limit:50,offset:0,freshness:{status:'ready',lastSuccessAt:null,error:null},modalities:['CT']});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/doctor/reporting?status=unknown']}><ReportingWorkspacePage/></MemoryRouter></QueryClientProvider>);
  await screen.findByText('No studies match these filters.');
  expect((screen.getByLabelText('Reporting status') as HTMLSelectElement).value).toBe('not_checked');
  expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('status=not_checked'))).toBe(true);
  vi.restoreAllMocks();
});
