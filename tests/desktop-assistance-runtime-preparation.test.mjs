/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareDesktopAssistanceRuntimeSet, prepareDesktopAssistanceOnly } from '../scripts/lib/desktop-assistance-runtime-preparation.mjs';

const speech = { manifest: { engine: 'speech' }, summary: { engine: 'speech' }, buildReceipt: { source: 'pinned' } };
const families = { manifestBytes: Buffer.from('{"families":"gpu"}\n'), summary: { engine: 'families' } };
const kokoro = { manifestBytes: Buffer.from('{"kokoro":"gpu"}\n'), summary: { fileCount: 7, byteLength: 123 } };
const distribution = { manifestBytes: Buffer.from('{"bundles":[]}\n'), summary: { archive: 'pinned' },
	speech, families, kokoro };
const repositoryRoot = join(tmpdir(), 'assistance-repo');
const options = { repositoryRoot, buildRoot: join(repositoryRoot, '.desktop-build'), targetId: 'win-arm64', sourceRevision: 'a'.repeat(40) };

test('AI-only preparation builds every neural closure and uses the final sealed distribution inventories', async () => {
	const calls = [];
	const result = await prepareDesktopAssistanceRuntimeSet(options, {
		stageSpeech: async request => { calls.push(['speech', request]); return { unsigned: 'speech' }; },
		stageFamilies: async request => { calls.push(['families', request]); return { unsigned: 'families' }; },
		buildKokoro: async request => { calls.push(['build-kokoro', request]); return { bundleRoot: '/verified/kokoro' }; },
		stageKokoro: async request => { calls.push(['stage-kokoro', request]); return { unsigned: 'kokoro' }; },
		stageDistribution: async request => { calls.push(['distribution', request]); return distribution; },
		report: () => {},
	});
	assert.deepEqual(calls.map(([name]) => name), ['speech', 'families', 'build-kokoro', 'stage-kokoro', 'distribution']);
	for (const [, request] of calls) assert.equal(request.targetId, 'win-arm64');
	assert.equal(calls[0][1].nodeModulesRoot, join(repositoryRoot, 'node_modules'));
	assert.equal(calls[3][1].bundleRoot, '/verified/kokoro');
	assert.equal(calls[4][1].archiveRoot, join(options.buildRoot, 'assistance-distribution'));
	assert.equal(result.speech, speech);
	assert.equal(result.families, families);
	assert.equal(result.kokoro, kokoro);
	assert.equal(result.distribution, distribution);
});

test('offline handoff consumers never start a second neural engine build', async () => {
	const imported = { speech, families, kokoro, distribution };
	const handoffRoot = join(tmpdir(), 'handoff');
	const result = await prepareDesktopAssistanceRuntimeSet({ ...options, handoffRoot }, {
		stageHandoff: async request => {
			assert.equal(request.handoffRoot, handoffRoot);
			assert.equal(request.sourceRevision, options.sourceRevision);
			assert.equal(request.targetId, 'win-arm64');
			return imported;
		},
		stageSpeech: async () => { throw new Error('must reuse handoff'); },
		stageFamilies: async () => { throw new Error('must reuse handoff'); },
		buildKokoro: async () => { throw new Error('must reuse handoff'); },
		report: () => {},
	});
	assert.equal(result, imported);
});

test('a failed neural family stops preparation before any archives can be published', async () => {
	await assert.rejects(prepareDesktopAssistanceRuntimeSet(options, {
		stageSpeech: async () => { throw new Error('GPU build failed'); },
		stageDistribution: async () => { throw new Error('must not seal a partial runtime set'); },
		report: () => {},
	}), /GPU build failed/u);
});

test('standalone AI preparation writes only authenticated handoff metadata and no desktop application build', async context => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'assistance-only-'));
	context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	await prepareDesktopAssistanceOnly({ repositoryRoot, targetId: 'win-arm64', sourceRevision: options.sourceRevision }, {
		prepare: async () => ({ speech, families, kokoro, distribution }),
	});
	const build = join(repositoryRoot, '.desktop-build');
	assert.deepEqual((await readdir(build)).sort(), ['app', 'stage-manifest.json']);
	assert.deepEqual(await readdir(join(build, 'app')), ['config']);
	assert.equal((await readdir(join(build, 'app/config'))).length, 4);
	const stage = JSON.parse(await readFile(join(build, 'stage-manifest.json'), 'utf8'));
	assert.equal(stage.sourceRevision, options.sourceRevision);
	assert.deepEqual(stage.target, { platform: 'win', arch: 'arm64' });
	assert.deepEqual(stage.assistanceNativeBuild, speech.buildReceipt);
	assert.deepEqual(stage.assistanceRuntimeDistribution, distribution.summary);
	for (const invalid of [{ targetId: 'win-ia32' }, { sourceRevision: null }]) {
		await assert.rejects(prepareDesktopAssistanceOnly({ repositoryRoot, targetId: 'win-arm64',
			sourceRevision: options.sourceRevision, ...invalid }), /identity/u);
		await access(join(build, 'stage-manifest.json'));
	}
});
