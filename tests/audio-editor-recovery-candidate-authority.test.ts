/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { digestMediaContent } from '../src/common/media/content-digest.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRecoveryCopy, inspectSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-service.ts';
import { readSoundscaperRecoveryAvailableMediaSources } from '../src/soundscaper/editor-project-recovery-media.ts';
import { repairSoundscaperProject } from '../src/soundscaper/editor-project-recovery-repair.ts';
import { SoundscaperDesktopProjectLibraryCommittedError } from '../src/soundscaper/desktop-project-library-renderer-catalog.ts';

async function audioProject(context: TestContext) {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({
		id: 'original', sources: [{ id: 'source', frameCount: 4, sampleRate: 48_000, channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 4 }], tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
	});
	const source = project.sources[0]!;
	await store.writeAudioBuffer('source', {
		sampleRate: 48_000, numberOfChannels: 1, length: 4,
		getChannelData: () => Float32Array.of(0.125, 0.25, 0.375, 0.5),
	}, source);
	await store.saveProject(project);
	return { project, store };
}

test('a recovery copy cannot silently remove media that disappeared after the user reviewed the candidate', async context => {
	const { project, store } = await audioProject(context);
	const accepted = await inspectSoundscaperProjectRecovery(store, project.id);
	assert.equal(accepted.candidates[0]?.status, 'usable');
	store.getSourceMetadata = () => Promise.resolve(null);
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, accepted, 0), /changed|inspect/iu);
	assert.deepEqual((await store.listProjectRecoverySummaries()).map(({ id }) => id), [project.id]);
	const reviewedAgain = await inspectSoundscaperProjectRecovery(store, project.id);
	assert.equal(reviewedAgain.candidates[0]?.status, 'repairable');
	const repaired = await createSoundscaperProjectRecoveryCopy(store, reviewedAgain, 0);
	assert.equal(repaired.project.clips.length, 0);
});

test('retrying an indeterminate publication requires the live copy, even when an exact retained revision exists', async context => {
	const { project, store } = await audioProject(context);
	const accepted = await inspectSoundscaperProjectRecovery(store, project.id);
	const create = store.createProjectIfAbsent.bind(store);
	const read = store.readProjectRecoveryCandidates.bind(store);
	let copyId = '';
	let verifying = false;
	store.readProjectRecoveryCandidates = async id => {
		if (id !== project.id && !verifying) throw new Error('Temporary catalog outage');
		return read(id);
	};
	store.createProjectIfAbsent = async copy => {
		copyId = copy.id;
		assert.ok(await create(copy));
		throw new SoundscaperDesktopProjectLibraryCommittedError('publication', copy.id, new Error('Temporary catalog outage'));
	};
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, accepted, 0), /indeterminate/iu);
	assert.ok(copyId);
	const current = store.memory.projects.get(copyId);
	assert.ok(current);
	store.memory.projects.delete(copyId);
	verifying = true;
	assert.ok((await read(copyId)).some(({ kind }) => kind === 'revision'));
	await assert.rejects(createSoundscaperProjectRecoveryCopy(store, accepted, 0), /cannot yet be verified/iu);
	store.memory.projects.set(copyId, current);
	assert.equal((await createSoundscaperProjectRecoveryCopy(store, accepted, 0)).project.id, copyId);
});

test('video recovery checks distinct project bindings for aliases sharing a storage key', async () => {
	const body = new Blob(['readable original']);
	const source = createVideoSource({
		id: 'bound', storageKey: 'same-storage', contentSha256: await digestMediaContent(body),
		sampleFrameCount: 1_600, sourceFrameCount: 1, frameRate: { num: 30, den: 1 }, width: 16, height: 16,
	});
	const unbound = { ...source, id: 'unbound' };
	const store = {
		loadMediaAsset: () => Promise.resolve(null),
		getLinkedOriginalBinding: (_projectId: string, id: string) => Promise.resolve(id === source.id ? {} : null),
		resolveLinkedVideoOriginal: () => Promise.resolve({ blob: body }),
		getSourceMetadata: () => Promise.resolve(null),
		async *readSourceChunks() {},
	};
	for (const sources of [[unbound, source], [source, unbound]]) {
		const actual = await readSoundscaperRecoveryAvailableMediaSources(store, { id: 'project', sources });
		assert.deepEqual([...actual], [source.id]);
	}
});

test('foreign-family recovery candidates are rejected before any media access', async context => {
	const { project, store } = await audioProject(context);
	store.memory.projects.set(project.id, { ...project, schemaFamily: 'framescaper' });
	const read = store.readProjectRecoveryCandidates.bind(store);
	store.readProjectRecoveryCandidates = async id => (await read(id)).filter(({ kind }) => kind === 'current');
	let reads = 0;
	const getSourceMetadata = store.getSourceMetadata.bind(store);
	store.getSourceMetadata = async id => {
		reads++;
		return getSourceMetadata(id);
	};
	const result = await inspectSoundscaperProjectRecovery(store, project.id);
	assert.equal(result.candidates.find(({ kind }) => kind === 'current')?.status, 'unrecoverable');
	assert.equal(reads, 0);
});

test('recovery refuses identity accessors without invoking them', () => {
	let invoked = false;
	const project = Object.defineProperty({ schemaVersion: 1 }, 'schemaFamily', {
		get() { invoked = true; return 'soundscaper'; }, enumerable: true,
	});
	assert.throws(() => repairSoundscaperProject(project, new Set()));
	assert.equal(invoked, false);
});

test('a source repository timeout interrupts inspection so the entire candidate can be retried', async context => {
	const { project, store } = await audioProject(context);
	const read = store.getSourceMetadata.bind(store);
	const timeout = new DOMException('Timed out reading audio.', 'TimeoutError');
	store.getSourceMetadata = () => Promise.reject(timeout);
	await assert.rejects(inspectSoundscaperProjectRecovery(store, project.id), error => error === timeout);
	store.getSourceMetadata = read;
	assert.equal((await inspectSoundscaperProjectRecovery(store, project.id)).candidates[0]?.status, 'usable');
});

test('video recovery resets a damaged display name while preserving the verified original and its clip', async () => {
	const source = createVideoSource({ id: 'camera', name: 'Original camera',
		sampleFrameCount: 1_600, sourceFrameCount: 1, frameRate: { num: 30, den: 1 }, width: 16, height: 16,
	});
	const original = createSoundscaperProject({ sources: [source], primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: ['video'], rate: { num: 30, den: 1 } }],
		tracks: [{ id: 'video', type: 'video', clipIds: ['clip'] }],
		clips: [{ id: 'clip', kind: 'video', sourceId: source.id, sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }],
	});
	const result = repairSoundscaperProject({ ...original, sources: [{ ...original.sources[0], name: '' }] }, new Set(['camera']));
	assert.equal(result.project.sources[0]?.name, 'camera');
	assert.equal(result.project.clips[0]?.sourceId, 'camera');
});
