/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { DUAL_ORIGIN_BROWSER_SITES } from '../scripts/build-dual-origin-browser-sites.mjs';
import { extractJob } from './helpers/workflow-jobs.js';

const ROOT = resolve(import.meta.dirname, '..');

// Site-verifying workflows build the site once and verify it with browser jobs.
// Quality's browser jobs start as soon as the build is available; its final
// coverage gate still waits for the other static checks. Each workflow names
// the build publisher, browser prerequisite, and browser shard count here.
const SITE_WORKFLOWS = new Map([
	['quality.yml', {
		staticJobs: ['build', 'lint', 'typecheck', 'audits'],
		buildJob: 'build',
		gate: 'needs: build',
		browserShardCount: 3,
		firefoxShardCount: 4,
	}],
]);

test('Playwright allows CI to pass when a retry succeeds', async () => {
	process.env.CI = 'true';
	const { default: config } = await import('../playwright.config.mjs?ci-flaky-policy');

	assert.equal(config.retries, 1);
	assert.equal(config.failOnFlakyTests, false);
});

test('only instrumented Chromium receives extra render and persistence time', async () => {
	const previous = process.env.SCAPE_BROWSER_COVERAGE;
	try {
		delete process.env.SCAPE_BROWSER_COVERAGE;
		const { default: ordinary } = await import('../playwright.config.mjs?ordinary-budgets');
		assert.equal(ordinary.timeout, 30_000);
		assert.equal(ordinary.expect.timeout, 5_000);
		assert.equal(ordinary.projects[0].timeout, undefined);
		process.env.SCAPE_BROWSER_COVERAGE = '1';
		const { default: measured } = await import('../playwright.config.mjs?coverage-budgets');
		assert.equal(measured.projects[0].timeout, 90_000);
		assert.equal(measured.projects[0].expect.timeout, 15_000);
		for (const project of measured.projects.slice(1)) {
			assert.equal(project.timeout, undefined);
			assert.equal(project.expect, undefined);
		}
	} finally {
		if (previous === undefined) delete process.env.SCAPE_BROWSER_COVERAGE;
		else process.env.SCAPE_BROWSER_COVERAGE = previous;
	}
});

test('Playwright runs the maintained evergreen browser-engine matrix', async () => {
	delete process.env.CI;
	const { default: config } = await import('../playwright.config.mjs?browser-matrix');

	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium', 'firefox', 'webkit']);
	for (const project of config.projects) {
		assert.ok(project.use.browserName, `${project.name} must select an engine explicitly`);
		assert.equal(project.use.viewport.width, 1280);
		assert.equal(project.use.viewport.height, 720);
	}
	const firefox = config.projects.find(({ name }) => name === 'firefox');
	assert.equal(firefox.use.launchOptions?.firefoxUserPrefs, undefined);
	const webkit = config.projects.find(({ name }) => name === 'webkit');
	assert.equal(webkit.use.deviceScaleFactor, 1, 'WebKit CI must avoid Retina-scale canvas rasterization');
	for (const project of config.projects) {
		assert.equal(project.use.launchOptions?.firefoxUserPrefs, undefined);
	}
	assert.equal(config.use.serviceWorkers, 'block', 'ordinary browser tests must not install the offline shell');
	assert.ok(config.testIgnore.includes('dual-origin/**'),
		'the ordinary suite must not accidentally run the separately served dual-origin workflow');
});

