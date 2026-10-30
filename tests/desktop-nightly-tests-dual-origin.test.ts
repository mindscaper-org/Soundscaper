/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsDualOriginPlan,
	runDesktopNightlyTestsDualOriginPhase,
} from '../scripts/lib/desktop-nightly-tests-dual-origin.mjs';
import { runDesktopNightlyTests } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import type { DesktopNightlyTestsPlaywrightPlan } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';
import { nightlyProductSitesFixture } from './helpers/nightly-tests-product-sites.ts';

const SOUNDSCAPER_ORIGIN = 'http://127.0.0.1:4332';
const FRAMESCAPER_ORIGIN = 'http://127.0.0.1:4333';

test('dual-origin coverage plan shares the browser profile directory and isolates reports', () => {
	const payloadRoot = '/opt/Soundscaper Tests/resources/nightly-tests';
	const runRoot = '/tmp/Soundscaper-playwright-run';
	const plan = createDesktopNightlyTestsDualOriginPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot,
		runRoot,
		esbuildBinaryPath: '/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@esbuild/linux-x64/bin/esbuild',
		origins: { soundscaper: SOUNDSCAPER_ORIGIN, framescaper: FRAMESCAPER_ORIGIN },
		environment: { PATH: '/usr/bin' },
	});

	assert.match(plan.args.at(-1) ?? '', /playwright\.nightly-dual-origin\.config\.mjs$/u);
	assert.equal(plan.logFile, '/tmp/Soundscaper-playwright-run/e2e-coverage/dual-origin/console.log');
	assert.equal(plan.env.SCAPE_BROWSER_COVERAGE, '1');
	assert.equal(plan.env.SCAPE_BROWSER_COVERAGE_DIRECTORY,
		'/tmp/Soundscaper-playwright-run/coverage/v8-browser');
	assert.deepEqual(JSON.parse(plan.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? ''), {
		soundscaper: SOUNDSCAPER_ORIGIN,
		framescaper: FRAMESCAPER_ORIGIN,
	});
	assert.deepEqual(JSON.parse(plan.env.SCAPE_BROWSER_COVERAGE_SITES ?? ''), [
		{
			productId: 'soundscaper',
			origin: SOUNDSCAPER_ORIGIN,
			outputDirectory: join(payloadRoot, 'sites/soundscaper'),
		},
		{
			productId: 'framescaper',
			origin: FRAMESCAPER_ORIGIN,
			outputDirectory: join(payloadRoot, 'sites/framescaper'),
		},
	]);
});

test('dual-origin coverage reuses an already bound authenticated product pair', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'nightly-dual-origin-reuse-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const payloadRoot = join(temporaryRoot, 'payload');
	for (const [productId, origin] of [
		['soundscaper', SOUNDSCAPER_ORIGIN],
		['framescaper', FRAMESCAPER_ORIGIN],
	] as const) {
		const manifest = join(payloadRoot, 'sites', productId, '.browser-product-build.json');
		await mkdir(dirname(manifest), { recursive: true });
		await writeFile(manifest, `${JSON.stringify({ schemaVersion: 2, productId, origin })}\n`);
	}
	let starts = 0;
	let planSeen: DesktopNightlyTestsPlaywrightPlan | undefined;
	const result = await runDesktopNightlyTestsDualOriginPhase({
		executablePath: '/opt/soundscaper-tests', payloadRoot,
		runRoot: join(temporaryRoot, 'run'), environment: {},
		activeProductOrigins: {
			soundscaper: SOUNDSCAPER_ORIGIN,
			framescaper: FRAMESCAPER_ORIGIN,
		},
	}, {
		startPagesSiteServer: async () => {
			starts += 1;
			throw new Error('already-bound sites must be reused');
		},
		runPlaywright: async (plan) => {
			planSeen = plan;
			return { code: 0, signal: null };
		},
	});

	assert.equal(starts, 0);
	assert.ok(planSeen);
	assert.deepEqual(result.diagnostics, { passed: true });
});

