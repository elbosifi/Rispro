import base from '../../playwright.config';
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({ ...base, testDir: '.', testMatch: 'capture.spec.ts', reporter: 'list', webServer: (base.webServer as any[]).map(server => ({ ...server, cwd: resolve('.') })) });
