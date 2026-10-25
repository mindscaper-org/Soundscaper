/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { readFile } from 'node:fs/promises';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRecoveryActions } from '../src/soundscaper/editor-project-recovery-service.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { encodeWav } from '../src/common/editor/wav.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';

const PCM = Float32Array.of(.125, .25, -.125, -.25);
const REVISION = 'original_revision_00001';
type Failure = 'healthy' | 'missing' | 'length' | 'digest' | 'permission' | 'storage' | 'network' | 'stale' | 'lookalike' | 'read-error' | 'cleanup';

for (const ranged of [false, true]) for (const failure of ['healthy', 'missing', 'length', 'digest'] as const) {
	test(`Recover salvages a healthy peer beside ${failure} linked PCM (${ranged ? 'range' : 'Blob'})`, async context => {
		const fixture = await setup(context, ranged);
		fixture.failure = failure;
		const inspection = await fixture.recovery.inspect(fixture.project.id);
		assert.equal(inspection.candidates[0]?.status, failure === 'healthy' ? 'usable' : 'repairable');
		const restored = await fixture.recovery.recover(inspection, 0);
		assert.deepEqual(restored.project.sources.map(source => source.id), failure === 'healthy' ? ['linked', 'peer'] : ['peer']);
		assert.equal(restored.project.clips.length, failure === 'healthy' ? 2 : 1);
		const chunks = [];
		for await (const chunk of fixture.store.readSourceChunks('peer')) chunks.push(...chunk.channels[0]!);
		assertPcmSamplesEqual(chunks, [...PCM], 'the recovered peer retains every original sample');
		assert.deepEqual(await fixture.store.loadProject(fixture.project.id), fixture.project);
		assert.deepEqual(await fixture.store.getLinkedOriginalBinding(fixture.project.id, 'linked'), fixture.binding,
			'the absent or changed external original remains bound to its untouched original project');
		assert.equal(fixture.releases, ranged && failure !== 'missing' ? 2 : 0);
	});
}

for (const ranged of [false, true]) for (const failure of ['permission', 'storage', 'network', 'stale', 'lookalike'] as const) {
	test(`Recover cannot classify ${failure} as missing external media (${ranged ? 'range' : 'Blob'})`, async context => {
		const fixture = await setup(context, ranged);
		fixture.failure = failure;
		if (failure === 'permission') {
			await assert.rejects(fixture.recovery.inspect(fixture.project.id), error => error === fixture.error);
		} else {
			const inspection = await fixture.recovery.inspect(fixture.project.id);
			assert.equal(inspection.candidates[0]?.status, 'unrecoverable');
			await assert.rejects(fixture.recovery.recover(inspection, 0), /cannot be restored/u);
		}
		assert.deepEqual(await fixture.store.loadProject(fixture.project.id), fixture.project);
		assert.equal((await fixture.store.listProjects()).length, 1, 'no destructive partial copy is published');
	});
}

for (const failure of ['read-error', 'cleanup'] as const) test(`Recovery retains range ${failure} failures as unrecoverable`, async context => {
	const fixture = await setup(context, true); fixture.failure = failure;
	const inspection = await fixture.recovery.inspect(fixture.project.id);
	assert.equal(inspection.candidates[0]?.status, 'unrecoverable');
	assert.equal(fixture.releases, 2, 'both inspected versions release their failed lease');
	await assert.rejects(fixture.recovery.recover(inspection, 0), /cannot be restored/u);
	assert.deepEqual(await fixture.store.loadProject(fixture.project.id), fixture.project);
	assert.equal((await fixture.store.listProjects()).length, 1);
});

