/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject, cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { normalizeVideoGeneratorSourceV1, normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperSoundVisualizerWindowReader } from '../src/framescaper/sound-visualizer-window.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { collectVisualPresetGeneratorSourceIds } from '../src/common/editor/video-visual-preset-v24.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';

for (const destination of ['fresh', 'occupied-media', 'copy'] as const) test(`native visualizer archive retains bound audio and presets in ${destination}`, async context => {
	const store = () => {
		const value = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false, databaseName: crypto.randomUUID() });
		context.after(async () => { await value.close(); });
		return value;
	};
	const audio = createAudioSource({ id: 'audio', name: 'Narration.wav', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const visual = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'visual-source', name: 'Sound Visualizer',
		width: 320, height: 180, frameRate: { num: 30, den: 1 }, frameCount: 30,
		generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: [audio.id], windowSeconds: 0.01,
			backgroundColor: '#00000000', foregroundColor: '#ff0000ff' } });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'visual', sourceId: visual.id,
		sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 });
	const project = createFramescaperProject(PROFILE, { id: 'visualizer-original', sources: [audio],
		clips: [createAudioClip({ id: 'sound', sourceId: audio.id, timelineStartFrame: 0, durationFrames: 48_000,
			sourceDurationFrames: 48_000 }), { ...clip }],
		visualModel: { generatorSources: [visual], presets: [{ schemaVersion: 1, kind: 'video-preset', id: 'saved-waveform',
			name: 'Saved waveform', modelKind: 'generator', authoredStateSha256: fingerprintNativeMediaPlan(visual).sha256 }] },
		tracks: [{ id: 'sound-track', type: 'audio', clipIds: ['sound'] }, { id: 'visual-track', type: 'video', clipIds: [clip.id] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['sound-track', 'visual-track'] }], primarySequenceId: 'main' });
	const writeAudio = async (target: ReturnType<typeof store>) => {
		const writer = await target.beginSourceWrite(audio.storageKey, audio);
		await writer.write([new Float32Array(48_000).fill(0.25)]);
		await writer.commit();
	};
	const sender = store();
	await writeAudio(sender);
	await sender.saveProject(project);
	const runtime = createFramescaperScapeNativeRuntime(PROFILE);
	const archive = await runtime.exportScapeProject(project, sender);
	assert.ok(archive.blob);
	const receiver = destination === 'copy' ? sender : store();
	if (destination === 'occupied-media') await writeAudio(receiver);
	const imported = await runtime.importScapeProject(archive.blob, receiver, { collision: 'copy' });
	assert.equal(imported.readOnly, false);
	const restored = cloneFramescaperProject(PROFILE, imported.project);
	const restoredAudio = restored.sources.find(source => source.kind === 'audio');
	assert.ok(restoredAudio);
	assert.equal(restoredAudio.id === audio.id, destination === 'fresh');
	assert.equal(restored.id === project.id, destination !== 'copy');
	const restoredVisual = normalizeVideoGeneratorSourceV1(restored.sources.find(source => source.id === clip.sourceId));
	assert.ok(restoredVisual.generator.kind === 'sound-visualizer');
	assert.deepEqual(restoredVisual.generator.sourceIds, [restoredAudio.id]);
	assert.deepEqual([...collectVisualPresetGeneratorSourceIds(restored)], [restoredVisual.id], 'saved preset still binds to the remapped model');
	const entry: UnifiedExactRenderVisualFrameEntryV13 = { nodeId: 'visual-node', modelId: 'visual', modelKind: 'sound-visualizer',
		trackId: 'visual-track', authoredState: { source: restoredVisual, clip }, opacity: 1, blendMode: 'normal', masks: [] };
	const reader = createFramescaperSoundVisualizerWindowReader({ project: restored, store: receiver });
	try {
		const window = await reader.window(entry, 24_000, 15, new AbortController().signal);
		assert.ok(window.channels?.[0]);
		assert.deepEqual([...new Set(window.channels[0])], [0.25]);
	} finally { reader.dispose(); }
});
