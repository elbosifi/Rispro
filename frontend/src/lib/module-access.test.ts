import { describe, expect, it } from 'vitest';
import type { ModuleAccess, User } from '@/types/api';
import { canAccessPath, workstationPath } from './module-access';

function user(grants: string[]): User {
  const modules: ModuleAccess['modules'] = [
    {id:'core',nameEn:'Core',nameAr:'Core',landingPath:'/dashboard',frontendPrefixes:['/','/reporting/native'],workstationPath:'/workstation/printing',available:true,dictation:true,eligible:true,granted:false,effective:false,permissions:[]},
    {id:'doctor',nameEn:'Doctor',nameAr:'Doctor',landingPath:'/doctor/my-work',frontendPrefixes:['/doctor','/reporting/native'],workstationPath:'/doctor/workstation-printing',available:true,dictation:true,eligible:true,granted:false,effective:false,permissions:[]},
    {id:'gamma-knife',nameEn:'Gamma',nameAr:'Gamma',landingPath:'/gamma-knife',frontendPrefixes:['/gamma-knife'],workstationPath:'/gamma-knife/workstation-printing',available:true,dictation:true,eligible:true,granted:false,effective:false,permissions:[]},
    {id:'laboratory',nameEn:'Lab',nameAr:'Lab',landingPath:'/laboratory',frontendPrefixes:['/laboratory'],available:false,dictation:false,eligible:false,granted:false,effective:false,permissions:[]},
  ];
  return {id:1,username:'synthetic',fullName:'Synthetic',role:'doctor',moduleAccess:{mode:'restricted',grants,defaultModule:grants[0],landingConfigured:true,landingPath:null,modules:modules.map(m=>({...m,granted:grants.includes(m.id),effective:m.eligible && grants.includes(m.id)}))}};
}
describe('frontend admission from the server module policy',()=>{
  it('retains existing shared report routes for Core and Doctor without admitting Gamma-only users',()=>{
    expect(canAccessPath(user(['core']),'/reporting/native/42')).toBe(true);
    expect(canAccessPath(user(['doctor']),'/reporting/native/42')).toBe(true);
    expect(canAccessPath(user(['gamma-knife']),'/reporting/native/42')).toBe(false);
    expect(canAccessPath(user(['doctor']),'/settings')).toBe(false);
    expect(canAccessPath(user(['core']),'/doctor/my-work')).toBe(false);
  });
  it('denies unavailable future modules and derives workstation destinations from authorized modules',()=>{
    expect(canAccessPath(user(['core','laboratory']),'/laboratory')).toBe(false);
    expect(workstationPath(user(['doctor']),'/doctor/my-work')).toBe('/doctor/workstation-printing');
    expect(workstationPath(user(['gamma-knife']),'/workstation/printing')).toBe('/gamma-knife/workstation-printing');
    expect(workstationPath(user([]),'/workstation/printing')).toBeUndefined();
  });
});
