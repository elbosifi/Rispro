import type { User } from '@/types/api';

export function canAccessModule(user: User | null | undefined, moduleId: string): boolean {
  return Boolean(user?.moduleAccess?.modules.some(m => m.id === moduleId && m.effective));
}

export function canAccessPath(user: User, path: string): boolean {
  const matches = user.moduleAccess?.modules.filter(m => m.frontendPrefixes.some(prefix => prefix !== '/' && (path === prefix || path.startsWith(prefix + '/')))) ?? [];
  return matches.length ? matches.some(m => m.effective) : canAccessModule(user, 'core');
}

export function workstationPath(user: User, currentPath: string): string | undefined {
  const modules = user.moduleAccess?.modules.filter(m => m.effective && m.workstationPath) ?? [];
  return (modules.find(m => m.id !== 'core' && m.frontendPrefixes.some(prefix => currentPath.startsWith(prefix))) ?? modules.find(m => m.id === 'core') ?? modules[0])?.workstationPath;
}

export function moduleLanding(user: User): string | null {
  return user.moduleAccess?.landingPath ?? null;
}