test('ordinary Playwright previews separately built product origins', async () => {
	delete process.env.CI;
	process.env.PLAYWRIGHT_PORT = '4372';
	process.env.PLAYWRIGHT_FRAMESCAPER_PORT = '4379';
	process.env.PLAYWRIGHT_LIGHTSCAPER_PORT = '4380';
	try {
		const [{ default: config }, packageText] = await Promise.all([
			import('../playwright.config.mjs?product-sites'),
			readFile(new URL('../package.json', import.meta.url), 'utf8'),
		]);
		const scripts = JSON.parse(packageText).scripts;

		assert.equal(config.use.baseURL, 'http://127.0.0.1:4372');
		assert.equal(config.use.ignoreHTTPSErrors, undefined);
		assert.ok(Array.isArray(config.webServer));
		assert.equal(config.webServer.length, 3);
		for (const [server, product, port] of [
			[config.webServer[0], 'soundscaper', '4372'],
			[config.webServer[1], 'framescaper', '4379'],
			[config.webServer[2], 'lightscaper', '4380'],
		]) {
			assert.equal(server.url, `http://127.0.0.1:${port}/en/`);
			assert.match(server.command, /^node node_modules\/vite\/bin\/vite\.js preview /u);
			assert.ok(server.command.includes(`.wrangler/browser-products/${product}`));
			assert.ok(server.command.includes(`--port ${port}`));
			assert.ok(server.command.includes('--host 127.0.0.1'));
			assert.ok(server.command.includes('--strictPort'));
			assert.equal(server.ignoreHTTPSErrors, undefined);
			assert.equal(server.reuseExistingServer, false);
		}

		assert.equal(scripts['build:browser:framescaper'],
			'node scripts/build-browser-product-site.mjs framescaper');
		assert.equal(scripts['build:browser:lightscaper'],
			'node scripts/build-browser-product-site.mjs lightscaper');
		assert.equal(scripts['prepare:browser:products'],
			'node scripts/prepare-browser-product-sites.mjs');
		assert.equal(scripts['pretest:browser'],
			'npm run build && npm run build:browser:framescaper && npm run build:browser:lightscaper && npm run prepare:browser:products');
		assert.equal(scripts['pretest:browser:built'], 'npm run prepare:browser:products');
	} finally {
		delete process.env.PLAYWRIGHT_PORT;
		delete process.env.PLAYWRIGHT_FRAMESCAPER_PORT;
		delete process.env.PLAYWRIGHT_LIGHTSCAPER_PORT;
	}
});

test('the dual-origin Playwright harness serves two reciprocal built Pages sites', async () => {
	delete process.env.CI;
	delete process.env.PLAYWRIGHT_DUAL_ORIGIN_OUTPUT_DIR;
	const [{ default: config }, packageText] = await Promise.all([
		import('../playwright.dual-origin.config.mjs?dual-origin-sites'),
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
	]);
	const packageDocument = JSON.parse(packageText);
	const scripts = packageDocument.scripts;

	assert.equal(config.testDir, './tests/browser/dual-origin');
	assert.equal(config.fullyParallel, false);
	assert.equal(config.workers, 1);
	assert.equal(config.retries, 0);
	assert.equal(config.use.baseURL, 'http://127.0.0.1:4332');
	assert.equal(config.use.serviceWorkers, 'block');
	assert.deepEqual(JSON.parse(process.env.SCAPE_BROWSER_COVERAGE_SITES), [
		{
			productId: 'soundscaper',
			origin: 'http://127.0.0.1:4332',
			outputDirectory: resolve(ROOT, '.wrangler/dual-origin-browser/soundscaper'),
		},
		{
			productId: 'framescaper',
			origin: 'http://127.0.0.1:4333',
			outputDirectory: resolve(ROOT, '.wrangler/dual-origin-browser/framescaper'),
		},
	]);
	assert.deepEqual(config.projects.map(({ name }) => name), ['chromium']);
	assert.equal(config.outputDir, 'test-results/dual-origin');
	assert.ok(Array.isArray(config.webServer));
	assert.equal(config.webServer.length, 2);

	const [soundscaper, framescaper] = config.webServer;
	assert.equal(soundscaper.url, 'http://127.0.0.1:4332/transfer/send/');
	assert.equal(framescaper.url, 'http://127.0.0.1:4333/transfer/receive/');
	for (const [server, product, port] of [
		[soundscaper, 'soundscaper', '4332'],
		[framescaper, 'framescaper', '4333'],
	]) {
		// Plain Node serving with the site's control files applied; wrangler's dev
		// server used to sit here and intermittently 500'd an already-served chunk.
		assert.match(server.command, /^node scripts\/serve-pages-site\.mjs /u);
		assert.ok(server.command.includes(`.wrangler/dual-origin-browser/${product}`));
		assert.ok(server.command.includes('--host 127.0.0.1'));
		assert.ok(server.command.includes(`--port ${port}`));
		assert.equal(server.reuseExistingServer, false);
	}

	assert.equal(scripts['pretest:browser:dual-origin'], 'node scripts/build-dual-origin-browser-sites.mjs');
	assert.equal(scripts['test:browser:dual-origin'],
		'playwright test --config playwright.dual-origin.config.mjs');
	assert.deepEqual(DUAL_ORIGIN_BROWSER_SITES, [
		{
			productId: 'soundscaper', origin: 'http://127.0.0.1:4332',
			peerOrigin: 'http://127.0.0.1:4333', outputDirectory: '.wrangler/dual-origin-browser/soundscaper',
		},
		{
			productId: 'framescaper', origin: 'http://127.0.0.1:4333',
			peerOrigin: 'http://127.0.0.1:4332', outputDirectory: '.wrangler/dual-origin-browser/framescaper',
		},
	]);
});

