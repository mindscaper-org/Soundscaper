/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createSoundscaperDesktopProjectLibraryHandshake, createSoundscaperDesktopProjectLibraryPaths } from '../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts';
import { AUDIO_ANALYSIS_REPORT_CACHE_PREFIX, peakCacheKey } from '../src/common/editor/source-analysis-cache.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { RECORDING_RECOVERY_KEY_PREFIX } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { SUBPROJECT_LIBRARY_SETTING } from '../src/common/editor/subproject-library-setting.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperAudioEditorController } from '../src/soundscaper/editor-controller.ts';
import { createSoundscaperEditorProjectEnvironment } from '../src/soundscaper/editor-project-environment.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { soundscaperLibrarySessionBridge } from './helpers/soundscaper-library-session-bridge.ts';

test('Soundscaper desktop Clear retains saved history and playable timeline media after restart', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-clear-retained-media-'));
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
	const saved = await withDesktopController(directory, indexedDB, async (controller, environment) => {
		await controller.actions.project.create({ title: 'Field recording' });
		await controller.actions.project.importFiles([file], { destination: 'timeline' });
		await controller.actions.project.save();
		const project = controller.project;
		assert.ok(validateSoundscaperProject(project));
		assert.equal(project.title, 'Field recording');
		const [source] = project.sources;
		assert.ok(source?.kind === 'audio' && typeof source.storageKey === 'string');
		assert.deepEqual((await environment.store.readSourceChunk(source.storageKey, 0)).channels[0], samples);
		const revisions = readSavedRevisions(directory, project.id);
		assert.ok(revisions.length >= 2);
		const shadowRevisions = await environment.store.listProjectRevisions(project.id);
		const waveform = peakCacheKey(source.id);
		const report = `${AUDIO_ANALYSIS_REPORT_CACHE_PREFIX}${project.id}`;
		const recovery = `${RECORDING_RECOVERY_KEY_PREFIX}disconnected-recording`;
		const recoveryRoot = { sourceId: source.storageKey };
		await environment.store.saveAnalysis(waveform, { cached: true });
		await environment.store.saveAnalysis(report, { cached: true });
		await environment.store.saveAnalysis(recovery, recoveryRoot);
		await environment.store.saveSetting('audio-editor-preferences-v1', { processingBackend: 'browser' });
		await environment.store.saveSetting(SUBPROJECT_LIBRARY_SETTING, 'library-reset-test');

		await controller.actions.project.clear();

		assert.notEqual(controller.project?.id, project.id);
		const projects = await environment.controllerStore.listProjects();
		assert.ok(projects.some(row => row.id === project.id));
		assert.deepEqual(readSavedRevisions(directory, project.id), revisions);
		assert.equal(await environment.store.loadSetting('audio-editor-preferences-v1'), null);
		assert.equal(await environment.store.loadSetting(SUBPROJECT_LIBRARY_SETTING), 'library-reset-test');
		assert.equal(await environment.store.loadAnalysis(waveform), null);
		assert.equal(await environment.store.loadAnalysis(report), null);
		assert.deepEqual(await environment.store.loadAnalysis(recovery), recoveryRoot);
		assert.ok(await environment.store.getSourceMetadata(source.storageKey), 'Clear must retain the only stored PCM');
		assert.deepEqual(await environment.store.listProjectRevisions(project.id), shadowRevisions);
		return { project, storageKey: source.storageKey, revisions };
	});
	await withDesktopController(directory, indexedDB, async (controller, environment) => {
		await controller.actions.project.openById(saved.project.id);
		assert.equal(controller.project?.id, saved.project.id);
		assert.deepEqual(controller.project?.clips, saved.project.clips);
		assert.equal(controller.getSnapshot().projectRecovery, null);
		assert.deepEqual((await environment.store.readSourceChunk(saved.storageKey, 0)).channels[0], samples);
		assert.deepEqual(readSavedRevisions(directory, saved.project.id), saved.revisions);
	});
});

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

function readSavedRevisions(directory: string, projectId: string) {
	const path = createSoundscaperDesktopProjectLibraryPaths(directory).databasePath;
	const database = new DatabaseSync(path, { readOnly: true });
	try { return database.prepare('SELECT * FROM project_revisions WHERE project_id = ? ORDER BY project_revision').all(projectId); }
	finally { database.close(); }
}

async function withDesktopController<Value>(
	directory: string,
	indexedDB: ReturnType<typeof createInstrumentedIndexedDB>,
	run: (controller: ReturnType<typeof createSoundscaperAudioEditorController>,
		environment: Awaited<ReturnType<typeof createSoundscaperEditorProjectEnvironment>>) => Promise<Value>,
): Promise<Value> {
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: directory, handshake,
		owner: { product: 'soundscaper', processId: process.pid, instanceId: crypto.randomUUID() },
		onLeaseLost: () => undefined, testControl: null,
	});
	const session = main.openSession(handshake);
	const bridge = soundscaperLibrarySessionBridge(main, session);
	const libraryGlobal = 'soundscaperProjectLibraryDesktop';
	const recoveryGlobal = 'soundscaperProjectRecoveryDesktop';
	Object.defineProperty(globalThis, libraryGlobal, { configurable: true, enumerable: true, value: Object.freeze({ v1: bridge }) });
	Object.defineProperty(globalThis, recoveryGlobal, { configurable: true, enumerable: true, value: Object.freeze({
		listProjectRecoverySummaries: async () => main.listProjectRecoverySummaries(),
		readProjectRecoveryCandidates: async (id: string) => main.readProjectRecoveryCandidates(id),
	}) });
	try {
		const environment = await createSoundscaperEditorProjectEnvironment({ storeOptions: {
			indexedDB, preferOpfs: false, storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }) },
		} });
		try {
			const controller = createSoundscaperAudioEditorController(environment);
			try {
				await controller.ready;
				return await run(controller, environment);
			} finally { await controller.dispose(); }
		} finally { await environment.close(); }
	} finally {
		Reflect.deleteProperty(globalThis, libraryGlobal);
		Reflect.deleteProperty(globalThis, recoveryGlobal);
		try { await session.close(); } finally { await main.close(); }
	}
}
