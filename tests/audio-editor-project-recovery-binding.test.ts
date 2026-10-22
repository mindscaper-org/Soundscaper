/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSoundscaperProjectRecovery, hasSoundscaperStartupRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createOrdinaryRecordingRecoveryService } from '../src/common/editor/controller/recording/internal/ordinary-recording-recovery-service.ts';
import { deferred } from './helpers/async-test-control.ts';

test('activation failure retries the published recovery copy without publishing a second copy', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const original = createSoundscaperProject({ id: 'binding-original', title: 'Original' });
	await store.saveProject(original);
	const saved = await store.loadProject(original.id);
	const before = (await store.listProjectRecoverySummaries()).length;
	const failure = new Error('Project activation interrupted.');
	const opened: string[] = [];
	const binding = bindSoundscaperProjectRecovery(store, (project) => {
		opened.push(project.id);
		if (opened.length === 1) throw failure;
	});
	const inspection = await binding.inspect(original.id);
	await assert.rejects(binding.recover(inspection, 0), (error) => error === failure);
	assert.equal((await store.listProjectRecoverySummaries()).length, before + 1);
	const result = await binding.recover(inspection, 0);
	assert.deepEqual(opened, [result.project.id, result.project.id]);
	assert.equal((await store.listProjectRecoverySummaries()).length, before + 1);
	assert.notEqual(result.project.id, original.id);
	assert.deepEqual(await store.loadProject(original.id), saved);
});

test('concurrent recovery and activation requests join one publication and one opening', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const original = createSoundscaperProject({ id: 'binding-concurrent-original' });
	await store.saveProject(original);
	const before = (await store.listProjectRecoverySummaries()).length;
	const started = deferred<void>(), release = deferred<void>();
	let opens = 0;
	const binding = bindSoundscaperProjectRecovery(store, async () => {
		opens += 1; started.resolve(); await release.promise;
	});
	const inspection = await binding.inspect(original.id);
	const first = binding.recover(inspection, 0);
	const duplicate = binding.recover(inspection, 0);
	assert.equal(first, duplicate);
	const refusedCandidate = assert.rejects(binding.recover(inspection, 1), /different recovery candidate/u);
	await started.promise;
	assert.equal(opens, 1);
	assert.equal((await store.listProjectRecoverySummaries()).length, before + 1);
	release.resolve();
	const [result, repeated] = await Promise.all([first, duplicate, refusedCandidate]);
	assert.equal(result, repeated);
});

test('startup salvage never masks cancellation, disposal or inaccessible storage', async () => {
	let reads = 0;
	const store = { readProjectRecoveryCandidates: () => { reads += 1; return Promise.resolve([]); } };
	for (const name of ['AbortError', 'EditorDisposedError', 'EditorStoreClosedError', 'EditorStoreBlockedError',
		'EditorStoreVersionStaleError', 'SecurityError', 'NotAllowedError', 'InvalidStateError', 'QuotaExceededError']) {
		assert.equal(await hasSoundscaperStartupRecovery(store, 'project', Object.assign(new Error(name), { name })), false);
	}
	assert.equal(reads, 0);
	const failure = new Error('The project database is unavailable.');
	const unavailable = { readProjectRecoveryCandidates: () => Promise.reject(failure) };
	await assert.rejects(hasSoundscaperStartupRecovery(unavailable, 'project', failure), (error) => error === failure);
	assert.equal(await hasSoundscaperStartupRecovery(store, 'project', new Error('Malformed current document.')), false);
});

test('startup repair requires damaged document evidence or a missing or corrupt immutable body', async () => {
	const project = createSoundscaperProject({ id: 'startup-evidence' });
	const current = { key: 'current', kind: 'current' as const, revision: 0, project };
	const store = { readProjectRecoveryCandidates: () => Promise.resolve([current]) };
	assert.equal(await hasSoundscaperStartupRecovery(store, project.id, new Error('Audio engine unavailable.')), false);
	const damaged = { readProjectRecoveryCandidates: () => Promise.resolve([{ ...current, project: { ...project, tracks: null } }]) };
	assert.equal(await hasSoundscaperStartupRecovery(damaged, project.id, new TypeError('Malformed tracks.')), true);
	const history = { readProjectRecoveryCandidates: () => Promise.resolve([{ ...current, kind: 'revision' as const }]) };
	assert.equal(await hasSoundscaperStartupRecovery(history, project.id,
		Object.assign(new Error('Current document is missing.'), { name: 'MissingStartupProjectError' })), true);
	assert.equal(await hasSoundscaperStartupRecovery(history, project.id,
		new Error('Soundscaper desktop baseline immutable file failed SHA-256 snapshot verification')), true);
});