test('each site-verifying workflow runs the dual-origin proof exactly once', async () => {
	for (const workflowName of SITE_WORKFLOWS.keys()) {
		const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
		const browserJob = extractJob(workflow, 'browser');
		assert.equal(
			workflow.match(/npm run test:browser:dual-origin/gu)?.length,
			1,
			`${workflowName} must invoke the dual-origin proof once`,
		);
		assert.match(browserJob,
			/if: matrix\.project == 'chromium' && matrix\.shard == 1\n\s+run: npm run test:browser:dual-origin/u);
	}
});

test('each site-verifying workflow publishes and consumes a verified Framescaper browser build', async () => {
	for (const [workflowName, { buildJob }] of SITE_WORKFLOWS) {
		const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
		const publisher = extractJob(workflow, buildJob);
		const browserJob = extractJob(workflow, 'browser');
		const firefoxJob = extractJob(workflow, 'firefox');
		const buildIndex = publisher.indexOf('run: npm run build:browser:framescaper');
		const uploadIndex = publisher.indexOf('name: verified-framescaper-site-build');
		assert.ok(buildIndex >= 0, `${workflowName} must build the Framescaper site once in ${buildJob}`);
		assert.ok(uploadIndex > buildIndex,
			`${workflowName} must upload Framescaper only after its build verifies successfully`);
		assert.match(publisher,
			/name: verified-framescaper-site-build\n\s+path: \.wrangler\/browser-products\/framescaper\/\n\s+include-hidden-files: true/u);
		for (const [job, label] of [[browserJob, 'browser'], [firefoxJob, 'firefox']]) {
			assert.match(job,
				/name: verified-framescaper-site-build\n\s+path: \.wrangler\/browser-products\/framescaper/u,
				`${workflowName} ${label} must download the verified Framescaper build`);
		}
	}
});

test('desktop verification gates Electron packaging on static checks and Node tests', async () => {
	const workflow = await readFile(new URL('../.github/workflows/desktop-preview.yml', import.meta.url), 'utf8');
	for (const jobName of ['package', 'soundscaper-project-library-lease-matrix']) {
		const needs = jobName === 'package'
			? /needs: \[quality, tests, publish-assistance-runtime-handoff, professional-native-build, milestone-5-native-audit-source\]/u
			: /needs: \[quality, tests, prepare-assistance-runtime-handoff\]/u;
		assert.match(extractJob(workflow, jobName), needs);
	}
	assert.doesNotMatch(workflow, /^ {2}project-library-handoff:/mu);
});

