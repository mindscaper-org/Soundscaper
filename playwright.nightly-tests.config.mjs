/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import {
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
} from './src/common/editor/ui/first-launch-setup.ts';

function requireAbsolutePath(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) {
		throw new Error(`${key} must be an absolute path supplied by the nightly test launcher.`);
	}
	return value;
}

function requireLoopbackURL(environment) {
	const value = environment.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL;
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be a valid loopback URL.');
	}
	if (
		url.protocol !== 'http:'
		|| url.hostname !== '127.0.0.1'
		|| url.username !== ''
		|| url.password !== ''
		|| url.pathname !== '/'
		|| url.search !== ''
		|| url.hash !== ''
	) {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be an HTTP loopback URL.');
	}
	return url.href.replace(/\/$/u, '');
}

export function createNightlyTestsConfig(environment = process.env) {
	const payloadRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const baseURL = requireLoopbackURL(environment);

	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/browser'),
		// Cross-browser functional and dual-origin coverage belongs to ordinary CI.
		testMatch: ['audio-editor-waveform-gpu.spec.js', 'framescaper-visual-preview.spec.js'],
		grepInvert: /Canvas fallback does not|unavailable GPU keeps|Framescaper v1 visual state without WebGL2/u,
		metadata: { requireHardwareGpu: true },
		timeout: 30000,
		expect: { timeout: 5000 },
		fullyParallel: true,
		forbidOnly: true,
		failOnFlakyTests: false,
		retries: 1,
		workers: 4,
		updateSnapshots: 'none',
		reporter: [
			['list'],
			[resolve(payloadRoot, 'scripts/lib/desktop-nightly-tests-progress-reporter.mjs')],
			['html', { outputFolder: resolve(runRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(runRoot, 'results.json') }],
			['junit', { outputFile: resolve(runRoot, 'junit.xml') }],
		],
		outputDir: resolve(runRoot, 'test-results'),
		use: {
			baseURL,
			serviceWorkers: 'block',
			trace: 'on-first-retry',
			screenshot: 'only-on-failure',
			// Every fresh context counts as a first launch; seed the finished-setup
			// flag so the workspace chooser never sits in front of a nightly spec.
			storageState: {
				cookies: [],
				origins: [{
					origin: new URL(baseURL).origin,
					localStorage: [{ name: firstLaunchSetupStorageKey('soundscaper'), value: firstLaunchSetupSeedValue() }],
				}],
			},
		},
		projects: [{
			name: 'chromium',
			...(environment.SCAPE_BROWSER_COVERAGE === '1' ? { timeout: 90_000, expect: { timeout: 15_000 } } : {}),
			use: {
				...devices['Desktop Chrome'],
				browserName: 'chromium',
				channel: 'chromium',
				headless: true,
				launchOptions: { args: ['--enable-gpu'] },
			},
		}],
	});
}

export default createNightlyTestsConfig();