test('startup repair detects lost or corrupt PCM in a valid document and keeps a healthy audio engine failure fatal', async (context) => {
	for (const condition of ['missing', 'corrupt', 'healthy']) {
		const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
		context.after(async () => { await store.close(); });
		const source = createAudioSource({ id: `startup-${condition}-source`, frameCount: 4, sampleRate: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: `startup-${condition}-clip`, sourceId: source.id, durationFrames: 4 });
		const project = createSoundscaperProject({ id: `startup-${condition}`, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: `startup-${condition}-track`, clipIds: [clip.id] })] });
		if (condition !== 'missing') await store.writeAudioBuffer(source.id, {
			sampleRate: 48_000, numberOfChannels: 1, length: 4,
			getChannelData: () => Float32Array.of(0.125, 0.25, 0.375, 0.5),
		}, source);
		await store.saveProject(project);
		if (condition === 'corrupt') {
			const chunk = [...store.memory.sourceChunks.values()][0] as { channels: ArrayBuffer[] };
			chunk.channels[0] = new ArrayBuffer(0);
		}
		assert.equal(await hasSoundscaperStartupRecovery(store, project.id, new Error('Audio engine activation failed.')), condition !== 'healthy', condition);
		if (condition !== 'healthy') {
			const binding = bindSoundscaperProjectRecovery(store, () => undefined);
			const inspection = await binding.inspect(project.id);
			const result = await binding.recover(inspection, 0);
			assert.equal(result.project.clips.length, 0);
			assert.equal(result.project.sources.length, 0);
			assert.deepEqual(await store.loadProject(project.id), project);
		}
	}
});

test('startup media inspection propagates storage, permission and cancellation failures instead of declaring audio missing', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const source = createAudioSource({ id: 'startup-blocked-source', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'startup-blocked-clip', sourceId: source.id, durationFrames: 4 });
	const project = createSoundscaperProject({ id: 'startup-blocked-media', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'startup-blocked-track', clipIds: [clip.id] })] });
	await store.saveProject(project);
	for (const failure of [new DOMException('Permission denied', 'SecurityError'), new DOMException('Quota exhausted', 'QuotaExceededError'),
		Object.assign(new Error('Blocked by another tab'), { name: 'EditorStoreBlockedError' }), new DOMException('Cancelled', 'AbortError'),
		new Error('Origin-private audio storage is unavailable.')]) {
		const blocked = { readProjectRecoveryCandidates: store.readProjectRecoveryCandidates.bind(store),
			async *readSourceChunks() { yield* []; throw failure; } };
		await assert.rejects(hasSoundscaperStartupRecovery(blocked, project.id, new Error('Activation failed.')), (error) => error === failure);
	}
});

test('repairing a damaged project reconnects its durable recording checkpoints to the recovery copy', async (context) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const track = createAudioTrack({ id: 'binding-recording-track', clipIds: [] });
	const original = createSoundscaperProject({ id: 'binding-recording-original', tracks: [track] });
	await store.saveProject(original);
	const saved = await store.loadProject(original.id);
	assert.ok(saved);
	const source = createAudioSource({ id: 'binding-recording-checkpoint', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	await store.writeAudioBuffer(source.id, {
		sampleRate: 48_000, numberOfChannels: 1, length: 4,
		getChannelData: () => Float32Array.of(0.125, 0.25, 0.375, 0.5),
	}, source);
	const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
	let journal = await repository.create(original.id, 'binding-interrupted-capture', saved);
	const destination = { trackId: track.id, startFrame: 120_000, sourceOffsetFrames: 2, sampleRate: 48_000, selection: null };
	journal = await repository.addLane(journal, 'binding-microphone', destination);
	journal = await repository.append(journal, 'binding-microphone', { sourceId: source.id, frameStart: 0, frameCount: 4, metadata: source });
	const corrupted = { ...saved, tracks: [{ ...track, gain: -999 }] };
	store.memory.projects.set(original.id, corrupted);
	await assert.rejects(store.loadProject(original.id));
	const originalCandidates = await store.readProjectRecoveryCandidates(original.id);
	let activeProjectId: string | null = null;
	const binding = bindSoundscaperProjectRecovery(store, (project) => { activeProjectId = project.id; });
	const inspection = await binding.inspect(original.id);
	const result = await binding.recover(inspection, 0);
	assert.equal(activeProjectId, result.project.id);
	assert.equal(result.project.tracks[0]?.id, track.id);
	const reconnected = await repository.load(result.project.id);
	assert.ok(reconnected);
	assert.equal(reconnected.id, journal.id);
	assert.deepEqual(reconnected.base, result.project);
	assert.deepEqual(reconnected.lanes, journal.lanes);
	assert.deepEqual(await repository.load(original.id), journal);
	assert.deepEqual(store.memory.projects.get(original.id), corrupted);
	assert.deepEqual(await store.readProjectRecoveryCandidates(original.id), originalCandidates);
	const restartedRecording = createOrdinaryRecordingRecoveryService({
		repository, getProjectId: () => activeProjectId, assertWritable: () => undefined,
		loadProject: (projectId) => store.loadProject(projectId),
		prepareTarget: () => assert.fail('Inspection must not publish recording audio.'),
		saveIfCurrent: () => assert.fail('Inspection must not publish project state.'),
		publish: () => assert.fail('Inspection must not activate project state.'),
		restoreProject: () => assert.fail('Inspection must not activate project state.'),
		isPublished: () => false,
		deleteSource: () => assert.fail('Inspection must not delete checkpoint audio.'),
	});
	const pending = await restartedRecording.inspect(result.project.id);
	assert.equal(pending?.checkpointCount, 1);
	const pcm: number[] = [];
	for await (const chunk of store.readSourceChunks(source.id)) pcm.push(...chunk.channels[0]!);
	assert.deepEqual(pcm, [0.125, 0.25, 0.375, 0.5]);
});
