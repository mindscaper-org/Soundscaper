import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const port = Number(process.env.PLAYWRIGHT_DOCS_PORT ?? 4324);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: resolve(root, 'tests/browser/handbook'),
	testMatch: '*.spec.js',
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: resolve(root, 'playwright-report/docs'), open: 'never' }]]
		: 'list',
	outputDir: resolve(root, 'test-results/docs'),
	globalSetup: resolve(root, 'tests/browser/handbook/global-setup.mjs'),
	globalTeardown: resolve(root, 'tests/browser/handbook/global-teardown.mjs'),
	use: {
		baseURL,
		serviceWorkers: 'block',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
	],
});
