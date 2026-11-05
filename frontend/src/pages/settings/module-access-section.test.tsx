import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModuleAccess } from '@/types/api';
import { ModuleAccessSection } from './module-access-section';

vi.mock('@/providers/language-provider',()=>({useLanguage:()=>({language:'en'})}));
afterEach(cleanup);

it('does not display a future module as granted or offer its landing page to a legacy account',()=>{
  const module={id:'laboratory',nameEn:'Laboratory',nameAr:'Laboratory',landingPath:'/laboratory',frontendPrefixes:['/laboratory'],available:true,dictation:false,eligible:true,granted:false,effective:false,permissions:[]};
  const access:ModuleAccess={mode:'legacy',grants:[],defaultModule:null,landingConfigured:false,landingPath:null,modules:[module]};
  render(<QueryClientProvider client={new QueryClient()}><ModuleAccessSection userId={7} access={access} disabled={false} onSaved={async()=>{}}/></QueryClientProvider>);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('combobox',{name:'Default landing module'}).querySelector('option[value="laboratory"]')).toBeNull();
});
