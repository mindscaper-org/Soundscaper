/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { normalizeAudioTrackFreezeV1 } from '../src/common/editor/audio-track-freeze-v21.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const damage of ['metadata', 'missing-render', 'changed-rack'] as const) test(`MP54: frozen recovery respects ${damage} integrity`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, playbackProjectService: playback,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, controller, { createRenderEngine: () => ({
		loadProject() {}, async renderTrack(_id, options = {}) {
			return { channels: [new Float32Array(Number(options.outputFrames)).fill(0.5)] };
		}, async dispose() {} }) });
	context.after(async () => { await freeze.dispose(); await controller.dispose(); playback.dispose(); }); await controller.ready;
	const source = createAudioSource({ id: `freeze-recovery-source-${damage}`, frameCount: 8, channelCount: 1, sampleRate: 48_000 });
	await store.writeAudioBuffer(source.storageKey, { sampleRate: 48_000, numberOfChannels: 1, length: 8,
		getChannelData: () => new Float32Array(8).fill(0.5) }, source);
	await controller.actions.project.open(createSoundscaperProject({ id: `freeze-recovery-${damage}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 8, sourceDurationFrames: 8 })] }));
	await freeze.actions.freeze('voice');
	const original = controller.project; assert.ok(original);
	const savedFreeze = normalizeAudioTrackFreezeV1(original.tracks[0]?.audioFreeze);
	await controller.actions.project.save();
	await controller.actions.project.create({ title: 'Recovery workspace' });
	const damaged = { ...original, metadata: { malformed: true }, tracks: original.tracks.map(track =>
		damage === 'changed-rack' ? { ...track, effects: [createEffect('lowpass', { id: 'changed-filter', params: { frequency: 1000 } })] } : track) };
	if (damage === 'missing-render') {
		const read = store.readSourceChunks.bind(store);
		const derivedKey = original.sources.find(source => source.id === savedFreeze.derivedSourceId)?.storageKey; assert.ok(derivedKey);
		store.readSourceChunks = async function* (key, options) {
			if (key === derivedKey) throw new DOMException('Frozen render is missing.', 'NotFoundError');
			yield* read(key, options);
		};
	}
	store.memory.projects.set(original.id, damaged);
	const recovery = bindSoundscaperProjectRecovery(store, recovered => controller.actions.project.open(recovered));
	const inspection = await recovery.inspect(original.id);
	const index = inspection.candidates.findIndex(row => row.kind === 'current'); assert.ok(index >= 0);
	const restored = await recovery.recover(inspection, index);
	assert.deepEqual(restored.project.tracks[0]?.audioFreeze, damage === 'missing-render' ? undefined : savedFreeze);
	assert.equal(restored.project.featureRequirements.requirements.some(requirement =>
		requirement.disposition === 'rendered-fallback' && requirement.fallback?.sourceId === savedFreeze.derivedSourceId), damage === 'metadata');
	assert.equal(playback.getFreezeStatus(restored.project, 'voice'),
		damage === 'metadata' ? 'fresh' : damage === 'missing-render' ? 'none' : 'stale');
	assert.deepEqual(store.memory.projects.get(original.id), damaged);
});
