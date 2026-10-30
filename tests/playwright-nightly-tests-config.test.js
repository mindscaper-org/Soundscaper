/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const environmentKeys = [
	'SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL',
	'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT',
	'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT',
];

test('bundled Playwright config uses only absolute launcher-provided paths', async () => {
	const originalEnvironment = Object.fromEntries(
		environmentKeys.map((key) => [key, process.env[key]]),
	);
	const payloadRoot = resolve('/tmp/soundscaper-nightly-tests-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-tests-run');

	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL = 'http://127.0.0.1:41000';
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		const { createNightlyTestsConfig, default: config } = await import(
			'../playwright.nightly-tests.config.mjs?absolute-launcher-paths'
		);

		assert.equal(config.testDir, resolve(payloadRoot, 'tests/browser'));
		assert.deepEqual(config.testMatch, ['audio-editor-waveform-gpu.spec.js', 'framescaper-visual-preview.spec.js']);
		assert.equal(config.metadata.requireHardwareGpu, true);
		for (const title of ['Canvas fallback does not accumulate', 'unavailable GPU keeps',
			'Framescaper v1 visual state without WebGL2']) assert.match(title, config.grepInvert);
		assert.equal(config.outputDir, resolve(runRoot, 'test-results'));
		assert.equal(config.use.baseURL, 'http://127.0.0.1:41000');
		assert.equal(config.webServer, undefined);
		assert.equal(config.workers, 4);
		assert.equal(config.retries, 1);
		assert.equal(config.failOnFlakyTests, false);
		assert.equal(config.updateSnapshots, 'none');
		for (const platform of ['win32', 'linux', 'darwin']) {
			assert.deepEqual(
				createNightlyTestsConfig(process.env, platform).projects.map(({ name }) => name),
				['chromium'],
			);
		}
		const [chromium] = config.projects;
		assert.equal(chromium.use.channel, 'chromium');
		assert.equal(chromium.use.headless, true);
		assert.deepEqual(chromium.use.launchOptions?.args, ['--enable-gpu']);
		assert.deepEqual(config.reporter, [
			['list'],
			[resolve(payloadRoot, 'scripts/lib/desktop-nightly-tests-progress-reporter.mjs')],
			['html', { outputFolder: resolve(runRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(runRoot, 'results.json') }],
			['junit', { outputFile: resolve(runRoot, 'junit.xml') }],
		]);

		assert.throws(
			() => createNightlyTestsConfig({
				SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://example.com:41000',
				SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
				SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			}),
			/loopback/u,
		);
		assert.throws(
			() => createNightlyTestsConfig({
				SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL: 'http://127.0.0.1:41000',
				SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: 'relative/payload',
				SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: runRoot,
			}),
			/absolute/u,
		);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('bundled metrics config isolates registered collectors from the functional suite', async () => {
	const originalEnvironment = Object.fromEntries(
		environmentKeys.map((key) => [key, process.env[key]]),
	);
	const payloadRoot = resolve('/tmp/soundscaper-nightly-metrics-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-metrics-run');
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL = 'http://127.0.0.1:41001';
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		const { default: config } = await import(
			'../playwright.nightly-metrics.config.mjs?absolute-launcher-paths'
		);

		assert.equal(config.workers, 1);
		assert.equal(config.retries, 0);
		assert.equal(config.fullyParallel, false);
		assert.deepEqual(config.projects.map(({ name }) => name), ['chromium']);
		assert.equal(config.projects[0].use.channel, 'chromium');
		assert.equal(config.projects[0].use.headless, true);
		assert.deepEqual(config.projects[0].use.launchOptions?.args, ['--enable-gpu']);
		assert.equal(config.outputDir, resolve(runRoot, 'metrics/test-results'));
		assert.ok(config.testMatch.includes('audio-editor-video-preview-benchmark.spec.js'));
		assert.ok(config.testMatch.includes('audio-editor-longform-editorial-benchmark.spec.js'));
		assert.ok(config.testMatch.includes('audio-editor-m4-production-parity.spec.js'));
		assert.ok(config.testMatch.includes('audio-editor-m4b2-keyframe-parity.spec.js'));
		assert.deepEqual(config.reporter, [
			['list'],
			[resolve(payloadRoot, 'scripts/lib/desktop-nightly-tests-progress-reporter.mjs')],
			['html', { outputFolder: resolve(runRoot, 'metrics/playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(runRoot, 'metrics/results.json') }],
			['junit', { outputFile: resolve(runRoot, 'metrics/junit.xml') }],
		]);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('packaged metrics run each formal workload in its owning product', async () => {
	const payloadRoot = resolve('/tmp/soundscaper-nightly-packaged-metrics-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-packaged-metrics-run');
	const originalEnvironment = Object.fromEntries(
		environmentKeys.map((key) => [key, process.env[key]]),
	);
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL = 'http://127.0.0.1:41002';
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		const { createNightlyPackagedMetricsConfig } = await import(
			'../playwright.nightly-packaged-metrics.config.mjs?formal-workload-ownership'
		);
		const config = createNightlyPackagedMetricsConfig(process.env);
		const projects = Object.fromEntries(config.projects.map((project) => [project.name, project.testMatch]));

		assert.equal(config.workers, 1);
		assert.equal(config.fullyParallel, false);
		assert.deepEqual(projects['packaged-soundscaper'], [
			'desktop-packaged-runtime-smoke.spec.js',
			'desktop-packaged-display-audio.spec.js',
			'audio-editor-longform-editorial-benchmark.spec.js',
			'audio-editor-m4-production-parity.spec.js',
		]);
		assert.deepEqual(projects['packaged-soundscaper-audio-devices'], [
			'desktop-packaged-audio-io.spec.js',
		]);
		assert.deepEqual(
			config.projects.find(({ name }) => name === 'packaged-soundscaper-audio-devices').metadata,
			{ productId: 'soundscaper', packagedAudioDeviceFixture: true },
		);
		assert.deepEqual(projects['packaged-framescaper'], [
			'desktop-packaged-runtime-smoke.spec.js',
			'audio-editor-video-preview-benchmark.spec.js',
			'audio-editor-m4b2-keyframe-parity.spec.js',
		]);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('package scripts expose local preparation and packaging of the diagnostic flavor', async () => {
	const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

	assert.equal(
		packageMetadata.scripts['desktop:nightly-tests:prepare'],
		'node scripts/desktop-nightly-tests-prepare.mjs',
	);
	assert.equal(
		packageMetadata.scripts['desktop:nightly-tests:products'],
		'node scripts/desktop-nightly-tests-products.mjs',
	);
	assert.equal(
		packageMetadata.scripts['desktop:nightly-tests:dist'],
		'npm run build && npm run build:browser:framescaper && npm run build:browser:lightscaper && npm run prepare:browser:products && npm run pretest:browser:dual-origin && npm run desktop:nightly-tests:products && npm run desktop:nightly-tests:prepare && electron-builder --config electron-builder.nightly-tests.config.cjs --publish never',
	);
});

test('diagnostic runs keep the canonical visual baseline on Linux Chromium', async () => {
	const [browserSpec, snapshots] = await Promise.all([
		readFile(new URL('./browser/audio-editor-export-session.spec.js', import.meta.url), 'utf8'),
		readdir(new URL('./browser/audio-editor-export-session.spec.js-snapshots/', import.meta.url)),
	]);

	assert.match(
		browserSpec,
		/test\.skip\(\s*process\.platform !== 'linux'\s*\|\|\s*testInfo\.project\.name !== 'chromium',\s*'[^']*'\s*,?\s*\)/u,
	);
	assert.ok(snapshots.length > 0);
	assert.ok(snapshots.every((snapshot) => snapshot.endsWith('-chromium-linux.png')));
});