test('dual-origin coverage refuses an active origin that disagrees with build evidence', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'nightly-dual-origin-active-stale-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const payloadRoot = join(temporaryRoot, 'payload');
	for (const [productId, origin] of [
		['soundscaper', SOUNDSCAPER_ORIGIN],
		['framescaper', FRAMESCAPER_ORIGIN],
	] as const) {
		const manifest = join(payloadRoot, 'sites', productId, '.browser-product-build.json');
		await mkdir(dirname(manifest), { recursive: true });
		await writeFile(manifest, `${JSON.stringify({ schemaVersion: 2, productId, origin })}\n`);
	}
	await assert.rejects(() => runDesktopNightlyTestsDualOriginPhase({
		executablePath: '/opt/soundscaper-tests', payloadRoot,
		runRoot: join(temporaryRoot, 'run'), environment: {},
		activeProductOrigins: {
			soundscaper: 'http://127.0.0.1:49998',
			framescaper: FRAMESCAPER_ORIGIN,
		},
	}, {
		runPlaywright: async () => ({ code: 0, signal: null }),
	}), /active product origins disagree with authenticated build evidence/u);
});

test('dual-origin coverage refuses stale product identity before opening a server', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'nightly-dual-origin-stale-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const payloadRoot = join(temporaryRoot, 'payload');
	for (const productId of ['soundscaper', 'framescaper']) {
		const manifest = join(payloadRoot, 'sites', productId, '.browser-product-build.json');
		await mkdir(dirname(manifest), { recursive: true });
		await writeFile(manifest, `${JSON.stringify({
			schemaVersion: 2,
			productId: productId === 'soundscaper' ? 'framescaper' : productId,
			origin: productId === 'soundscaper' ? SOUNDSCAPER_ORIGIN : FRAMESCAPER_ORIGIN,
		})}\n`);
	}
	let starts = 0;
	await assert.rejects(() => runDesktopNightlyTestsDualOriginPhase({
		executablePath: '/opt/soundscaper-tests', payloadRoot,
		runRoot: join(temporaryRoot, 'run'), environment: {},
	}, {
		startPagesSiteServer: async () => {
			starts += 1;
			return { baseURL: SOUNDSCAPER_ORIGIN, close: async () => undefined };
		},
		runPlaywright: async () => ({ code: 0, signal: null }),
	}), /soundscaper.*build evidence/iu);
	assert.equal(starts, 0);
});

test('the nightly runtime runs only GPU, performance, packaged desktop, and real-model phases', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-runner-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	const plans: DesktopNightlyTestsPlaywrightPlan[] = [];
	let closeCalls = 0;
	const completed = await runDesktopNightlyTests({
		executablePath: '/opt/soundscaper-tests',
		payloadRoot: '/opt/resources/nightly-tests',
		outputRoot,
		product: { id: 'soundscaper', name: 'Soundscaper', version: '1.0.0-rc.1' },
		platform: 'linux',
		arch: 'x64',
		environment: { PATH: '/usr/bin' },
		sourceRevision: 'b'.repeat(40),
	}, {
		startProductSites: nightlyProductSitesFixture(47777, () => { closeCalls += 1; }),
		runPlaywright: async (plan) => {
			plans.push(plan);
			return { code: plans.length === 1 ? 1 : 0, signal: null };
		},
		writeMetricsDiagnostics: async () => ({ passed: true }),
		writePackagedMetricsDiagnostics: async () => ({ passed: true }),
		preserveCoverageEvidence: async () => '/tmp/coverage-evidence',
	});

	assert.equal(completed.exitCode, 1);
	assert.equal(closeCalls, 1);
	assert.equal(plans.length, 5);
	assert.match(plans[0]?.args.at(-1) ?? '', /playwright\.nightly-tests\.config\.mjs$/u);
	assert.match(plans[1]?.args.at(-1) ?? '', /playwright\.nightly-metrics\.config\.mjs$/u);
	assert.match(plans[2]?.args.at(-1) ?? '', /playwright\.nightly-packaged-metrics\.config\.mjs$/u);
	assert.match(plans[3]?.args.at(-1) ?? '', /playwright\.nightly-packaged-coverage\.config\.mjs$/u);
	assert.match(plans[4]?.args.at(-1) ?? '', /playwright\.nightly-local-assistance\.config\.mjs$/u);
	assert.equal(
		JSON.parse(await readFile(join(completed.runRoot, 'run.json'), 'utf8')).status,
		'failed',
	);
});
