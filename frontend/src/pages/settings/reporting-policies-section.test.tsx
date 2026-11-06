import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReportingPolicy } from '@/lib/reporting-workspace-api';
import ReportingPoliciesSection from './reporting-policies-section';

const basePolicy:ReportingPolicy={
  enabled:false,version:1,creation:'accessible',collaboration:'both',review:'optional',mandatoryReviewRoles:['resident','senior_house_officer'],
  reviewerDoctorRoles:['consultant','specialist'],reviewEligibility:'open',signing:'permission',additional:'typed',allowedTypes:['primary'],deletion:'creator',restoreRevisions:true,
};
let savedPolicy:ReportingPolicy;
function response(body:unknown,status=200) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}); }
function renderSection() {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><ReportingPoliciesSection onReAuthRequired={vi.fn()}/></QueryClientProvider>);
}

beforeEach(()=>{
  vi.restoreAllMocks();savedPolicy={...basePolicy,mandatoryReviewRoles:[...basePolicy.mandatoryReviewRoles],reviewerDoctorRoles:[...basePolicy.reviewerDoctorRoles]};
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{
    if(init?.method==='PUT') {
      savedPolicy=JSON.parse(String(init.body)) as ReportingPolicy;
      return response({policy:{...savedPolicy,version:savedPolicy.version+1}});
    }
    return response({policy:savedPolicy,presets:{open:savedPolicy},doctorRoleOptions:['consultant','specialist','senior_house_officer','resident'],reviewerRoleOptions:['consultant','specialist']});
  });
});

it('saves only the configured senior reviewer roles and prevents an empty eligibility list',async()=>{
  const user=userEvent.setup();renderSection();
  const reviewers=await screen.findByRole('group',{name:'Eligible senior reviewer roles'});
  const consultant=within(reviewers).getByLabelText('consultant') as HTMLInputElement;
  const specialist=within(reviewers).getByLabelText('specialist') as HTMLInputElement;
  expect(consultant.checked).toBe(true);expect(specialist.checked).toBe(true);
  await user.click(consultant);
  expect(consultant.checked).toBe(false);expect(specialist.checked).toBe(true);expect(specialist.disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Save Reporting Policies'}));
  await screen.findByText('Reporting policies saved.');
  expect(savedPolicy.reviewerDoctorRoles).toEqual(['specialist']);
  expect(savedPolicy.mandatoryReviewRoles).toEqual(['resident','senior_house_officer']);
});
