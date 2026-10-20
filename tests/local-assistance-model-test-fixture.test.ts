/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runDesktopNightlyTestsPlaywrightChild } from '../scripts/lib/desktop-nightly-tests-playwright-child.mjs';

test('a timed-out model operation still closes its host and attaches Electron diagnostics', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-model-timeout-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const playwrightURL = new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href;
	const fixtureURL = new URL('./electron/local-assistance-models/model-test-fixture.ts', import.meta.url).href;
	const cliPath = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
	await writeFile(join(root, 'playwright.config.mjs'), `export default {
	testDir: ${JSON.stringify(root)}, testMatch: '**/fixture.spec.mjs',
	workers: 1, retries: 0, timeout: 250,
	reporter: [['json', { outputFile: ${JSON.stringify(join(root, 'results.json'))} }]],
	outputDir: ${JSON.stringify(join(root, 'test-results'))},
};\n`);
	await writeFile(join(root, 'fixture.spec.mjs'), `import { test as base } from ${JSON.stringify(playwrightURL)};
import { createModelTestElectronFixture } from ${JSON.stringify(fixtureURL)};
const test = base.extend({
	launchModelHost: [createModelTestElectronFixture(async (testInfo) => ({
		close: async () => {
			await testInfo.attach('local-model-electron.log', { body: 'native operation did not settle', contentType: 'text/plain' });
		},
	})), { timeout: 1000 }],
});
test('native inference hangs', async ({ launchModelHost }) => {
	await launchModelHost();
	await new Promise(() => {});
});\n`);
	const child = await runDesktopNightlyTestsPlaywrightChild({
		command: process.execPath,
		args: [cliPath, 'test', '--config', join(root, 'playwright.config.mjs')],
		cwd: root, env: {}, logFile: join(root, 'console.log'),
	});
	assert.equal(child.code, 1);
	const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as {
		suites: Array<{ specs: Array<{ tests: Array<{ results: Array<{
			status: string; attachments: Array<{ name: string; body: string }>;
		}> }> }> }>;
	};
	const result = report.suites[0]?.specs[0]?.tests[0]?.results[0];
	assert.equal(result?.status, 'timedOut', await readFile(join(root, 'console.log'), 'utf8'));
	const log = result.attachments.find(({ name }) => name === 'local-model-electron.log');
	assert.ok(log, 'fixture teardown must preserve diagnostics even while inference is still pending');
	assert.equal(Buffer.from(log.body, 'base64').toString(), 'native operation did not settle');
});
