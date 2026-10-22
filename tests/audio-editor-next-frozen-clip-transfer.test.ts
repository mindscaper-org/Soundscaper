/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { normalizeAudioTrackFreezeV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const action of ['track', 'new-track', 'bin', 'remove-project', 'partial', 'duplicate'] as const) test(`NP019: frozen clip ${action} transfer retires only an emptied print`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, playbackProjectService: playback,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, controller, { createRenderEngine: () => ({
		loadProject() {}, async renderTrack(_id, options = {}) {
			return { channels: [new Float32Array(Number(options.outputFrames)).fill(.5)] };
		}, async dispose() {},
	}) });
	context.after(async () => { await freeze.dispose(); await controller.dispose(); playback.dispose(); }); await controller.ready;
	const source = createAudioSource({ id: `frozen-transfer-source-${action}`, frameCount: 8, channelCount: 1, sampleRate: 48_000 });
	await store.writeAudioBuffer(source.storageKey, { sampleRate: 48_000, numberOfChannels: 1, length: 8,
		getChannelData: () => new Float32Array(8).fill(.5) }, source);
	await controller.actions.project.open(createSoundscaperProject({ id: `frozen-transfer-${action}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }), createAudioTrack({ id: 'destination', clipIds: [] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 8, sourceDurationFrames: 8 })] }));
	controller.actions.projectBin.moveFromTimeline('clip');
	const clipId = controller.actions.projectBin.place('clip', { trackId: 'voice', timelineStartFrame: 0 }); assert.ok(clipId);
	if (action === 'partial') controller.actions.edit.commit({ type: 'clip/add', trackId: 'voice', clip:
		createAudioClip({ id: 'remaining', sourceId: source.id, timelineStartFrame: 8, durationFrames: 8, sourceDurationFrames: 8 }) });
	await freeze.actions.freeze('voice');
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	const printed = normalizeAudioTrackFreezeV1(before.tracks[0]?.audioFreeze);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	if (action === 'track' || action === 'partial' || action === 'duplicate') {
		controller.actions.clip.move(clipId, 'destination', 0, { exactFrame: true, duplicate: action === 'duplicate' });
	} else if (action === 'new-track') controller.actions.clip.moveToNewTrack(clipId, 0, { exactFrame: true });
	else if (action === 'bin') controller.actions.projectBin.moveFromTimeline(clipId);
	else controller.actions.projectBin.removeFromProject('clip');
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	const voice = after.tracks.find(track => track.id === 'voice'); assert.ok(voice);
	const retainsClips = action === 'partial' || action === 'duplicate';
	assert.equal(Boolean(voice.audioFreeze), retainsClips);
	assert.ok(Array.isArray(voice.clipIds));
	assert.equal(voice.clipIds.length, retainsClips ? 1 : 0);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	assert.ok(await store.getSourceMetadata(printed.derivedSourceId), 'the Undo print body remains retained');
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks);
	assert.deepEqual(controller.project?.clips, before.clips); assert.deepEqual(controller.project?.projectBin, before.projectBin);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, after.tracks);
	assert.deepEqual(controller.project?.clips, after.clips); assert.deepEqual(controller.project?.projectBin, after.projectBin);
});
