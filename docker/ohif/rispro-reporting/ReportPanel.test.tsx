import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ReportPanel from './src/ReportPanel';
vi.mock('./src/dictation-adapter',()=>({default:()=>null}));
afterEach(cleanup);
const report={id:1,status:'draft',canEdit:true,canFinalize:true,author:'Test doctor',keyImages:[]};
function mount(extra={}){
  const state={context:{v2:true,contextId:'c',primaryStudyUid:'1.2.3',identity:{patientName:'Synthetic patient',patientIdentifier:'SYN-1',birthDate:'19801102',sex:'F',studyDate:'20261101',examination:'Full verified RIS examination description',accession:'V2-123'},reports:[report]},report,text:{},captionEdits:{},...extra};
  render(<ReportPanel store={{getSnapshot:()=>state,subscribe:()=>()=>{},setError:vi.fn()}}/>);
}
it('renders complete compact verified demographics, exam-time age and in-review status',()=>{
  mount({report:{...report,status:'in_review'}});
  for(const text of ['Synthetic patient','ID: SYN-1','Age at exam: 45 y','Sex: F','Full verified RIS examination description','Study: 20261101','Accession: V2-123','In review'])expect(screen.getByText(text)).toBeTruthy();
});
it('enables Finalize for an eligible signer using current selected report eligibility',()=>{
  mount();expect((screen.getByRole('button',{name:'Finalize'}) as HTMLButtonElement).disabled).toBe(false);
});
it('shows the actual backend signing denial together with pending local blockers',()=>{
  mount({report:{...report,canFinalize:false,finalizeReasons:['Only the designated reviewer can sign.']},pendingCapture:{},conflict:true});
  const button=screen.getByRole('button',{name:'Finalize'}) as HTMLButtonElement;expect(button.disabled).toBe(true);
  const reason=document.getElementById(button.getAttribute('aria-describedby')!);expect(reason.textContent).toMatch(/designated reviewer/);expect(reason.textContent).toMatch(/pending key-image/);expect(reason.textContent).toMatch(/conflict/);
});
