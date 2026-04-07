/**
 * Simple in-memory cache with TTL for expensive database lookups.
 * Uses module-level singleton pattern - cache is shared across all imports.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cacheStore = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds

export function getCached<T>(key: string): T | null {
  const entry = cacheStore.get(key);
  
  if (!entry) {
    return null;
  }
  
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

export function invalidateCache(key: string): void {
  cacheStore.delete(key);
}

export function invalidateAllCache(): void {
  cacheStore.clear();
}
