/** Module admission only. Every module retains its own action and record authorization. */
export interface ModuleDefinition {
  id: string;
  nameEn: string;
  nameAr: string;
  landingPath: string;
  frontendPrefixes: readonly string[];
  apiPrefixes: readonly string[];
  available: boolean;
  dictation: boolean;
  capability: 'core' | 'doctor' | 'gamma-knife' | 'teaching' | 'explicit';
  legacyAccess: boolean;
  workstationPath?: string;
}

export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  { id: 'core', nameEn: 'RISpro Core', nameAr: 'نظام RISpro الأساسي', landingPath: '/dashboard', frontendPrefixes: ['/', '/reporting/native', '/reporting/fast-preview', '/reporting/worklist'], workstationPath: '/workstation/printing',
    apiPrefixes: ['/patients', '/queue', '/documents', '/incidents', '/sops', '/scan-sessions', '/integrations', '/scanner-bootstrap', '/admin', '/backup-control', '/request-scans', '/modality', '/audit', '/printing', '/comparisons', '/ir-referrals', '/settings', '/user-notifications', '/name-dictionary', '/dicom', '/pacs', '/legacy-access-viewer', '/v2', '/users', '/medgemma'], available: true, dictation: true, capability: 'core', legacyAccess: true },
  { id: 'doctor', nameEn: 'Doctor Workspace', nameAr: 'مساحة عمل الطبيب', landingPath: '/doctor/my-work', frontendPrefixes: ['/doctor', '/reporting/native', '/reporting/fast-preview', '/reporting/worklist'], workstationPath: '/doctor/workstation-printing', apiPrefixes: ['/doctor', '/native-reporting', '/ohif'], available: true, dictation: true, capability: 'doctor', legacyAccess: true },
  { id: 'gamma-knife', nameEn: 'Gamma Knife', nameAr: 'قاما نايف', landingPath: '/gamma-knife', frontendPrefixes: ['/gamma-knife'], workstationPath: '/gamma-knife/workstation-printing', apiPrefixes: ['/gamma-knife'], available: true, dictation: true, capability: 'gamma-knife', legacyAccess: true },
  { id: 'teaching', nameEn: 'Teaching', nameAr: 'التعليم', landingPath: '/teaching/dashboard', frontendPrefixes: ['/teaching'], apiPrefixes: ['/teaching'], available: true, dictation: false, capability: 'teaching', legacyAccess: true },
];

export function pathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}