for (const missing of [false, true]) test(`The same confirmed absence authority preserves or omits linked video missing=${String(missing)}`, async context => {
	const bytes = Buffer.from(await readFile(new URL('./browser/fixtures/ffmpeg-aligned-camera-audio.mp4.base64', import.meta.url), 'utf8'), 'base64');
	const body = new Blob([bytes], { type: 'video/mp4' }); let unavailable = false;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name,
		linkedVideoOriginalPort: { load: () => unavailable ? null : { blob: body, locatorRevision: REVISION } } });
	context.after(async () => { await store.close(); });
	const video = createVideoSource({ id: 'camera', name: 'Camera.mp4', sampleFrameCount: 48_000, sourceFrameCount: 25,
		frameRate: { num: 25, den: 1 }, width: 64, height: 48, mimeType: 'video/mp4' });
	const peer = createAudioSource({ id: 'peer', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'linked-camera-recovery', sources: [video, peer], primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['picture', 'sound'] }],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['video'] }, createAudioTrack({ id: 'sound', clipIds: ['peer'] })],
		clips: [{ kind: 'video', id: 'video', sourceId: video.id, sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 25,
			sourceInFrame: 0, sourceFrameCount: 25 }, createAudioClip({ id: 'peer', sourceId: peer.id, sourceDurationFrames: 4, durationFrames: 4 })] });
	const binding = await store.bindLinkedVideoOriginal(project.id, video, 'camera_locator_0000001', { expectedSnapshot: body });
	const writer = await store.beginSourceWrite(peer.storageKey, peer); await writer.write([PCM]); await writer.commit();
	await store.saveProject(project); unavailable = missing;
	const recovery = createSoundscaperProjectRecoveryActions(store), inspection = await recovery.inspect(project.id);
	assert.equal(inspection.candidates[0]?.status, missing ? 'repairable' : 'usable');
	const result = await recovery.recover(inspection, 0);
	assert.deepEqual(result.project.sources.map(source => source.id), missing ? ['peer'] : ['camera', 'peer']);
	assert.deepEqual(await store.loadProject(project.id), project);
	assert.deepEqual(await store.getLinkedVideoOriginalBinding(project.id, video.id), binding);
});

async function setup(context: test.TestContext, ranged: boolean) {
	let failure: Failure = 'healthy', releases = 0;
	const original = wav(PCM), changed = wav(Float32Array.from(PCM, value => -value));
	const source = createAudioSource({ id: 'linked', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const peer = createAudioSource({ id: 'peer', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'linked-recovery', sources: [source, peer],
		clips: [source, peer].map(source => createAudioClip({ id: source.id, sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4 })),
		tracks: [source, peer].map(source => createAudioTrack({ id: source.id, clipIds: [source.id] })) });
	let error: Error = new Error('No pending failure');
	const currentBody = async (locatorId: string): Promise<Blob | null> => {
		if (locatorId === 'replacement_locator_00001') return original;
		if (failure === 'stale') {
			failure = 'healthy';
			await store.relinkLinkedAudioOriginal(project.id, source, 'replacement_locator_00001', {
				expectedBindingToken: binding.bindingToken, expectedSnapshot: original,
			});
			return null;
		}
		if (failure === 'missing') return null;
		if (failure === 'permission' || failure === 'storage' || failure === 'network' || failure === 'lookalike') {
			error = failure === 'permission' ? new DOMException('Permission to the selected drive was denied.', 'NotAllowedError')
				: failure === 'storage' ? new Error('The source storage database is unavailable.') : failure === 'lookalike' ? new Error('The linked original is unavailable or changed.') : new TypeError('Network request failed.');
			throw error;
		}
		return failure === 'length' ? new Blob([original, Uint8Array.of(0)], { type: original.type }) : failure === 'digest' || failure === 'cleanup' ? changed : original;
	};
	const port: LinkedOriginalPort = {
		load: async (_kind, locatorId) => {
			const body = await currentBody(locatorId);
			return body ? { blob: body, locatorRevision: REVISION } : null;
		},
		...(ranged ? { leaseRange: async (_kind: unknown, locatorId: string) => {
			const body = await currentBody(locatorId);
			return body ? { locatorRevision: REVISION, byteLength: body.size, mimeType: body.type,
				readRange: async ({ offset, length }: Readonly<{ offset: number; length: number }>) => {
					if (failure === 'read-error') throw new TypeError('The external range read failed.');
					return new Uint8Array(await body.slice(offset, offset + length).arrayBuffer());
				},
				release: () => { releases++; if (failure === 'cleanup') throw new Error('External range lease cleanup failed.'); },
			} : null;
		} } : {}),
	};
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name, linkedOriginalPort: port });
	context.after(async () => { await store.close(); });
	const binding = await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original });
	const writer = await store.beginSourceWrite(peer.storageKey, peer); await writer.write([PCM]); await writer.commit();
	await store.saveProject(project);
	const recovery = createSoundscaperProjectRecoveryActions(store);
	return { store, recovery, project, binding, get error() { return error; }, get releases() { return releases; },
		set failure(value: Failure) { failure = value; } };
}

function wav(pcm: Float32Array): Blob {
	return new Blob([Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000, float: true, dither: false }))], { type: 'audio/wav' });
}
