/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AUDIO_ANALYSIS_REPORT_CACHE_PREFIX, peakCacheKey } from '../src/common/editor/source-analysis-cache.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { recordingRoutingSettingKey } from '../src/common/editor/recording-routing.js';
import { RECORDING_RECOVERY_KEY_PREFIX } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { startFramescaperDesktopProjectSession } from './helpers/framescaper-desktop-project-session.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('Framescaper desktop Clear retains saved history and playable timeline media after restart', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-clear-retained-media-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const previousAudioContext = globalThis.AudioContext;
	globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = previousAudioContext; });
	const indexedDB = createInstrumentedIndexedDB();
	const samples = Float32Array.from({ length: 4096 }, (_, index) => (index % 163 - 81) / 512);
	const bytes = encodeWav([samples], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array);
	const name = 'field.wav';
	const path = join(directory, name);
	await writeFile(path, bytes);
	const file = new File([await openAsBlob(path, { type: 'audio/wav' })], name, { type: 'audio/wav' });
	const open = () => startFramescaperDesktopProjectSession(directory, {
		openEnvironment: () => createFramescaperEditorProjectEnvironment({
			storeOptions: { indexedDB, preferOpfs: false,
				storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }) } },
		}),
	});
	const initial = await open();
	const saved = await (async () => {
		const { controller, environment, session } = initial;
		await controller.actions.project.create({ title: 'Field recording' });
		await controller.actions.project.importFiles([file], { destination: 'timeline' });
		await controller.actions.project.save();
		const project = controller.project;
		assert.ok(validateFramescaperProject(PROFILE, project));
		assert.equal(project.title, 'Field recording');
		const [source] = project.sources;
		assert.ok(source?.kind === 'audio' && typeof source.storageKey === 'string');
		assert.deepEqual((await environment.store.readSourceChunk(source.storageKey, 0)).channels[0], samples);
		const bundle = await readSavedBundle(session, project.id);
		const revisions = await environment.store.listProjectRevisions(project.id);
		assert.ok(revisions.length >= 2);
		const waveform = peakCacheKey(source.id);
		const report = `${AUDIO_ANALYSIS_REPORT_CACHE_PREFIX}${project.id}`;
		const recovery = `${RECORDING_RECOVERY_KEY_PREFIX}disconnected-recording`;
		const recoveryRoot = { sourceId: source.storageKey };
		const track = project.tracks.find(({ type }) => type === 'audio');
		assert.ok(track);
		const routingKey = recordingRoutingSettingKey(project.id);
		const routing = { routes: { [track.id]: {
			kind: 'device', deviceId: 'interface', deviceLabel: 'Studio interface', channelStart: 0, channelCount: 1,
		} }, offsets: {} };
		await environment.store.saveAnalysis(waveform, { cached: true });
		await environment.store.saveAnalysis(report, { cached: true });
		await environment.store.saveAnalysis(recovery, recoveryRoot);
		await environment.store.saveSetting('audio-editor-preferences-v1', { processingBackend: 'browser' });
		await environment.store.saveSetting(routingKey, routing);

		await controller.actions.project.clear();

		assert.notEqual(controller.project?.id, project.id);
		const projects = await environment.controllerStore.listProjects();
		assert.ok(projects.some(row => row.id === project.id));
		assert.deepEqual(await readSavedBundle(session, project.id), bundle);
		assert.equal(await environment.store.loadSetting('audio-editor-preferences-v1'), null);
		assert.deepEqual(await environment.store.loadSetting(routingKey), routing);
		assert.equal(await environment.store.loadAnalysis(waveform), null);
		assert.equal(await environment.store.loadAnalysis(report), null);
		assert.deepEqual(await environment.store.loadAnalysis(recovery), recoveryRoot);
		assert.ok(await environment.store.getSourceMetadata(source.storageKey), 'Clear must retain the only stored PCM');
		assert.deepEqual(await environment.store.listProjectRevisions(project.id), revisions);
		return { project, storageKey: source.storageKey, revisions, bundle, routingKey, routing };
	})().finally(() => initial.close());
	const restarted = await open();
	try {
		const { controller, environment, session } = restarted;
		await controller.actions.project.openById(saved.project.id);
		assert.equal(controller.project?.id, saved.project.id);
		assert.deepEqual(controller.project?.clips, saved.project.clips);
		assert.deepEqual((await environment.store.readSourceChunk(saved.storageKey, 0)).channels[0], samples);
		assert.deepEqual(await readSavedBundle(session, saved.project.id), saved.bundle);
		assert.deepEqual(await environment.store.listProjectRevisions(saved.project.id), saved.revisions);
		assert.deepEqual(await environment.store.loadSetting(saved.routingKey), saved.routing);
	} finally { await restarted.close(); }
});

async function readSavedBundle(
	session: Awaited<ReturnType<typeof startFramescaperDesktopProjectSession>>['session'],
	projectId: string,
): Promise<object> {
	const bundle = await session.readProjectBundle(projectId);
	assert.ok(bundle && typeof bundle === 'object' && 'metadataRevision' in bundle);
	// Clear can create another project and advance the library-wide catalog.
	const { metadataRevision: _catalogRevision, ...savedProject } = bundle;
	return savedProject;
}

test('a desktop Clear interrupted before storage mutation releases its writer admission', async context => {
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(() => store.close());
	const release = store.sourceRepository.releaseReadSessions;
	const failure = new Error('The source read handle failed to close.');
	store.sourceRepository.releaseReadSessions = () => Promise.reject(failure);
	try { await assert.rejects(store.clear({ preserveProjectData: true }), failure); }
	finally { store.sourceRepository.releaseReadSessions = release; }
	const writer = await store.beginSourceWrite('recording-after-reset', { sampleRate: 48_000, channelCount: 1 });
	await writer.write([Float32Array.of(0.25)]);
	await writer.commit();
	await store.clear({ preserveProjectData: true });
	assert.deepEqual((await store.readSourceChunk('recording-after-reset', 0)).channels[0], Float32Array.of(0.25));
});
