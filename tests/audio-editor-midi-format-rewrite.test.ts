/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { applyEditorCommand } from '../src/common/editor/commands.js';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { resampledClipCommands } from '../src/common/editor/controller/track-audio/internal/clip-resample-service.ts';
import { reinterpretedClipCommands } from '../src/common/editor/controller/track-audio/internal/clip-reinterpret-commands.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION } from '../src/common/editor/clip-source-stretch-memory.ts';

for (const { operation, rememberStretch } of [
	{ operation: 'resample', rememberStretch: false }, { operation: 'resample', rememberStretch: true },
	{ operation: 'reinterpret', rememberStretch: false },
] as const) test(`MIDI ${operation}${rememberStretch ? ' with source stretch memory' : ''} retires source-frame note data when PCM changes its clock`, () => {
	const original = createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1,
		sampleFormat: operation === 'reinterpret' ? 'int16' : 'float32' });
	const clip = { ...createMidiClip({ id: 'clip', sourceId: original.id, timelineStartFrame: 0, durationFrames: 16000,
		sourceDurationFrames: 16000, notes: [{ id: 'note', pitch: 60, channel: 0, velocity: 100, startFrame: 12000, durationFrames: 4000 }],
		opaqueExtensions: { unrelated: { preserved: true }, ...(rememberStretch ? { [CLIP_SOURCE_STRETCH_EXTENSION]: {
			sourceId: original.id, sourceFrameCount: 16000, map: { feature: 'audio-warp', points: [
				{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
				{ outer: { num: 16000, den: 1 }, source: { num: 16000, den: 1 }, mode: 'forward' },
			] },
		} } : {}) } }), timelineStartFrame: 0, durationFrames: 16000 };
	const project = createAudioEditorProjectV17({ sampleRate: 8000, sources: [original], clips: [clip],
		tracks: [{ ...createMidiTrack({ id: 'track', clipIds: [clip.id] }, 8000) }] });
	const replacement = createAudioSource({ id: 'replacement', sampleRate: 4000, frameCount: 8000, channelCount: 1 });
	const commands = operation === 'resample' ? resampledClipCommands('track', clip, original, replacement, 4000)
		: reinterpretedClipCommands('track', clip, original, replacement);
	const changed = applyEditorCommand(project, { type: 'batch', commands: [{ type: 'source/add', source: replacement }, ...commands] });
	assert.equal(readMidiClip(changed.clips[0]), null);
	assert.deepEqual(changed.clips[0]?.opaqueExtensions.unrelated, { preserved: true });
});
