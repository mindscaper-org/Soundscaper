/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('the media-host producer builds, uploads, downloads, and stages all five native targets', async () => {
	const workflow = await readFile(new URL(
		'.github/workflows/framescaper-media-host-native-build.yml', ROOT,
	), 'utf8');
	for (const target of ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.match(workflow, new RegExp(`target: ${target}\\b`, 'u'));
	}
	for (const command of [
		'scripts/ci-provision-framescaper-ffmpeg.mjs',
		'scripts/ci-provision-framescaper-boost.mjs',
		'scripts/ci-provision-framescaper-media-host-sources.mjs',
		'scripts/build-framescaper-media-host.mjs',
		'scripts/stage-framescaper-media-host-build-result.mjs',
	]) assert.match(workflow, new RegExp(command.replaceAll('.', '\\.'), 'u'));
	assert.match(workflow, /--external-source-root="\$FRAMESCAPER_MEDIA_EXTERNAL_SOURCE_ROOT"/u);
	assert.match(workflow, /runner: windows-11-vs2026-arm/u);
	assert.match(workflow, /framescaper-media-host-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.match(workflow, /needs: build[\s\S]*actions\/download-artifact/u);
	assert.match(workflow, /workflow_call:[\s\S]*workflow_dispatch:/u);
});

const { load } = createRequire(import.meta.url)('js-yaml');
const TARGETS = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];

async function linkedCarrierStep() {
	const { jobs } = load(await readFile(new URL('.github/workflows/framescaper-media-host-native-build.yml', ROOT), 'utf8'));
	assert.deepEqual(jobs.build.strategy.matrix.include.map(({ target }) => target), TARGETS);
	const steps = jobs.build.steps;
	const proof = steps.find(step => step.name === 'Verify linked WebM carrier timing and alpha');
	assert.ok(proof);
	assert.equal(proof.if, undefined);
	assert.equal(proof['continue-on-error'], undefined);
	assert.equal(proof.shell, 'bash');
	assert.equal(proof.env.FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_ROOT, '${{ runner.temp }}/framescaper-media-build-result');
	assert.equal(proof.env.FRAMESCAPER_MEDIA_HOST_EXPECTED_TARGET, '${{ matrix.target }}');
	assert.equal(proof.env.FRAMESCAPER_MEDIA_HOST_EXPECTED_SOURCE_REVISION, '${{ github.sha }}');
	assert.ok(steps.findIndex(step => step.name === 'Build, self-test, and verify target result') < steps.indexOf(proof));
	assert.ok(steps.indexOf(proof) < steps.findIndex(step => step.with?.name === 'framescaper-media-host-build-result-${{ matrix.target }}'));
	const match = /^node --import tsx --input-type=module <<'NODE'\n([\s\S]+)\nNODE\n?$/u.exec(proof.run);
	assert.ok(match, 'the native proof must execute its checked inline Node program');
	return match[1].replace(/^import [^\n]+;\n/gmu, '');
}

function carrierProofFixture(source, target, overrides = {}) {
	const root = resolve('verified-native-result');
	const manifest = Buffer.from('the checked native source manifest');
	const revision = 'a'.repeat(40);
	const payload = `payload/framescaper-media-host${target.startsWith('win-') ? '.exe' : ''}`;
	const receipt = { target, sourceRevision: revision,
		sourceManifestSha256: createHash('sha256').update(manifest).digest('hex'), payload: { path: payload }, ...overrides };
	const calls = [];
	return { calls, async run(outcome = { status: 0, signal: null }) {
		await runInNewContext(`(async () => {${source}\n})()`, {
			process: { execPath: process.execPath, env: { FRAMESCAPER_MEDIA_HOST_BUILD_RESULT_ROOT: root,
				FRAMESCAPER_MEDIA_HOST_EXPECTED_TARGET: target, FRAMESCAPER_MEDIA_HOST_EXPECTED_SOURCE_REVISION: revision,
				FRAMESCAPER_MEDIA_HOST_TEST_BINARY: 'untrusted inherited executable' } },
			verifyFramescaperMediaHostBuildResult: async options => {
				assert.equal(options.buildResultRoot, root); return { buildResultRoot: root, receipt };
			},
			createHash, resolve, readFileSync(path) {
				assert.equal(path, 'native/framescaper-media-host/source-manifest.json'); return manifest;
			},
			spawnSync(command, args, options) {
				calls.push({ command, args: [...args], options });
				assert.equal(command, process.execPath);
				assert.deepEqual([...args], ['--import', 'tsx', '--test-concurrency=1', '--test',
					'tests/framescaper-native-webm-encoder.test.ts']);
				assert.equal(options.env.FRAMESCAPER_MEDIA_HOST_TEST_BINARY, resolve(root, payload));
				assert.equal(options.stdio, 'inherit'); return outcome;
			},
		});
	} };
}

test('every native producer executes the linked carrier proof with its authenticated payload before upload', async () => {
	const source = await linkedCarrierStep();
	for (const target of TARGETS) {
		const fixture = carrierProofFixture(source, target);
		await fixture.run(); assert.equal(fixture.calls.length, 1);
	}
});

test('linked carrier qualification refuses a mismatched identity and propagates actual child failures', async () => {
	const source = await linkedCarrierStep();
	for (const changed of [{ target: 'win-arm64' }, { sourceRevision: 'b'.repeat(40) }, { sourceManifestSha256: 'c'.repeat(64) }]) {
		const fixture = carrierProofFixture(source, 'linux-x64', changed);
		await assert.rejects(fixture.run(), /differs from this/u); assert.equal(fixture.calls.length, 0);
	}
	const fixture = carrierProofFixture(source, 'linux-x64');
	await assert.rejects(fixture.run({ status: 1, signal: null }), /proof failed/u);
	await assert.rejects(fixture.run({ status: null, signal: 'SIGTERM' }), /proof failed/u);
	const failure = new Error('actual spawn failure');
	await assert.rejects(fixture.run({ error: failure, status: null, signal: null }), error => error === failure);
});
