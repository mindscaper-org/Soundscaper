/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const damage of ['metadata', 'missing-picture', 'broken-sound'] as const) test(`MP53: recovery preserves independently valid camera media through ${damage}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const body = new Blob(['camera with sound'], { type: 'video/mp4' });
	const picture = createVideoSource({ id: `paired-picture-${damage}`, storageKey: `paired-picture-body-${damage}`, name: 'Camera.mp4',
		contentSha256: await digestMediaContent(body), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	const sound = createAudioSource({ id: `paired-sound-${damage}`, frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const original = createSoundscaperProject({ id: `recovery-linked-camera-${damage}`, sources: [picture, sound],
		primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture', 'sound'] }],
		tracks: [createVideoTrack({ id: 'picture', laneGroupId: 'camera-pair', clipIds: ['picture-clip'] }),
			createAudioTrack({ id: 'sound', laneGroupId: 'camera-pair', clipIds: ['sound-clip'] })],
		clips: [{ kind: 'video', id: 'picture-clip', sourceId: picture.id, sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, avLinkId: 'camera-link' },
		{ kind: 'audio', id: 'sound-clip', sourceId: sound.id, timelineStartFrame: 0, sourceStartFrame: 0,
			durationFrames: 48_000, sourceDurationFrames: 48_000, avLinkId: 'camera-link' }] });
	await store.writeMediaAsset(picture.storageKey, body, { kind: 'video' });
	await store.writeAudioBuffer(sound.storageKey, { sampleRate: 48_000, numberOfChannels: 1, length: 48_000,
		getChannelData: () => new Float32Array(48_000) }, sound);
	await store.saveProject(original);
	const damaged = { ...original, metadata: { malformed: true },
		clips: original.clips.map(clip => damage === 'broken-sound' && clip.kind === 'audio'
			? { ...clip, sourceDurationFrames: 96_000 } : clip) };
	if (damage === 'missing-picture') {
		const load = store.loadMediaAsset.bind(store);
		store.loadMediaAsset = key => key === picture.storageKey ? Promise.resolve(null) : load(key);
	}
	store.memory.projects.set(original.id, damaged);
	const recovery = bindSoundscaperProjectRecovery(store, recovered => controller.actions.project.open(recovered));
	const inspection = await recovery.inspect(original.id);
	const index = inspection.candidates.findIndex(row => row.kind === 'current'); assert.ok(index >= 0);
	assert.notEqual(inspection.candidates[index]?.status, 'unrecoverable', inspection.candidates[index]?.error ?? 'No candidate error');
	const restored = await recovery.recover(inspection, index);
	assert.equal(validateSoundscaperProject(restored.project), true);
	assert.deepEqual(restored.project.clips.map(clip => [clip.id, clip.avLinkId]), damage === 'metadata'
		? [['picture-clip', 'camera-link'], ['sound-clip', 'camera-link']]
		: [[damage === 'missing-picture' ? 'sound-clip' : 'picture-clip', null]]);
	assert.deepEqual(restored.project.tracks.map(track => track.laneGroupId), ['camera-pair', 'camera-pair']);
	assert.deepEqual(store.memory.projects.get(original.id), damaged);
});
