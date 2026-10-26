/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { loadStoredSourceChannels } from '../src/common/editor/clip-time-pitch-cache-channels.js';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const scope of ['clip', 'track'] as const) test(`NP059: ${scope} Resample reads nonresident multichannel audio`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 1_440_000, channelCount: 6 });
	const original = createSoundscaperProject({ id: `stored-${scope}`, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	for (let offset = 0; offset < source.frameCount; offset += 65_536) {
		await writer.write(Array.from({ length: 6 }, (_, channel) => new Float32Array(Math.min(65_536, source.frameCount - offset)).fill((channel + 1) / 16)));
	}
	await writer.commit();
	const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Surround.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const before = controller.project;
	if (scope === 'clip') await controller.actions.clip.resample('clip', { sampleRate: 24_000 });
	else await controller.actions.track.resample('voice', 24_000);
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	const clip = after.clips[0]; assert.ok(clip);
	const resampled = after.sources.find(candidate => candidate.id === clip.sourceId);
	assert.ok(resampled?.kind === 'audio');
	assert.equal(resampled.channelCount, 6); assert.equal(resampled.sampleRate, 24_000);
	assert.equal(resampled.frameCount, 720_000);
	let offset = 0;
	for await (const chunk of store.readSourceChunks(resampled.storageKey)) {
		assert.equal(chunk.channels.length, 6);
		for (const [channel, pcm] of chunk.channels.entries()) {
			if (offset > 0) assert.ok(Math.abs(pcm[0]! - (channel + 1) / 16) < 1e-6);
		}
		offset += chunk.channels[0]?.length ?? 0;
	}
	assert.equal(offset, 720_000);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
});


test('NP059: wider source-edit reads preserve StaffPad default admission', async () => {
	const source = { frameCount: 2, channelCount: 6, storageKey: 'wide' };
	const store = { readSourceChunks: async function* () { yield { channels: Array.from({ length: 6 }, () => Float32Array.of(.25, .5)) }; } };
	await assert.rejects(loadStoredSourceChannels(store, source), /between 1 and 2/u);
	const channels = await loadStoredSourceChannels(store, source, { maximumChannelCount: 64 });
	assert.equal(channels.length, 6);
	assert.deepEqual([...channels[5]!], [.25, .5]);
	await assert.rejects(loadStoredSourceChannels(store, source, { maximumChannelCount: 65 }), /between 1 and 64/u);
});
