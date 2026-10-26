/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopLinkedVideoLocatorStore, type DesktopLinkedVideoReadCapabilityStore } from '../desktop/linked-video-locator-store.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRecoveryActions } from '../src/soundscaper/editor-project-recovery-service.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeWav } from '../src/common/editor/wav.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';

const PCM = Float32Array.of(.125, -.25, .25, -.125);
type Failure = 'healthy' | 'ENOENT' | 'ENOTDIR' | 'EACCES' | 'EIO' | 'ENETDOWN' | 'invalid-stat' | 'revoked' | 'revision' | 'retired' | 'race-before' | 'race-after' | 'cleanup' | 'changed-after' | 'changed-after-cleanup';

for (const failure of ['healthy', 'ENOENT', 'ENOTDIR', 'EACCES', 'EIO', 'ENETDOWN', 'invalid-stat', 'revoked', 'revision', 'retired', 'race-before', 'race-after', 'cleanup', 'changed-after', 'changed-after-cleanup'] as const) {
	test(`Native linked-original evidence ${failure} reaches Recovery without a destructive false absence`, async context => {
		const fixture = await setup(context); fixture.failure = failure;
		if (failure === 'revoked') fixture.native.revokeOwner(fixture.owner);
		if (failure === 'retired') await fixture.native.release(fixture.locator.locatorId, { owner: fixture.owner, expectedRevision: fixture.locator.locatorRevision, expectedKind: 'audio' });
		if (failure === 'healthy' || failure === 'ENOENT' || failure === 'ENOTDIR' || failure === 'changed-after') {
			const inspection = await fixture.recovery.inspect(fixture.project.id);
			assert.equal(inspection.candidates[0]?.status, failure === 'healthy' ? 'usable' : 'repairable');
			const restored = await fixture.recovery.recover(inspection, 0);
			assert.deepEqual(restored.project.sources.map(source => source.id), failure === 'healthy' ? ['linked', 'peer'] : ['peer']);
			for await (const chunk of fixture.store.readSourceChunks('peer')) assert.deepEqual(chunk.channels[0], PCM);
		} else {
			try {
				const inspection = await fixture.recovery.inspect(fixture.project.id);
				assert.equal(inspection.candidates[0]?.status, 'unrecoverable', 'a failed native read must never become a salvageable missing source');
				await assert.rejects(fixture.recovery.recover(inspection, 0), /cannot be restored/u);
			} catch (error) {
				if (!(error instanceof Error) || error.name !== 'InvalidStateError') throw error;
			}
			assert.equal((await fixture.store.listProjects()).length, 1, 'native read failure cannot publish a partial project');
		}
		assert.deepEqual(await fixture.store.loadProject(fixture.project.id), fixture.project);
		assert.deepEqual(await fixture.store.getLinkedOriginalBinding(fixture.project.id, 'linked'), fixture.binding);
		assert.deepEqual(new Uint8Array(await readFile(fixture.path)), new Uint8Array(await fixture.body.arrayBuffer()), 'the external original remains unchanged');
		if (failure === 'race-after' || failure === 'cleanup' || failure === 'changed-after-cleanup') {
			assert.equal(fixture.registrations, 1); assert.equal(fixture.releases, 1, 'retirement must finish exact descriptor cleanup');
		} else if (failure !== 'healthy' && failure !== 'changed-after') assert.equal(fixture.registrations, 0, 'invalid native authority never registers a read');
	});
}

async function setup(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-recovery-evidence-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const path = join(root, 'original.wav'), owner = {};
	const body = new Blob([Uint8Array.from(encodeWav([PCM], { sampleRate: 48_000, float: true, dither: false }))], { type: 'audio/wav' });
	await writeFile(path, new Uint8Array(await body.arrayBuffer()));
	let failure: Failure = 'healthy', registrations = 0, releases = 0;
	const port: DesktopLinkedVideoReadCapabilityStore = {
		async registerMaterializedPath(selectedPath, options) {
			registrations++;
			const metadata = await stat(selectedPath);
			if (failure === 'race-after' || failure === 'cleanup') native.revokeOwner(owner);
			return { id: 'a'.repeat(64), url: 'soundscaper-app://bundle/read/test', name: options.displayName,
				size: metadata.size, mimeType: options.mimeType, readProfile: 'materialized-v1', lastModified: Math.trunc(metadata.mtimeMs) };
		},
		registerLinkedOriginalRangePath() { throw new Error('Recovery must use materialized original reads here.'); },
		release(id, options) {
			assert.equal(id, 'a'.repeat(64)); assert.equal(options.owner, owner); releases++;
			if (failure === 'cleanup' || failure === 'changed-after-cleanup') throw new Error('Native capability cleanup failed.');
			return true;
		},
	};
	const native = new DesktopLinkedVideoLocatorStore({ readCapabilities: port, stat: async selectedPath => {
		if (['ENOENT', 'ENOTDIR', 'EACCES', 'EIO', 'ENETDOWN'].includes(failure)) throw Object.assign(new Error('Native file read failed.'), { code: failure });
		const metadata = await stat(selectedPath);
		if (failure === 'race-before') native.revokeOwner(owner);
		if (failure.startsWith('changed-after') && registrations > 0) return { ...metadata, isFile: () => true, mtimeMs: metadata.mtimeMs + 1 };
		return failure === 'invalid-stat' ? { ...metadata, isFile: () => true, mtimeMs: Number.NaN } : metadata;
	} });
	const locator = await native.registerPath(path, { owner, kind: 'audio', mimeType: 'audio/wav', displayName: 'original.wav' });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name,
		linkedOriginalPort: { load: async (_kind, id, options) => {
			const loaded = await native.load(id, { owner, expectedKind: 'audio', expectedRevision: failure === 'revision' ? 'f'.repeat(64) : options.expectedRevision });
			return loaded ? { blob: new Blob([await readFile(path)], { type: 'audio/wav' }), locatorRevision: loaded.locatorRevision } : null;
		} } satisfies LinkedOriginalPort });
	context.after(async () => { await store.close(); await native.dispose(); });
	const linked = createAudioSource({ id: 'linked', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const peer = createAudioSource({ id: 'peer', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'native-linked-recovery', sources: [linked, peer],
		clips: [linked, peer].map(source => createAudioClip({ id: source.id, sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 })),
		tracks: [linked, peer].map(source => createAudioTrack({ id: source.id, clipIds: [source.id] })) });
	const binding = await store.bindLinkedAudioOriginal(project.id, linked, locator.locatorId, { expectedSnapshot: body, expectedLocatorRevision: locator.locatorRevision });
	const writer = await store.beginSourceWrite(peer.storageKey, peer); await writer.write([PCM]); await writer.commit();
	await store.saveProject(project); registrations = 0; releases = 0;
	return { store, native, locator, owner, path, body, binding, project, recovery: createSoundscaperProjectRecoveryActions(store),
		get registrations() { return registrations; }, get releases() { return releases; },
		set failure(value: Failure) { failure = value; } };
}
