// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

import {
	ordinaryBrowserProductSitePlan,
	vitePreviewServer,
} from './scripts/lib/browser-product-test-sites.mjs';

const sitePlan = ordinaryBrowserProductSitePlan();
const baseURL = sitePlan.sites[0].origin;
const modulePlan = process.env.SCAPE_MODULE_PLAN
	? (await import('./scripts/lib/check-module-repository.ts')).readModuleExecutionPlan(import.meta.dirname, process.env.SCAPE_MODULE_PLAN)
	: null;
const browserCoverage = process.env.SCAPE_BROWSER_COVERAGE === '1';
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify(Object.fromEntries(sitePlan.sites.map(site => [site.productId, site.origin])));

export default defineConfig({
	testDir: './tests/browser',
	testIgnore: ['handbook/**', 'dual-origin/**', 'audiocity/**'],
	...(modulePlan?.mode === 'focused' ? { testMatch: modulePlan.browserTests.map(file => resolve(import.meta.dirname, file).replaceAll('\\', '/')) } : {}),
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: false,
	retries: process.env.CI ? 1 : 0,
	// Media-heavy workflows spawn native decoder/capture processes. Letting
	// Playwright scale to half of a high-core workstation can starve those
	// processes until otherwise healthy workflows hit their bounds. Native-media
	// project limits below also apply to local runs and check-all's shared shards.
	workers: process.env.CI ? 2 : 4,
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
		: 'list',
	outputDir: 'test-results',
	webServer: sitePlan.sites.map(site => vitePreviewServer(site)),
	use: {
		baseURL,
		serviceWorkers: 'block',
		storageState: { cookies: [], origins: [] },
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
			// Counted block coverage slows render and persistence work substantially.
			// Explicit realtime assertions and per-test budgets retain their bounds.
			...(browserCoverage ? { timeout: 90_000, expect: { timeout: 15_000 } } : {}),
		},
		{ name: 'firefox', workers: 1, use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
		{ name: 'webkit', workers: 1, use: { ...devices['Desktop Safari'], browserName: 'webkit', deviceScaleFactor: 1 } },
	],
});
