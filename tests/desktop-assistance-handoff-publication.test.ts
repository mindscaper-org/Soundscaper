/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { publishDesktopAssistanceRuntimeHandoff } from '../scripts/publish-assistance-runtime-handoff.ts';

const revision = 'a'.repeat(40);
const environment = {
	SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT: join(tmpdir(), 'runtime-handoff'),
	SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT: join(tmpdir(), 'runtime-archives'),
	SOUNDSCAPER_SOURCE_REVISION: revision,
	SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: 'linux',
	SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'x64',
};

test('handoff publication requires explicit roots, source revision and target before reading or publishing', async () => {
	for (const key of Object.keys(environment)) {
		await assert.rejects(publishDesktopAssistanceRuntimeHandoff({ ...environment, [key]: '' }),
			new RegExp(`${key} is required`, 'u'));
	}
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff({ ...environment,
		SOUNDSCAPER_SOURCE_REVISION: 'main' }), /exact source revision/u);
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff({ ...environment,
		SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'ia32' }), /desktop target/u);
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff({ ...environment,
		SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT: environment.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT }),
	/distinct/u);
});

test('handoff publication validates local bytes before creating an R2 client or uploading', async () => {
	const calls: string[] = [];
	const failure = new Error('Staged assistance archive digest or length changed.');
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff(environment, {
		readHandoff: async options => {
			calls.push('verify');
			assert.equal(options.sourceRevision, revision);
			assert.equal(options.targetId, 'linux-x64');
			assert.equal(options.archivesRoot, environment.SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT);
			assert.equal(options.handoffRoot, environment.SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT);
			assert.equal(options.download, false, 'unpublished archives must already exist locally');
			throw failure;
		},
		createClient: () => { throw new Error('must not create a publisher before verification'); },
		publish: async () => { throw new Error('must not publish corrupt archives'); },
	}), failure);
	assert.deepEqual(calls, ['verify']);
});

test('handoff publication forwards authenticated authority and existing archives to the immutable publisher', async () => {
	const calls: string[] = [];
	const authority = { receipt: {}, targetId: 'linux-x64' };
	const client = {};
	const result = await publishDesktopAssistanceRuntimeHandoff(environment, {
		readHandoff: async options => {
			calls.push('verify');
			return { handoff: {}, authority, distribution: { targetId: 'linux-x64' },
				relativeArchives: [], archivesRoot: options.archivesRoot };
		},
		createClient: () => { calls.push('credentials'); return client; },
		publish: async options => {
			calls.push('publish');
			assert.equal(options.authority, authority);
			assert.equal(options.client, client);
			assert.equal(options.archivesRoot, environment.SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT);
			return { targetId: 'linux-x64', published: 5 };
		},
	});
	assert.deepEqual(calls, ['verify', 'credentials', 'publish']);
	assert.deepEqual(result, { targetId: 'linux-x64', published: 5, whisperIdentity: null });
});

test('handoff publication refuses another source revision or target using the actual verifier', async context => {
	const root = await mkdtemp(join(tmpdir(), 'handoff-publication-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const handoffRoot = join(root, 'handoff');
	await mkdir(handoffRoot);
	await writeFile(join(handoffRoot, 'handoff.json'), JSON.stringify({
		schemaVersion: 1, sourceRevision: 'b'.repeat(40), targetId: 'linux-x64',
	}));
	const scoped = { ...environment, SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT: handoffRoot,
		SOUNDSCAPER_ASSISTANCE_RUNTIME_ARCHIVES_ROOT: join(root, 'archives') };
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff(scoped), /source revision or target/u);
	await writeFile(join(handoffRoot, 'handoff.json'), JSON.stringify({
		schemaVersion: 1, sourceRevision: revision, targetId: 'win-arm64',
	}));
	await assert.rejects(publishDesktopAssistanceRuntimeHandoff(scoped), /source revision or target/u);
});
