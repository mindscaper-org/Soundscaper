/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { normalizeVideoGeneratorSourceV1, normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { createFramescaperSoundVisualizerWindowReader } from '../src/framescaper/sound-visualizer-window.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';

for (const { looping, offset } of [{ looping: true, offset: 0 }, { looping: true, offset: 19_200 }, { looping: false, offset: 0 }]) for (const reversed of [false, true]) test(`native visualizer ${looping ? 'loops' : 'stretches'} ${reversed ? 'reversed' : 'forward'} PCM with phase ${offset}`, async () => {
	const source = createAudioSource({ id: 'audio', name: 'Levels.wav', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const base = { ...createAudioClip({ id: 'sound', sourceId: source.id }), timelineStartFrame: 0, durationFrames: 96_000,
		sourceStartFrame: 0, sourceDurationFrames: 48_000, reversed };
	const clip = looping ? { ...base, ...clipLoopUpdateFields(base, { periodFrames: 48_000, offsetFrames: offset, durationFrames: 96_000 }) } : base;
	const visualSource = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'visual-source', name: 'Sound Visualizer',
		width: 1280, height: 720, frameRate: { num: 30, den: 1 }, frameCount: 150,
		generator: { kind: 'sound-visualizer', mode: 'waveform', sourceIds: [], windowSeconds: 0.01,
			backgroundColor: '#00000000', foregroundColor: '#ff0000ff' } });
	const visualClip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'visual', sourceId: visualSource.id,
		sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
	const project = createFramescaperProject(PROFILE, { sources: [source], clips: [clip, { ...visualClip }],
		visualModel: { generatorSources: [visualSource] }, tracks: [{ id: 'sound-track', type: 'audio', clipIds: ['sound'] },
			{ id: 'visual-track', type: 'video', clipIds: ['visual'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['sound-track', 'visual-track'] }], primarySequenceId: 'main' });
	assert.equal(readClipLoop(project.clips[0]!)?.periodFrames ?? null, looping ? 48_000 : null);
	const entry: UnifiedExactRenderVisualFrameEntryV13 = { nodeId: 'visual-node', modelId: 'visual', modelKind: 'sound-visualizer',
		trackId: 'visual-track', authoredState: { source: visualSource, clip: visualClip }, opacity: 1, blendMode: 'normal', masks: [] };
	const pcm = Float32Array.from({ length: 48_000 }, (_, frame) => frame < 24_000 ? 0.25 : 0.75);
	const reader = createFramescaperSoundVisualizerWindowReader({ project, store: { readSourceChunk: () => ({ index: 0, frames: pcm.length, channels: [pcm] }) } });
	try {
		const window = await reader.window(entry, 57_600, 36, new AbortController().signal);
		assert.ok(window.channels?.[0]);
		const expected = looping && offset === 0 ? (reversed ? 0.75 : 0.25) : (reversed ? 0.25 : 0.75);
		assert.deepEqual([...new Set(window.channels[0])], [expected], 'window depicts the same physical portion of each repeat');
	} finally { reader.dispose(); }
});