test('quality verification keeps Chromium and WebKit in the pinned container and gives Firefox real audio', async () => {
	const workflow = await readFile(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
	assertBrowserCoverage(workflow, 'quality', SITE_WORKFLOWS.get('quality.yml'));
	const browserJob = extractJob(workflow, 'browser');
	assert.doesNotMatch(browserJob, /^\s+exclude:/mu, 'both engines must run every container shard');
	assert.doesNotMatch(browserJob, /PWTEST_SHARD_WEIGHTS/u, 'retired four-shard weights cannot govern the container shards');
	const collectionStep = browserJob.match(
		/ {6}- name: Collect browser shard run shape\n(?<step>[\s\S]*?)(?=\n {6}- name:)/u,
	);
	assert.ok(collectionStep, 'the execution policy must use the actual collected shard');
	assert.match(collectionStep.groups.step,
		/--shard=\$\{\{ matrix\.shard \}\}\/3 --workers=\$\{\{ matrix\.project == 'webkit' && 1 \|\| 2 \}\} --retries=1 --list --reporter=json/u);
	assert.match(collectionStep.groups.step,
		/node scripts\/ci-browser-shard-policy\.ts [^\n]+ "\$\{\{ matrix\.shard \}\}\/3"/u,
		'the collection and policy must agree on the three-way partition');
	assert.doesNotMatch(extractJob(workflow, 'firefox'), /PWTEST_SHARD_WEIGHTS/u);
});

test('Firefox CI audio helpers configure a null sink/source and reject a stalled clock', async () => {
	const [pulseSetup, clockProbe] = await Promise.all([
		readFile(new URL('../scripts/ci-firefox-pulseaudio.sh', import.meta.url), 'utf8'),
		readFile(new URL('../scripts/ci-firefox-audio-clock.mjs', import.meta.url), 'utf8'),
	]);

	assert.match(pulseSetup, /module-null-sink/u);
	assert.match(pulseSetup, /set-default-sink/u);
	assert.match(pulseSetup, /set-default-source[^\n]+\.monitor/u);
	assert.match(pulseSetup, /GITHUB_ENV/u);
	assert.match(clockProbe, /firefox\.launch/u);
	assert.match(clockProbe, /new AudioContext/u);
	assert.match(clockProbe, /currentTime/u);
	assert.match(clockProbe, /withTimeout/u);
	assert.match(clockProbe, /did not advance/u);
});

function assertBrowserCoverage(workflow, label, { staticJobs, gate, browserShardCount, firefoxShardCount }) {
	const browserJob = extractJob(workflow, 'browser');
	const firefoxJob = extractJob(workflow, 'firefox');

	for (const jobName of staticJobs) {
		assert.doesNotMatch(extractJob(workflow, jobName), /test:browser|playwright install/u,
			`${label} ${jobName} must not share a browser budget`);
	}
	assert.ok(browserJob.includes('name: Browser / ${{ matrix.project }}'));
	assert.ok(browserJob.includes(gate), `${label} browser must wait for the verified build`);
	assert.match(browserJob, /matrix:\n\s+project: \[chromium, webkit\]/u);
	assert.match(browserJob, /container:\n\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e\n\s+options: --user 1001/u);
	assert.match(browserJob, /npm install --global --prefix "\$HOME\/\.local" npm@12\.0\.1/u);
	assert.match(browserJob, /name: verified-soundscaper-browser-site-build/u);
	assertEngineIsSharded(browserJob, `${label} browser`, 'npm run test:browser:built -- --project=${{ matrix.project }}', browserShardCount);
	assert.match(browserJob, /--workers=\$\{\{ steps\.browser-run-shape\.outputs\.workers \}\} --retries=\$\{\{ steps\.browser-run-shape\.outputs\.retries \}\}/u,
		`${label} must execute the collected shard's worker and retry policy`);

	// The handbook suite has its own Playwright config, so `--shard` cannot
	// divide it alongside the site suite. It has to be pinned to one leg of the
	// matrix or the shards would each run the whole of it.
	const handbookLegs = [...browserJob.matchAll(
		/^\s+if: (?<condition>matrix\.project == 'chromium'.*)\n\s+run: \|\n\s+node scripts\/ci-handbook-build\.mjs verify\n\s+npx playwright test --config playwright\.docs\.config\.mjs$/gmu,
	)];
	assert.equal(handbookLegs.length, 1, `${label} must run the handbook suite from exactly one job`);
	assert.match(handbookLegs[0].groups.condition, /matrix\.shard == 1/u, `${label} must not run the handbook suite once per shard`);

	assert.match(firefoxJob, /name: Browser \/ firefox/u);
	assert.ok(firefoxJob.includes(gate), `${label} firefox must wait for the verified build`);
	assert.match(firefoxJob, /runs-on: ubuntu-24\.04/u);
	assert.doesNotMatch(firefoxJob, /^\s+container:/mu);
	assert.match(firefoxJob, /uses: \.\/\.github\/actions\/verified-firefox/u);
	assert.match(firefoxJob, /name: Restore or install verified Playwright Firefox\n\s+timeout-minutes: 15\n\s+uses: \.\/\.github\/actions\/verified-firefox/u);
	assert.match(firefoxJob, /scripts\/ci-firefox-pulseaudio\.sh/u);
	assert.match(firefoxJob, /node scripts\/ci-firefox-audio-clock\.mjs/u);
	assert.match(firefoxJob, /name: verified-soundscaper-browser-site-build/u);
	assertEngineIsSharded(firefoxJob, `${label} firefox`, 'npm run test:browser:built -- --project=firefox', firefoxShardCount);
	assert.ok(firefoxJob.includes(`--shard=\${{ matrix.shard }}/${firefoxShardCount} --workers=1 --retries=1 --list --reporter=json`),
		`${label} must collect Firefox's actual complete shard`);
	assert.ok(firefoxJob.includes(`firefox "\${{ matrix.shard }}/${firefoxShardCount}" 1 >> "$GITHUB_OUTPUT"`),
		`${label} must bind Firefox's policy to the collected partition`);
	assert.ok(
		firefoxJob.includes(`--shard=\${{ matrix.shard }}/${firefoxShardCount} --workers=\${{ steps.browser-run-shape.outputs.workers }} --retries=\${{ steps.browser-run-shape.outputs.retries }}`),
		`${label} must execute Firefox's collected worker and retry policy`,
	);
	assert.ok(
		firefoxJob.indexOf('ci-firefox-audio-clock.mjs')
			< firefoxJob.indexOf('test:browser:built -- --project=firefox'),
		`${label} must probe the real audio clock before Firefox verification`,
	);
}

/**
 * Playwright is the pipeline's long pole, so every engine is split across
 * runners with `--shard`. Three things have to agree for that gate to be meaningful:
 * same tests the unsharded job did, and each is silent when it does not: the
 * `/N` denominator has to equal the number of matrix legs, or the shards the
 * matrix never runs take their tests with them; the job name has to say which
 * leg it is, or a red check cannot be read; and the diagnostics artifact name
 * has to carry the shard, or the legs collide on upload.
 */
function assertEngineIsSharded(job, label, runCommand, expectedShardCount, denominator = String(expectedShardCount)) {
	const axis = job.match(/^\s+shard: \[(?<legs>[^\]]+)\]$/mu);
	assert.ok(axis, `${label} must shard Playwright across runners`);
	const legs = axis.groups.legs.split(',').map((leg) => leg.trim());
	assert.deepEqual(legs, Array.from({ length: expectedShardCount }, (_, index) => String(index + 1)),
		`${label} shard ids must be 1..N`);

	const total = denominator;
	assert.ok(
		job.includes(`${runCommand} --shard=\${{ matrix.shard }}/${total}`),
		`${label} must run \`${runCommand}\` under --shard=\${{ matrix.shard }}/${total}`,
	);
	assert.match(
		job,
		new RegExp(`^\\s+name: Browser /.*\\$\\{\\{ matrix\\.shard \\}\\}/${total.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'),
		`${label} job name must name its shard`,
	);

	const artifact = job.match(/^\s+name: (?<artifact>browser-diagnostics-.+)$/mu);
	assert.ok(artifact, `${label} must upload browser diagnostics`);
	assert.ok(
		artifact.groups.artifact.includes('${{ matrix.shard }}'),
		`${label} diagnostics artifact name must include the shard or the legs collide on upload`,
	);
}
